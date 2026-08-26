import { rm } from "node:fs";

import { z } from "zod";

import {
  NativeThreadUnavailableError,
  type CodexClient,
  type CodexClientEvent,
  type CodexClientItem,
  type CodexThread,
  type CodexThreadOptions,
  type CodexTurnOptions,
} from "../codex-client.js";
import { ensureAgentPrivateTemp } from "../private-temp.js";
import type { JsonValue, TurnStartParams } from "./protocol.js";
import type { AppServerConnection } from "./supervisor.js";

interface TurnSubscription { threadId: string; turnId: string; queue: EventQueue }
interface RoutedNotification {
  threadId: string;
  turnId: string;
  event?: CodexClientEvent;
  done?: boolean;
  error?: Error;
}

const MAX_STARTING_NOTIFICATIONS = 256;

export interface AppServerCodexClientOptions {
  ensurePrivateTemp?: typeof ensureAgentPrivateTemp;
}

export class AppServerCodexClient implements CodexClient {
  private readonly subscriptions = new Map<string, TurnSubscription>();
  private readonly startingNotifications = new Map<string, RoutedNotification[]>();
  private readonly privateTemps = new Map<string, number>();
  private readonly ensurePrivateTemp: typeof ensureAgentPrivateTemp;
  private disposed = false;

  constructor(
    private readonly connection: AppServerConnection,
    options: AppServerCodexClientOptions = {},
  ) {
    this.ensurePrivateTemp = options.ensurePrivateTemp ?? ensureAgentPrivateTemp;
    void this.pumpNotifications();
  }

  startThread(options: CodexThreadOptions): CodexThread {
    return this.createThread(undefined, options);
  }

  resumeThread(threadId: string, options: CodexThreadOptions): CodexThread {
    return this.createThread(threadId, options);
  }

  private createThread(threadId: string | undefined, options: CodexThreadOptions): CodexThread {
    if (this.disposed) throw new Error("CODEX_APP_SERVER_CLIENT_DISPOSED");
    const privateTemp = this.ensurePrivateTemp(options.workingDirectory, options.sessionId);
    this.privateTemps.set(privateTemp, (this.privateTemps.get(privateTemp) ?? 0) + 1);
    return new AppServerThread(
      this,
      threadId,
      options,
      privateTemp,
      () => this.releasePrivateTemp(privateTemp),
    );
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    let failure: unknown;
    for (const path of this.privateTemps.keys()) {
      try {
        await removePrivateTemp(path);
      } catch (error) {
        failure ??= error;
      }
    }
    this.privateTemps.clear();
    if (failure) throw failure;
  }

  private async releasePrivateTemp(path: string): Promise<void> {
    const references = this.privateTemps.get(path);
    if (references === undefined) return;
    if (references > 1) {
      this.privateTemps.set(path, references - 1);
      return;
    }
    await removePrivateTemp(path);
    this.privateTemps.delete(path);
  }

  async startTurn(
    requestedThreadId: string | undefined,
    threadOptions: CodexThreadOptions,
    privateTemp: string,
    prompt: string,
    turnOptions: CodexTurnOptions,
  ): Promise<{ threadId: string; events: AsyncIterable<CodexClientEvent> }> {
    let threadId: string;
    try {
      const params = threadParams(threadOptions, privateTemp);
      const response = requestedThreadId
        ? await this.connection.request("thread/resume", { threadId: requestedThreadId, ...params })
        : await this.connection.request("thread/start", params);
      threadId = response.thread.id;
    } catch (error) {
      if (requestedThreadId && isMissingRollout(error, requestedThreadId)) {
        throw new NativeThreadUnavailableError(requestedThreadId, { cause: error });
      }
      throw error;
    }
    if (requestedThreadId && threadId !== requestedThreadId) throw new Error("AGENT_SESSION_MISMATCH");
    this.startingNotifications.set(threadId, []);
    try {
      const response = await this.connection.request("turn/start", {
        threadId,
        input: [{ type: "text", text: prompt, text_elements: [] }],
        cwd: threadOptions.workingDirectory,
        approvalPolicy: threadOptions.approvalPolicy,
        sandboxPolicy: sandboxPolicy(threadOptions),
        ...(threadOptions.model ? { model: threadOptions.model } : {}),
        outputSchema: turnOptions.outputSchema as JsonValue,
      });
      const turnId = response.turn.id;
      const key = subscriptionKey(threadId, turnId);
      const queue = new EventQueue();
      this.subscriptions.set(key, { threadId, turnId, queue });
      queue.push({ type: "thread.started", threadId });
      queue.push({ type: "turn.started", threadId, turnId });
      this.installCancellation(threadId, turnId, queue, turnOptions.signal);
      for (const routed of this.startingNotifications.get(threadId) ?? []) {
        if (subscriptionKey(routed.threadId, routed.turnId) === key) this.deliver(routed);
      }
      return { threadId, events: queue };
    } finally {
      this.startingNotifications.delete(threadId);
    }
  }

