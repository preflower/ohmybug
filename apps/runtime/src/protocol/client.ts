import { randomUUID } from "node:crypto";

import { runtimeOperations } from "./operations.js";
import { utilityRequestSchema, utilityResponseSchema } from "./schemas.js";
import type {
  RuntimeOperation,
  RuntimeOperationInput,
  RuntimeOperationOutput,
} from "./types.js";

export interface RuntimeClientPort {
  postMessage(message: unknown): void;
  on(event: "message", listener: (message: unknown) => void): unknown;
  on(event: "exit", listener: (code: number) => void): unknown;
  off?(event: "message", listener: (message: unknown) => void): unknown;
  off?(event: "exit", listener: (code: number) => void): unknown;
}

export interface RuntimeClientOptions {
  timeoutMs?: number;
  id?: () => string;
}

export interface RuntimeRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface IssueEventEnvelope {
  issueId: string;
  cursor: number;
  events: Array<{
    id: string;
    issueId: string;
    sequence: number;
    type: string;
    actor: "SYSTEM" | "USER" | "AGENT";
    data: Record<string, unknown>;
    occurredAt: string;
  }>;
}

interface PendingRequest {
  operation: RuntimeOperation;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export class RuntimeClient {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly subscriptions = new Map<string, (event: IssueEventEnvelope) => void>();
  private readonly timeoutMs: number;
  private readonly id: () => string;
  private readonly ready: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;
  private readySettled = false;
  private exited = false;

  constructor(private readonly port: RuntimeClientPort, options: RuntimeClientOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.id = options.id ?? randomUUID;
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    void this.ready.catch(() => undefined);
    port.on("message", this.onMessage);
    port.on("exit", this.onExit);
  }

  whenReady(): Promise<void> { return this.ready; }

  request<Name extends RuntimeOperation>(
    operation: Name,
    input: RuntimeOperationInput<Name>,
    options: RuntimeRequestOptions = {},
  ): Promise<RuntimeOperationOutput<Name>> {
    if (this.exited) return Promise.reject(new Error("UTILITY_PROCESS_EXITED"));
    const id = this.id();
    const message = utilityRequestSchema.parse({ kind: "request", id, operation, payload: input });
    if (options.signal?.aborted) {
      return Promise.reject(new Error("RUN_CANCELED", { cause: options.signal.reason }));
    }
    return new Promise<RuntimeOperationOutput<Name>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.port.postMessage({ kind: "cancel", id });
        this.settle(id, new Error("UTILITY_REQUEST_TIMEOUT"));
      }, options.timeoutMs ?? this.timeoutMs);
      const pending: PendingRequest = {
        operation,
        resolve: (value) => resolve(value as RuntimeOperationOutput<Name>),
        reject,
        timeout,
        signal: options.signal,
      };
      if (options.signal) {
        pending.onAbort = () => {
          this.port.postMessage({ kind: "cancel", id });
          this.settle(id, new Error("RUN_CANCELED", { cause: options.signal?.reason }));
        };
        options.signal.addEventListener("abort", pending.onAbort, { once: true });
      }
      this.pending.set(id, pending);
      this.port.postMessage(message);
    });
  }

  subscribeIssue(
    issueId: string,
    cursor: number,
    listener: (event: IssueEventEnvelope) => void,
  ): () => void {
    if (this.exited) throw new Error("UTILITY_PROCESS_EXITED");
    const subscriptionId = this.id();
    const message = utilityRequestSchema.parse({
      kind: "subscribe",
      subscriptionId,
      issueId,
      cursor,
    });
    this.subscriptions.set(subscriptionId, listener);
    this.port.postMessage(message);
    return () => {
      if (!this.subscriptions.delete(subscriptionId)) return;
      this.port.postMessage({ kind: "unsubscribe", subscriptionId });
    };
  }

  dispose(): void {
    this.onExit(-1);
    this.port.off?.("message", this.onMessage);
    this.port.off?.("exit", this.onExit);
  }

  private readonly onMessage = (rawMessage: unknown): void => {
    const parsed = utilityResponseSchema.safeParse(rawMessage);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.kind === "ready") {
      if (!this.readySettled) {
        this.readySettled = true;
        this.resolveReady();
      }
      return;
    }
    if (message.kind === "runtime-error") {
      if (!this.readySettled) {
        this.readySettled = true;
        this.rejectReady(new Error(`UTILITY_RUNTIME_ERROR:${message.message}`));
      }
      return;
    }
    if (message.kind === "response") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      if (!message.ok) {
        this.settle(message.id, new Error(`${message.error.code}:${message.error.message}`));
        return;
      }
      try {
        const definition = runtimeOperations[pending.operation];
        this.settle(message.id, undefined, definition.output.parse(message.value));
      } catch (error) {
        this.settle(message.id, new Error("INVALID_RESPONSE", { cause: error }));
      }
      return;
    }
    if (message.kind === "event") {
      this.subscriptions.get(message.subscriptionId)?.({
        issueId: message.issueId,
        cursor: message.cursor,
        events: message.events,
      });
    }
  };

  private readonly onExit = (code: number): void => {
    if (this.exited) return;
    this.exited = true;
    if (!this.readySettled) {
      this.readySettled = true;
      this.rejectReady(new Error(`UTILITY_PROCESS_EXITED:${code}`));
    }
    for (const id of [...this.pending.keys()]) {
      this.settle(id, new Error(`UTILITY_PROCESS_EXITED:${code}`));
    }
    this.subscriptions.clear();
  };

  private settle(id: string, error?: Error, value?: unknown): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timeout);
    if (pending.signal && pending.onAbort) {
      pending.signal.removeEventListener("abort", pending.onAbort);
    }
    if (error) pending.reject(error);
    else pending.resolve(value);
  }
}

export function createRuntimeClient(
  port: RuntimeClientPort,
  options?: RuntimeClientOptions,
): RuntimeClient {
  return new RuntimeClient(port, options);
}
