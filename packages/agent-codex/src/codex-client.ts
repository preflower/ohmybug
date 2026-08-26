export interface CodexThreadOptions {
  model?: string;
  workingDirectory: string;
  sandboxMode: "read-only" | "workspace-write" | "danger-full-access";
  networkAccessEnabled: boolean;
  approvalPolicy: "never";
  skipGitRepoCheck?: boolean;
}

export interface CodexTurnOptions { outputSchema: unknown; signal?: AbortSignal }

export type CodexClientItem =
  | { type: "agent_message"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "command_execution"; id?: string; command: string; status: "in_progress" | "completed" | "failed"; output: string }
  | { type: "file_change"; status: "completed" | "failed"; paths: string[] }
  | { type: "error"; message: string }
  | { type: "other"; name: string };

export type CodexClientEvent =
  | { type: "thread.started"; threadId: string }
  | { type: "turn.started"; threadId: string; turnId: string }
  | { type: "turn.completed"; threadId: string; turnId: string }
  | { type: "turn.failed"; threadId: string; turnId: string; message: string }
  | { type: "error"; message: string; threadId?: string; turnId?: string }
  | { type: "cleanup.failed"; message: string }
  | { type: "item.started" | "item.updated" | "item.completed"; threadId: string; turnId: string; item: CodexClientItem };

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

export function isNativeThreadUnavailableError(error: unknown): error is NativeThreadUnavailableError {
  return error instanceof NativeThreadUnavailableError;
}

export function cleanupMessage(error: unknown): string {
  if (!(error instanceof Error)) return "AGENT_TEMP_CLEANUP_FAILED";
  const code = "code" in error && typeof error.code === "string" ? `${error.code}: ` : "";
  return `${code}${error.message}`.slice(0, 2_000);
}

export function attachCleanupError(primaryError: unknown, cleanupError: unknown): void {
  if (primaryError instanceof NativeThreadUnavailableError) {
    primaryError.cleanupError = cleanupError;
    return;
  }
  if (!(primaryError instanceof Error) || !Object.isExtensible(primaryError)) return;
  try {
    Object.defineProperty(primaryError, "cleanupError", { configurable: true, value: cleanupError });
  } catch {
    // Preserve the primary run error even when diagnostic attachment is unavailable.
  }
}