  private installCancellation(
    threadId: string,
    turnId: string,
    queue: EventQueue,
    signal: AbortSignal | undefined,
  ): void {
    if (!signal) return;
    let interrupted = false;
    const interrupt = () => {
      if (interrupted) return;
      interrupted = true;
      void this.connection.request("turn/interrupt", { threadId, turnId }).catch((error) => {
        queue.fail(error instanceof Error ? error : new Error(String(error)));
      });
    };
    if (signal.aborted) interrupt();
    else signal.addEventListener("abort", interrupt, { once: true });
    queue.onClose(() => signal.removeEventListener("abort", interrupt));
    queue.setAbortSignal(signal);
  }

  private async pumpNotifications(): Promise<void> {
    try {
      for await (const notification of this.connection.notifications()) {
        const routed = parseRoutedNotification(notification);
        if (!routed) continue;
        const key = subscriptionKey(routed.threadId, routed.turnId);
        const subscription = this.subscriptions.get(key);
        if (subscription) {
          this.deliver(routed);
          continue;
        }
        const pending = this.startingNotifications.get(routed.threadId);
        if (!pending) continue;
        if (pending.length === MAX_STARTING_NOTIFICATIONS) pending.shift();
        pending.push(routed);
      }
      this.failSubscriptions(new Error("CODEX_APP_SERVER_DISCONNECTED"));
    } catch (error) {
      this.failSubscriptions(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private deliver(routed: RoutedNotification): void {
    const key = subscriptionKey(routed.threadId, routed.turnId);
    const subscription = this.subscriptions.get(key);
    if (!subscription) return;
    if (routed.event) subscription.queue.push(routed.event);
    if (!routed.done) return;
    this.subscriptions.delete(key);
    if (routed.error) subscription.queue.fail(routed.error);
    else subscription.queue.close();
  }

  private failSubscriptions(error: Error): void {
    for (const subscription of this.subscriptions.values()) subscription.queue.fail(error);
    this.subscriptions.clear();
  }
}

class AppServerThread implements CodexThread {
  private threadId: string | null;
  private disposed = false;

  constructor(
    private readonly client: AppServerCodexClient,
    requestedThreadId: string | undefined,
    private readonly threadOptions: CodexThreadOptions,
    private readonly privateTemp: string,
    private readonly releasePrivateTemp: () => Promise<void>,
  ) { this.threadId = requestedThreadId ?? null; }

  get id(): string | null { return this.threadId; }

  async runStreamed(prompt: string, options: CodexTurnOptions): Promise<AsyncIterable<CodexClientEvent>> {
    const started = await this.client.startTurn(
      this.threadId ?? undefined,
      this.threadOptions,
      this.privateTemp,
      prompt,
      options,
    );
    this.threadId = started.threadId;
    return started.events;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.releasePrivateTemp();
  }
}

function threadParams(
  options: CodexThreadOptions,
  privateTemp: string,
) {
  return {
    ...(options.model ? { model: options.model } : {}),
    cwd: options.workingDirectory,
    approvalPolicy: options.approvalPolicy,
    sandbox: options.sandboxMode,
    config: {
      sandbox_workspace_write: { exclude_slash_tmp: true, exclude_tmpdir_env_var: true },
      shell_environment_policy: {
        inherit: "all",
        set: { TMPDIR: privateTemp, TMP: privateTemp, TEMP: privateTemp },
      },
    },
  } as const;
}

function removePrivateTemp(path: string): Promise<void> {
  return new Promise<void>((resolvePromise, rejectPromise) => {
    rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 },
      (error) => error ? rejectPromise(error) : resolvePromise());
  });
}

function sandboxPolicy(options: CodexThreadOptions): TurnStartParams["sandboxPolicy"] {
  if (options.sandboxMode === "danger-full-access") return { type: "dangerFullAccess" };
  if (options.sandboxMode === "read-only") {
    return { type: "readOnly", networkAccess: options.networkAccessEnabled };
  }
  return {
    type: "workspaceWrite",
    writableRoots: [options.workingDirectory],
    networkAccess: options.networkAccessEnabled,
    excludeTmpdirEnvVar: true,
    excludeSlashTmp: true,
  };
}

const turnSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["completed", "interrupted", "failed", "inProgress"]),
  error: z.object({ message: z.string() }).passthrough().nullable(),
}).passthrough();
const correlatedSchema = z.object({ threadId: z.string().min(1), turnId: z.string().min(1) }).passthrough();
const itemSchema = z.object({ type: z.string(), id: z.string().optional() }).passthrough();

