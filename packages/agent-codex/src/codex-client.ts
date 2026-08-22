import {
  Codex,
  type Thread,
  type ThreadEvent,
  type ThreadItem,
  type ThreadOptions,
  type TurnOptions
} from "@openai/codex-sdk";
import { mkdtempSync, rm, rmSync } from "node:fs";
import { join } from "node:path";

import { AGENT_PRIVATE_TEMP_PREFIX, markAgentPrivateTemp } from "./private-temp.js";

export interface CodexThreadOptions {
  model?: string;
  workingDirectory: string;
  sandboxMode: "read-only" | "workspace-write";
  networkAccessEnabled: boolean;
  approvalPolicy: "never";
  skipGitRepoCheck?: boolean;
}

export interface CodexTurnOptions {
  outputSchema: unknown;
  signal?: AbortSignal;
}

export type CodexClientItem =
  | { type: "agent_message"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "command_execution"; command: string; status: "in_progress" | "completed" | "failed"; output: string }
  | { type: "file_change"; status: "completed" | "failed"; paths: string[] }
  | { type: "error"; message: string }
  | { type: "other"; name: string };

export type CodexClientEvent =
  | { type: "thread.started"; threadId: string }
  | { type: "turn.started" }
  | { type: "turn.completed" }
  | { type: "turn.failed"; message: string }
  | { type: "error"; message: string }
  | { type: "item.started" | "item.updated" | "item.completed"; item: CodexClientItem };

export interface CodexThread {
  readonly id: string | null;
  runStreamed(prompt: string, options: CodexTurnOptions): Promise<AsyncIterable<CodexClientEvent>>;
  dispose(): Promise<void>;
}

export interface CodexClient {
  startThread(options: CodexThreadOptions): CodexThread;
  resumeThread(threadId: string, options: CodexThreadOptions): CodexThread;
}

export class NativeThreadUnavailableError extends Error {
  readonly code = "NATIVE_THREAD_UNAVAILABLE";
  cleanupError?: unknown;

  constructor(readonly threadId: string, options?: { cause?: unknown }) {
    super("NATIVE_THREAD_UNAVAILABLE", options);
    this.name = "NativeThreadUnavailableError";
  }
}

export function isNativeThreadUnavailableError(
  error: unknown,
): error is NativeThreadUnavailableError {
  return error instanceof NativeThreadUnavailableError;
}

export class SdkCodexClient implements CodexClient {
  private readonly options: ConstructorParameters<typeof Codex>[0];

  constructor(options: ConstructorParameters<typeof Codex>[0] = {}) {
    this.options = options;
  }

  startThread(options: CodexThreadOptions): CodexThread {
    return this.createThread(options, undefined);
  }

  resumeThread(threadId: string, options: CodexThreadOptions): CodexThread {
    return this.createThread(options, threadId);
  }

  private createThread(options: CodexThreadOptions, threadId: string | undefined): CodexThread {
    const privateTemp = options.sandboxMode === "workspace-write"
      ? mkdtempSync(join(options.workingDirectory, AGENT_PRIVATE_TEMP_PREFIX))
      : undefined;
    try {
      if (privateTemp) markAgentPrivateTemp(privateTemp);
      const client = new Codex({
        ...this.options,
        ...(privateTemp ? { env: privateTempEnvironment(this.options?.env, privateTemp) } : {}),
        config: {
          ...this.options?.config,
          sandbox_workspace_write: {
            exclude_slash_tmp: true,
            exclude_tmpdir_env_var: true
          }
        }
      });
      const thread = threadId
        ? client.resumeThread(threadId, toSdkThreadOptions(options))
        : client.startThread(toSdkThreadOptions(options));
      return new SdkThread(
        thread,
        threadId,
        privateTemp ? () => new Promise<void>((resolvePromise, rejectPromise) => {
          rm(privateTemp, { recursive: true, force: true }, (error) => {
            if (error) rejectPromise(error);
            else resolvePromise();
          });
        }) : undefined
      );
    } catch (error) {
      if (privateTemp) rmSync(privateTemp, { recursive: true, force: true });
      throw error;
    }
  }
}

function privateTempEnvironment(configured: Record<string, string> | undefined, privateTemp: string): Record<string, string> {
  const inherited = configured ?? Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
  return {
    ...inherited,
    TMPDIR: privateTemp,
    TMP: privateTemp,
    TEMP: privateTemp
  };
}

