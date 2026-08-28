export interface CodexThreadOptions {
  sessionId: string;
  model?: string;
  workingDirectory: string;
  sandboxMode: "read-only" | "workspace-write" | "danger-full-access";
  networkAccessEnabled: boolean;
  approvalPolicy: "never" | "on-request";
  approvalsReviewer?: "user" | "auto_review";
}

export interface CodexTurnOptions { outputSchema: unknown; signal?: AbortSignal }

export type CodexCommandAction =
  | { type: "read"; name: string; path: string }
  | { type: "list_files"; path?: string }
  | { type: "search"; query?: string; path?: string }
  | { type: "unknown" };

export type CodexClientItem =
  | { type: "agent_message"; id?: string; text: string; phase?: "commentary" | "final_answer" }
  | { type: "reasoning"; id?: string; summary: string }
  | { type: "command_execution"; id?: string; command: string; status: "in_progress" | "completed" | "failed"; output: string; actions: CodexCommandAction[] }
  | { type: "command_output"; id: string; delta: string }
  | { type: "plan"; explanation?: string; steps: Array<{ step: string; status: "pending" | "in_progress" | "completed" }> }
  | { type: "collaboration"; id?: string; tool: string; status: "in_progress" | "completed" | "failed" }
  | { type: "file_change"; status: "completed" | "failed"; paths: string[] }
  | { type: "error"; message: string }
  | { type: "other"; id?: string; name: string };

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