function parseRoutedNotification(
  notification: { method: string; params: unknown },
): RoutedNotification | undefined {
  if (notification.method === "item/started" || notification.method === "item/completed") {
    const params = correlatedSchema.extend({ item: itemSchema }).parse(notification.params);
    return {
      threadId: params.threadId,
      turnId: params.turnId,
      event: {
        type: notification.method === "item/started" ? "item.started" : "item.completed",
        threadId: params.threadId,
        turnId: params.turnId,
        item: normalizeItem(params.item),
      },
    };
  }
  if (notification.method === "turn/completed") {
    const params = z.object({ threadId: z.string().min(1), turn: turnSchema }).passthrough()
      .parse(notification.params);
    const turnId = params.turn.id;
    if (params.turn.status === "completed") {
      return {
        threadId: params.threadId,
        turnId,
        event: { type: "turn.completed", threadId: params.threadId, turnId },
        done: true,
      };
    }
    const message = params.turn.error?.message ?? (
      params.turn.status === "interrupted" ? "RUN_CANCELED" : "CODEX_TURN_FAILED"
    );
    return {
      threadId: params.threadId,
      turnId,
      event: { type: "turn.failed", threadId: params.threadId, turnId, message },
      done: true,
      error: params.turn.status === "interrupted" ? new Error("RUN_CANCELED") : undefined,
    };
  }
  if (notification.method === "error") {
    const params = correlatedSchema.extend({
      error: z.object({ message: z.string() }).passthrough(),
      willRetry: z.boolean(),
    }).parse(notification.params);
    return {
      threadId: params.threadId,
      turnId: params.turnId,
      event: {
        type: "error",
        threadId: params.threadId,
        turnId: params.turnId,
        message: params.error.message,
      },
      done: !params.willRetry,
      error: params.willRetry ? undefined : new Error(params.error.message),
    };
  }
  return undefined;
}

function normalizeItem(item: z.infer<typeof itemSchema>): CodexClientItem {
  if (item.type === "agentMessage" && typeof item.text === "string") {
    return { type: "agent_message", text: item.text };
  }
  if (item.type === "reasoning") {
    const summary = Array.isArray(item.summary) ? item.summary.filter(isString) : [];
    const content = Array.isArray(item.content) ? item.content.filter(isString) : [];
    return { type: "reasoning", text: [...summary, ...content].join("\n") };
  }
  if (item.type === "commandExecution" && typeof item.command === "string") {
    const status = item.status === "inProgress" ? "in_progress"
      : item.status === "completed" ? "completed" : "failed";
    return {
      type: "command_execution",
      ...(item.id ? { id: item.id } : {}),
      command: item.command,
      status,
      output: typeof item.aggregatedOutput === "string" ? item.aggregatedOutput : "",
    };
  }
  if (item.type === "fileChange") {
    const changes = Array.isArray(item.changes) ? item.changes : [];
    return {
      type: "file_change",
      status: item.status === "completed" ? "completed" : "failed",
      paths: changes.flatMap((change) => (
        change && typeof change === "object" && "path" in change && typeof change.path === "string"
          ? [change.path]
          : []
      )),
    };
  }
  return { type: "other", name: item.type };
}

class EventQueue implements AsyncIterable<CodexClientEvent> {
  private readonly values: CodexClientEvent[] = [];
  private readonly waiters: Array<{ resolve(result: IteratorResult<CodexClientEvent>): void; reject(error: Error): void }> = [];
  private closeListeners: Array<() => void> = [];
  private failure?: Error;
  private closed = false;
  private abortSignal?: AbortSignal;

  push(value: CodexClientEvent): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve({ done: false, value });
    else this.values.push(value);
  }
  fail(error: Error): void {
    if (this.closed) return;
    this.failure = this.abortSignal?.aborted
      ? new Error("RUN_CANCELED", { cause: this.abortSignal.reason })
      : error;
    this.finish();
  }
  close(): void { if (!this.closed) this.finish(); }
  setAbortSignal(signal: AbortSignal): void { this.abortSignal = signal; }
  onClose(listener: () => void): void { this.closeListeners.push(listener); }
  [Symbol.asyncIterator](): AsyncIterator<CodexClientEvent> {
    return {
      next: async () => {
        const value = this.values.shift();
        if (value) return { done: false, value };
        if (this.failure) throw this.failure;
        if (this.closed) return { done: true, value: undefined };
        return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
      },
    };
  }
  private finish(): void {
    this.closed = true;
    for (const listener of this.closeListeners.splice(0)) listener();
    for (const waiter of this.waiters.splice(0)) {
      if (this.failure) waiter.reject(this.failure);
      else waiter.resolve({ done: true, value: undefined });
    }
  }
}

function subscriptionKey(threadId: string, turnId: string): string { return `${threadId}\u0000${turnId}`; }
function isString(value: unknown): value is string { return typeof value === "string"; }
function isMissingRollout(error: unknown, threadId: string): boolean {
  return error instanceof Error && /(?:no rollout found|thread[^\n]*not found)/i.test(error.message) &&
    error.message.includes(threadId);
}