class SdkThread implements CodexThread {
  private cleaned = false;

  constructor(
    private readonly thread: Thread,
    private readonly resumedThreadId?: string,
    private readonly cleanup?: () => Promise<void>
  ) {}

  get id(): string | null {
    return this.thread.id;
  }

  async runStreamed(prompt: string, options: CodexTurnOptions): Promise<AsyncIterable<CodexClientEvent>> {
    try {
      const streamed = await this.thread.runStreamed(prompt, toSdkTurnOptions(options));
      return normalizeEvents(streamed.events, this.resumedThreadId, () => this.finish());
    } catch (error) {
      return await throwPrimaryAfterCleanup(
        normalizeNativeThreadError(error, this.resumedThreadId),
        () => this.finish(),
      );
    }
  }

  async dispose(): Promise<void> {
    await this.finish();
  }

  private async finish(): Promise<void> {
    if (this.cleaned) return;
    this.cleaned = true;
    await this.cleanup?.();
  }
}

function toSdkThreadOptions(options: CodexThreadOptions): ThreadOptions {
  return {
    model: options.model,
    workingDirectory: options.workingDirectory,
    sandboxMode: options.sandboxMode,
    networkAccessEnabled: options.networkAccessEnabled,
    approvalPolicy: options.approvalPolicy,
    skipGitRepoCheck: options.skipGitRepoCheck
  };
}

function toSdkTurnOptions(options: CodexTurnOptions): TurnOptions {
  return { outputSchema: options.outputSchema, signal: options.signal };
}

async function* normalizeEvents(
  events: AsyncIterable<ThreadEvent>,
  resumedThreadId?: string,
  cleanup?: () => Promise<void>
): AsyncGenerator<CodexClientEvent> {
  let cleanupAttempted = false;
  try {
    for await (const event of events) {
      if (event.type === "thread.started") yield { type: event.type, threadId: event.thread_id };
      else if (event.type === "turn.started" || event.type === "turn.completed") yield { type: event.type };
      else if (event.type === "turn.failed") yield { type: event.type, message: event.error.message };
      else if (event.type === "error") yield { type: event.type, message: event.message };
      else yield { type: event.type, item: normalizeItem(event.item) };
    }
  } catch (error) {
    cleanupAttempted = true;
    await throwPrimaryAfterCleanup(normalizeNativeThreadError(error, resumedThreadId), cleanup);
  } finally {
    if (!cleanupAttempted) await cleanup?.();
  }
}

function normalizeNativeThreadError(error: unknown, resumedThreadId?: string): unknown {
  if (!resumedThreadId || !(error instanceof Error)) return error;
  const unavailableMessage = [
    "Codex Exec exited with code 1: Error: thread/resume: thread/resume failed:",
    `no rollout found for thread id ${resumedThreadId} (code -32600)`,
  ].join(" ");
  return error.message.trimEnd() === unavailableMessage
    ? new NativeThreadUnavailableError(resumedThreadId, { cause: error })
    : error;
}

async function throwPrimaryAfterCleanup(
  primaryError: unknown,
  cleanup?: () => Promise<void>,
): Promise<never> {
  try {
    await cleanup?.();
  } catch (cleanupError) {
    attachCleanupError(primaryError, cleanupError);
  }
  throw primaryError;
}

function attachCleanupError(primaryError: unknown, cleanupError: unknown): void {
  if (primaryError instanceof NativeThreadUnavailableError) {
    primaryError.cleanupError = cleanupError;
    return;
  }
  if (!(primaryError instanceof Error) || !Object.isExtensible(primaryError)) return;
  try {
    Object.defineProperty(primaryError, "cleanupError", {
      configurable: true,
      value: cleanupError,
    });
  } catch {
    // Preserve the primary run error even when diagnostic attachment is unavailable.
  }
}

function normalizeItem(item: ThreadItem): CodexClientItem {
  if (item.type === "agent_message") return { type: item.type, text: item.text };
  if (item.type === "reasoning") return { type: item.type, text: item.text };
  if (item.type === "command_execution") {
    return {
      type: item.type,
      command: item.command,
      status: item.status,
      output: item.aggregated_output
    };
  }
  if (item.type === "file_change") {
    return { type: item.type, status: item.status, paths: item.changes.map((change) => change.path) };
  }
  if (item.type === "error") return { type: item.type, message: item.message };
  return { type: "other", name: item.type };
}
