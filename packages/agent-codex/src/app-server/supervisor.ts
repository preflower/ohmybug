import { spawn as nodeSpawn } from "node:child_process";
import { chmod, lstat, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveCodexBinary,
  verifyCodexBinary,
  verifyGeneratedProtocolContract,
  type ResolvedCodexBinary,
} from "../codex-binary.js";
import { AppServerRpcClient } from "./rpc-client.js";
import type { AppServerMethods, JsonRpcNotification, UnixAppServerEndpoint } from "./protocol.js";

interface SupervisorChild {
  kill(): boolean;
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
}

export interface AppServerConnection {
  initialize(): Promise<void>;
  request<Name extends keyof AppServerMethods>(
    method: Name,
    params: AppServerMethods[Name]["input"],
    options?: { signal?: AbortSignal },
  ): Promise<AppServerMethods[Name]["output"]>;
  notifications(): AsyncIterable<JsonRpcNotification>;
  close(): Promise<void>;
}

export interface CodexAppServerSupervisorOptions {
  dataRoot: string;
  binary?: ResolvedCodexBinary;
  restartLimit?: 1;
  startupTimeoutMs?: number;
}

export interface CodexAppServerSupervisorDependencies {
  resolveBinary(): ResolvedCodexBinary;
  verifyBinary(binary: ResolvedCodexBinary): Promise<void>;
  verifyProtocol(schemaPath: string, versionPath: string): Promise<void>;
  spawn(file: string, args: string[], options: { stdio: "ignore" }): SupervisorChild;
  connect(endpoint: UnixAppServerEndpoint): Promise<AppServerConnection>;
  delay(milliseconds: number): Promise<void>;
}

const defaultDependencies: CodexAppServerSupervisorDependencies = {
  resolveBinary: resolveCodexBinary,
  verifyBinary: verifyCodexBinary,
  verifyProtocol: verifyGeneratedProtocolContract,
  spawn: (file, args, options) => nodeSpawn(file, args, options),
  connect: (endpoint) => AppServerRpcClient.connect(endpoint),
  delay: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

export class CodexAppServerSupervisor {
  private readonly restartLimit: number;
  private readonly startupTimeoutMs: number;
  private readonly socketPath: string;
  private readonly runDirectory: string;
  private readonly binary: ResolvedCodexBinary;
  private connection?: AppServerConnection;
  private child?: SupervisorChild;
  private startTask?: Promise<AppServerConnection>;
  private restartCount = 0;
  private generationValue = 0;
  private stopping = false;

  constructor(
    private readonly options: CodexAppServerSupervisorOptions,
    private readonly dependencies: CodexAppServerSupervisorDependencies = defaultDependencies,
  ) {
    if (!options.dataRoot.trim()) throw new Error("DATA_ROOT_REQUIRED");
    this.restartLimit = options.restartLimit ?? 1;
    this.startupTimeoutMs = options.startupTimeoutMs ?? 10_000;
    this.runDirectory = join(options.dataRoot, "run");
    this.socketPath = join(this.runDirectory, "codex-app-server.sock");
    this.binary = options.binary ?? dependencies.resolveBinary();
  }

  start(): Promise<AppServerConnection> {
    if (this.stopping) return Promise.reject(new Error("CODEX_APP_SERVER_STOPPED"));
    this.startTask ??= this.launch();
    return this.startTask;
  }

  client(): AppServerConnection {
    if (!this.connection) throw new Error("CODEX_APP_SERVER_UNAVAILABLE");
    return this.connection;
  }

  endpoint(): UnixAppServerEndpoint {
    return {
      transport: "unix",
      socketPath: this.socketPath,
      remoteUrl: `unix://${this.socketPath}`,
    };
  }

  executablePath(): string { return this.binary.executablePath; }
  generation(): number { return this.generationValue; }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    const connection = this.connection;
    const child = this.child;
    this.connection = undefined;
    this.child = undefined;
    await connection?.close().catch(() => undefined);
    child?.kill();
    await this.removeSocket(false);
  }

  private async launch(): Promise<AppServerConnection> {
    this.assertSocketLength();
    await this.dependencies.verifyBinary(this.binary);
    const protocolRoot = fileURLToPath(new URL("../../protocol/", import.meta.url));
    await this.dependencies.verifyProtocol(
      join(protocolRoot, "codex_app_server_protocol.schemas.json"),
      join(protocolRoot, "version.json"),
    );
    await mkdir(this.runDirectory, { recursive: true, mode: 0o700 });
    await chmod(this.runDirectory, 0o700);
    await this.removeSocket(true);
    const endpoint = this.endpoint();
    const child = this.dependencies.spawn(
      this.binary.executablePath,
      ["app-server", "--strict-config", "--listen", endpoint.remoteUrl],
      { stdio: "ignore" },
    );
    this.child = child;
    this.generationValue += 1;
    let exited = false;
    child.on("exit", () => {
      exited = true;
      void this.handleUnexpectedExit(child);
    });
    const deadline = Date.now() + this.startupTimeoutMs;
    let lastError: unknown;
    while (!this.stopping && !exited && Date.now() < deadline) {
      try {
        const connection = await this.dependencies.connect(endpoint);
        await connection.initialize();
        if (this.stopping || exited || this.child !== child) {
          await connection.close().catch(() => undefined);
          break;
        }
        this.connection = connection;
        return connection;
      } catch (error) {
        lastError = error;
        await this.dependencies.delay(25);
      }
    }
    child.kill();
    if (this.stopping) throw new Error("CODEX_APP_SERVER_STOPPED");
    if (exited) throw new Error("CODEX_APP_SERVER_EXITED", { cause: lastError });
    throw new Error("CODEX_APP_SERVER_STARTUP_TIMEOUT", { cause: lastError });
  }

  private async handleUnexpectedExit(child: SupervisorChild): Promise<void> {
    if (this.child !== child) return;
    this.child = undefined;
    const connection = this.connection;
    this.connection = undefined;
    await connection?.close().catch(() => undefined);
    if (this.stopping || this.restartCount >= this.restartLimit) return;
    this.restartCount += 1;
    this.startTask = undefined;
    void this.start().catch(() => undefined);
  }

  private assertSocketLength(): void {
    if (Buffer.byteLength(this.socketPath) > 100) {
      throw new Error("CODEX_APP_SERVER_SOCKET_PATH_TOO_LONG");
    }
  }

  private async removeSocket(rejectUnsafe: boolean): Promise<void> {
    try {
      const metadata = await lstat(this.socketPath);
      if (!metadata.isSocket()) {
        if (rejectUnsafe) throw new Error("CODEX_APP_SERVER_SOCKET_UNSAFE");
        return;
      }
      await unlink(this.socketPath);
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
  }
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
