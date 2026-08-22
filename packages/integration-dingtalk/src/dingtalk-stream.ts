import type { IntegrationInput } from "@oh-my-bug/core";

import type { DingTalkIntegrationAdapter } from "./dingtalk-adapter.js";
import type { DingTalkClient, DingTalkMessage } from "./dingtalk-client.js";

export type IntegrationState = "stopped" | "connecting" | "connected" | "backoff";
export interface IntegrationHealth {
  state: IntegrationState;
  lastSuccessAt?: string;
  lastError?: string;
  nextRetryAt?: string;
}

export interface DingTalkStreamOptions {
  client: DingTalkClient;
  adapter: DingTalkIntegrationAdapter;
  onInput(input: IntegrationInput): Promise<void>;
  now?: () => Date;
  secretValues?: string[];
  baseRetryMs?: number;
  jitter?(delayMs: number): number;
  wait?(delayMs: number, signal: AbortSignal): Promise<void>;
}

const MAX_RETRY_MS = 60_000;

export class DingTalkStream {
  private status: IntegrationHealth = { state: "stopped" };
  private registered = false;

  constructor(private readonly options: DingTalkStreamOptions) {}

  register(): void {
    if (this.registered) return;
    this.registered = true;
    this.options.client.onRobotMessage((message) => this.handle(message));
  }

  async start(signal: AbortSignal): Promise<void> {
    this.register();
    let failures = 0;
    let disconnectPending = false;
    try {
      while (!signal.aborted) {
        this.status = { state: "connecting" };
        disconnectPending = true;
        try {
          await this.options.client.connect();
        } catch (error) {
          this.disconnectSafely();
          disconnectPending = false;
          if (signal.aborted) break;

          failures += 1;
          const delayMs = this.retryDelay(failures);
          this.status = {
            state: "backoff",
            lastError: redactError(error, this.options.secretValues ?? []),
            nextRetryAt: new Date(this.now().getTime() + delayMs).toISOString(),
          };
          await waitForRetry(delayMs, signal, this.options.wait ?? waitForDelay);
          continue;
        }

        if (signal.aborted) break;
        this.status = { state: "connected", lastSuccessAt: this.now().toISOString() };
        await aborted(signal);
        break;
      }
    } finally {
      if (disconnectPending) this.disconnectSafely();
      this.status = { ...this.status, state: "stopped", nextRetryAt: undefined };
    }
  }

  health(): Readonly<IntegrationHealth> {
    return Object.freeze({ ...this.status });
  }

  private async handle(message: DingTalkMessage): Promise<void> {
    let input: IntegrationInput;
    try {
      const payload = JSON.parse(message.data) as unknown;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("DINGTALK_PAYLOAD_INVALID");
      }
      input = await this.options.adapter.adapt(payload as Record<string, unknown>);
    } catch (error) {
      this.options.client.acknowledge(message.headers.messageId);
      this.status = {
        state: "connected",
        lastError: redactError(error, this.options.secretValues ?? []),
      };
      return;
    }

    try {
      await this.options.onInput(input);
      this.options.client.acknowledge(message.headers.messageId);
      this.status = { state: "connected", lastSuccessAt: this.now().toISOString() };
    } catch (error) {
      this.status = {
        state: "backoff",
        lastError: redactError(error, this.options.secretValues ?? []),
        nextRetryAt: new Date(this.now().getTime() + 1_000).toISOString(),
      };
    }
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private retryDelay(failures: number): number {
    const baseRetryMs = Math.max(1, this.options.baseRetryMs ?? 1_000);
    const exponential = Math.min(baseRetryMs * (2 ** (failures - 1)), MAX_RETRY_MS);
    const jittered = this.options.jitter?.(exponential) ?? exponential + (Math.random() * baseRetryMs);
    return Math.min(Math.max(1, jittered), MAX_RETRY_MS);
  }

  private disconnectSafely(): void {
    try {
      this.options.client.disconnect();
    } catch {
      // A broken disconnect must not terminate retries or prevent a stopped state.
    }
  }
}

function redactError(error: unknown, secrets: string[]): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of secrets.filter(Boolean)) message = message.split(secret).join("[REDACTED]");
  return message.slice(0, 1_000);
}

function aborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}

function waitForDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = () => finish();
    const timeout = setTimeout(() => finish(), delayMs);
    const finish = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function waitForRetry(
  delayMs: number,
  signal: AbortSignal,
  wait: (delayMs: number, signal: AbortSignal) => Promise<void>,
): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", finish);
      reject(error);
    };
    signal.addEventListener("abort", finish, { once: true });
    try {
      void wait(delayMs, signal).then(finish, fail);
    } catch (error) {
      fail(error);
    }
  });
}
