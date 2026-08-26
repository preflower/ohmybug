import { lstatSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";

import type { AgentPlugin } from "@oh-my-bug/core";

import { codexAgent } from "../codex-agent-adapter.js";
import type { CodexClient, CodexThread, CodexThreadOptions } from "../codex-client.js";
import { AppServerCodexClient } from "./codex-client.js";
import type { UnixAppServerEndpoint } from "./protocol.js";
import {
  CodexAppServerSupervisor,
  type AppServerConnection,
} from "./supervisor.js";

export type AgentTerminalUnavailableReason =
  | "UNSUPPORTED_AGENT"
  | "SESSION_NOT_READY"
  | "WORKSPACE_NOT_READY"
  | "APP_SERVER_UNAVAILABLE";

export type AgentTerminalAvailability =
  | { available: true }
  | { available: false; reason: AgentTerminalUnavailableReason };

export interface AgentTerminalLaunchTarget {
  agent: "codex";
  providerThreadId: string;
  executablePath: string;
  remoteUrl: string;
  workingDirectory: string;
}

export interface TerminalSessionContext {
  agent?: string;
  providerThreadId?: string;
  workingDirectory?: string;
  workspaceReady: boolean;
}

interface RuntimeClient extends CodexClient { dispose(): Promise<void> }
interface RuntimeSupervisor {
  start(): Promise<AppServerConnection>;
  client(): AppServerConnection;
  stop(): Promise<void>;
  endpoint(): UnixAppServerEndpoint;
  executablePath(): string;
  generation(): number;
}

export interface CodexAppServerRuntimeHostDependencies {
  supervisor: RuntimeSupervisor;
  createClient(connection: AppServerConnection): RuntimeClient;
  validateSocket(endpoint: UnixAppServerEndpoint): boolean;
  validateDirectory(path: string): boolean;
}

export class CodexAppServerRuntimeHost {
  readonly plugin: AgentPlugin;
  private readonly supervisor: RuntimeSupervisor;
  private readonly dependencies: CodexAppServerRuntimeHostDependencies;
  private readonly forwardingClient = new ForwardingCodexClient();
  private runtimeClient?: RuntimeClient;
  private activeConnection?: AppServerConnection;
  private activeGeneration?: number;
  private startTask?: Promise<void>;
  private stopTask?: Promise<void>;

  constructor(
    options: { dataRoot: string },
    dependencies?: Partial<CodexAppServerRuntimeHostDependencies>,
  ) {
    const supervisor = dependencies?.supervisor ?? new CodexAppServerSupervisor({
      dataRoot: options.dataRoot,
    });
    this.supervisor = supervisor;
    this.dependencies = {
      supervisor,
      createClient: dependencies?.createClient ?? ((connection) => new AppServerCodexClient(connection)),
      validateSocket: dependencies?.validateSocket ?? defaultValidateSocket,
      validateDirectory: dependencies?.validateDirectory ?? defaultValidateDirectory,
    };
    this.plugin = codexAgent({ client: this.forwardingClient });
  }

  start(): Promise<void> {
    this.startTask ??= this.startHost();
    return this.startTask;
  }

  stop(): Promise<void> {
    this.stopTask ??= this.stopHost();
    return this.stopTask;
  }

  availability(context: TerminalSessionContext): AgentTerminalAvailability {
    if (context.agent !== "codex") return unavailable("UNSUPPORTED_AGENT");
    if (!validThreadId(context.providerThreadId)) return unavailable("SESSION_NOT_READY");
    if (
      !context.workspaceReady ||
      !context.workingDirectory ||
      !this.dependencies.validateDirectory(context.workingDirectory)
    ) return unavailable("WORKSPACE_NOT_READY");
    if (!this.isServerAvailable()) return unavailable("APP_SERVER_UNAVAILABLE");
    return { available: true };
  }

  resolveLaunchTarget(context: TerminalSessionContext): AgentTerminalLaunchTarget {
    if (context.agent !== "codex") throw new Error("AGENT_TERMINAL_AGENT_UNSUPPORTED");
    if (!validThreadId(context.providerThreadId)) {
      throw new Error("AGENT_TERMINAL_SESSION_INVALID");
    }
    if (
      !context.workspaceReady ||
      !context.workingDirectory ||
      !this.dependencies.validateDirectory(context.workingDirectory)
    ) throw new Error("AGENT_TERMINAL_WORKSPACE_INVALID");
    if (!this.isServerAvailable()) throw new Error("AGENT_TERMINAL_UNAVAILABLE");
    return {
      agent: "codex",
      providerThreadId: context.providerThreadId,
      executablePath: this.supervisor.executablePath(),
      remoteUrl: this.supervisor.endpoint().remoteUrl,
      workingDirectory: context.workingDirectory,
    };
  }

  private async startHost(): Promise<void> {
    try {
      const connection = await this.supervisor.start();
      const client = this.dependencies.createClient(connection);
      this.activeConnection = connection;
      this.runtimeClient = client;
      this.forwardingClient.attach(client);
      this.activeGeneration = this.supervisor.generation();
    } catch {
      this.runtimeClient = undefined;
      this.activeConnection = undefined;
      this.activeGeneration = undefined;
      this.forwardingClient.detach();
      await this.supervisor.stop().catch(() => undefined);
    }
  }

  private async stopHost(): Promise<void> {
    await this.startTask?.catch(() => undefined);
    this.forwardingClient.detach();
    await this.supervisor.stop().catch(() => undefined);
    await this.runtimeClient?.dispose();
    this.runtimeClient = undefined;
    this.activeConnection = undefined;
    this.activeGeneration = undefined;
  }

  private isServerAvailable(): boolean {
    if (
      !this.runtimeClient ||
      !this.activeConnection ||
      this.activeGeneration !== this.supervisor.generation()
    ) return false;
    try {
      return this.supervisor.client() === this.activeConnection &&
        this.dependencies.validateSocket(this.supervisor.endpoint());
    } catch {
      return false;
    }
  }
}

class ForwardingCodexClient implements CodexClient {
  private delegate?: CodexClient;

  attach(client: CodexClient): void { this.delegate = client; }
  detach(): void { this.delegate = undefined; }

  startThread(options: CodexThreadOptions): CodexThread {
    if (!this.delegate) throw new Error("CODEX_APP_SERVER_UNAVAILABLE");
    return this.delegate.startThread(options);
  }

  resumeThread(threadId: string, options: CodexThreadOptions): CodexThread {
    if (!this.delegate) throw new Error("CODEX_APP_SERVER_UNAVAILABLE");
    return this.delegate.resumeThread(threadId, options);
  }
}

function unavailable(reason: AgentTerminalUnavailableReason): AgentTerminalAvailability {
  return { available: false, reason };
}

function validThreadId(value: string | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value));
}

function defaultValidateSocket(endpoint: UnixAppServerEndpoint): boolean {
  try {
    return endpoint.transport === "unix" && isAbsolute(endpoint.socketPath) &&
      endpoint.remoteUrl === `unix://${endpoint.socketPath}` && lstatSync(endpoint.socketPath).isSocket();
  } catch {
    return false;
  }
}

function defaultValidateDirectory(path: string): boolean {
  try {
    return isAbsolute(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}
