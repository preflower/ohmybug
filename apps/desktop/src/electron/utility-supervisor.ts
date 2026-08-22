import { UtilityClient, type UtilityProcessPort } from "./utility-client.js";

export type UtilityRuntimeState =
  | "starting"
  | "ready"
  | "restarting"
  | "disconnected"
  | "stopping"
  | "stopped";

export interface ManagedUtilityProcess extends UtilityProcessPort {
  kill(): boolean;
}

interface UtilitySupervisorOptions {
  spawn: () => ManagedUtilityProcess;
  restartLimit?: number;
  startupTimeoutMs?: number;
  onState?: (state: UtilityRuntimeState) => void;
}

export class UtilitySupervisor {
  private readonly restartLimit: number;
  private readonly startupTimeoutMs: number;
  private readonly onState: (state: UtilityRuntimeState) => void;
  private child?: ManagedUtilityProcess;
  private utilityClient?: UtilityClient;
  private startTask?: Promise<void>;
  private restartCount = 0;
  private stopping = false;
  private state: UtilityRuntimeState = "stopped";

  constructor(private readonly options: UtilitySupervisorOptions) {
    this.restartLimit = options.restartLimit ?? 1;
    this.startupTimeoutMs = options.startupTimeoutMs ?? 10_000;
    this.onState = options.onState ?? (() => undefined);
  }

  start(): Promise<void> {
    this.startTask ??= this.launch("starting").catch((error) => {
      this.setState("disconnected");
      throw error;
    });
    return this.startTask;
  }

  client(): UtilityClient {
    if (this.state !== "ready" || !this.utilityClient) throw new Error("UTILITY_NOT_READY");
    return this.utilityClient;
  }

  async shutdown(): Promise<void> {
    if (this.stopping || this.state === "stopped") return;
    this.stopping = true;
    this.setState("stopping");
    const child = this.child;
    const client = this.utilityClient;
    if (client) {
      await client.request("shutdown", {}, { timeoutMs: 10_000 }).catch(() => undefined);
      client.dispose();
    }
    child?.kill();
    this.child = undefined;
    this.utilityClient = undefined;
    this.setState("stopped");
  }

  private async launch(state: "starting" | "restarting"): Promise<void> {
    this.setState(state);
    const child = this.options.spawn();
    const client = new UtilityClient(child);
    this.child = child;
    this.utilityClient = client;
    child.on("exit", () => this.handleExit(child));
    await withTimeout(client.whenReady(), this.startupTimeoutMs, "UTILITY_STARTUP_TIMEOUT");
    if (!this.stopping && this.child === child) this.setState("ready");
  }

  private handleExit(child: ManagedUtilityProcess): void {
    if (this.child !== child) return;
    this.child = undefined;
    this.utilityClient = undefined;
    if (this.stopping) return;
    if (this.restartCount >= this.restartLimit) {
      this.setState("disconnected");
      return;
    }
    this.restartCount += 1;
    void this.launch("restarting").catch(() => this.setState("disconnected"));
  }

  private setState(state: UtilityRuntimeState): void {
    this.state = state;
    this.onState(state);
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, code: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(code)), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
