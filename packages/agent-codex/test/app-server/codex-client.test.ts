import { access, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AppServerCodexClient } from "../../src/app-server/codex-client.js";
import type {
  AppServerMethods,
  JsonRpcNotification,
} from "../../src/app-server/protocol.js";
import type { AppServerConnection } from "../../src/app-server/supervisor.js";
import { createTempDir } from "../helpers.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe("App Server Codex client", () => {
  it("normalizes public CLI activity from the owned turn", async () => {
    const rpc = new FixtureConnection();
    rpc.respond("thread/start", { thread: { id: "thread-1" } });
    rpc.respond("turn/start", { turn: { id: "turn-1" } });
    const client = fixtureClient(rpc);
    const thread = client.startThread(threadOptions("/repo"));
    const stream = await thread.runStreamed("Inspect checkout", { outputSchema: {} });
    const collecting = collect(stream);

    rpc.emit({
      method: "item/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        completedAtMs: 1,
        item: {
          type: "agentMessage",
          id: "commentary-1",
          text: "I’ll inspect the checkout path first.",
          phase: "commentary",
          memoryCitation: null,
        },
      },
    });
    rpc.emit({
      method: "item/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        completedAtMs: 2,
        item: {
          type: "reasoning",
          id: "reasoning-1",
          summary: ["Tracing checkout hydration"],
          content: ["private chain of thought"],
        },
      },
    });
    rpc.emit({
      method: "item/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        startedAtMs: 3,
        item: {
          type: "commandExecution",
          id: "command-1",
          command: "rg -n checkout src",
          commandActions: [{ type: "search", command: "rg -n checkout src", query: "checkout", path: "src" }],
          cwd: "/repo",
          status: "inProgress",
          aggregatedOutput: null,
        },
      },
    });
    rpc.emit({
      method: "item/commandExecution/outputDelta",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "command-1",
        delta: "src/checkout.ts:42\n",
      },
    });
    rpc.emit({
      method: "turn/plan/updated",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        explanation: "Checkout path located",
        plan: [
          { step: "Trace checkout", status: "completed" },
          { step: "Fix hydration", status: "inProgress" },
        ],
      },
    });
    rpc.emit({
      method: "item/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        startedAtMs: 4,
        item: {
          type: "collabAgentToolCall",
          id: "wait-1",
          tool: "wait",
          status: "inProgress",
          senderThreadId: "thread-1",
          receiverThreadIds: ["thread-child"],
          agentsStates: {},
          model: null,
          reasoningEffort: null,
          prompt: null,
        },
      },
    });
    rpc.emit({
      method: "turn/completed",
      params: { threadId: "thread-1", turn: turn("turn-1", "completed") },
    });

    await expect(collecting).resolves.toEqual([
      { type: "thread.started", threadId: "thread-1" },
      { type: "turn.started", threadId: "thread-1", turnId: "turn-1" },
      {
        type: "item.completed",
        threadId: "thread-1",
        turnId: "turn-1",
        item: {
          type: "agent_message",
          id: "commentary-1",
          text: "I’ll inspect the checkout path first.",
          phase: "commentary",
        },
      },
      {
        type: "item.completed",
        threadId: "thread-1",
        turnId: "turn-1",
        item: { type: "reasoning", id: "reasoning-1", summary: "Tracing checkout hydration" },
      },
      {
        type: "item.started",
        threadId: "thread-1",
        turnId: "turn-1",
        item: {
          type: "command_execution",
          id: "command-1",
          command: "rg -n checkout src",
          status: "in_progress",
          output: "",
          actions: [{ type: "search", query: "checkout", path: "src" }],
        },
      },
      {
        type: "item.updated",
        threadId: "thread-1",
        turnId: "turn-1",
        item: { type: "command_output", id: "command-1", delta: "src/checkout.ts:42\n" },
      },
      {
        type: "item.updated",
        threadId: "thread-1",
        turnId: "turn-1",
        item: {
          type: "plan",
          explanation: "Checkout path located",
          steps: [
            { step: "Trace checkout", status: "completed" },
            { step: "Fix hydration", status: "in_progress" },
          ],
        },
      },
      {
        type: "item.started",
        threadId: "thread-1",
        turnId: "turn-1",
        item: { type: "collaboration", id: "wait-1", tool: "wait", status: "in_progress" },
      },
      { type: "turn.completed", threadId: "thread-1", turnId: "turn-1" },
    ]);
  });

  it("starts a thread and normalizes only its owned turn", async () => {
    const rpc = new FixtureConnection();
    rpc.respond("thread/start", { thread: { id: "thread-1" } });
    rpc.respond("turn/start", { turn: { id: "turn-runtime" } });
    const client = fixtureClient(rpc);
    const thread = client.startThread(threadOptions("/repo"));
    const stream = await thread.runStreamed("Fix checkout", { outputSchema: { type: "object" } });
    const collecting = collect(stream);

    rpc.emit({
      method: "item/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-external",
        completedAtMs: 1,
        item: { type: "agentMessage", id: "external", text: "wrong", phase: null, memoryCitation: null },
      },
    });
    rpc.emit({
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: turn("turn-external", "completed"),
      },
    });
    rpc.emit({
      method: "item/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-runtime",
        completedAtMs: 2,
        item: { type: "agentMessage", id: "answer", text: "{\"ok\":true}", phase: null, memoryCitation: null },
      },
    });
    rpc.emit({
      method: "turn/completed",
      params: { threadId: "thread-1", turn: turn("turn-runtime", "completed") },
    });

    await expect(collecting).resolves.toEqual([
      { type: "thread.started", threadId: "thread-1" },
      { type: "turn.started", threadId: "thread-1", turnId: "turn-runtime" },
      {
        type: "item.completed",
        threadId: "thread-1",
        turnId: "turn-runtime",
        item: { type: "agent_message", id: "answer", text: "{\"ok\":true}" },
      },
      { type: "turn.completed", threadId: "thread-1", turnId: "turn-runtime" },
    ]);
    expect(rpc.calls).toEqual([
      expect.objectContaining({ method: "thread/start", params: expect.objectContaining({ cwd: "/repo" }) }),
      {
        method: "turn/start",
        params: expect.objectContaining({
          threadId: "thread-1",
          input: [{ type: "text", text: "Fix checkout", text_elements: [] }],
          outputSchema: { type: "object" },
        }),
      },
    ]);
  });

  it("preserves owned notifications delivered before turn/start responds", async () => {
    const rpc = new FixtureConnection();
    rpc.respond("thread/start", { thread: { id: "thread-1" } });
    rpc.respond("turn/start", { turn: { id: "turn-early" } });
    rpc.beforeResponse("turn/start", () => {
      rpc.emit({
        method: "item/completed",
        params: {
          threadId: "thread-1",
          turnId: "turn-early",
          completedAtMs: 1,
          item: { type: "agentMessage", id: "early", text: "early answer", phase: null, memoryCitation: null },
        },
      });
    });
    const client = fixtureClient(rpc);
    const thread = client.startThread(threadOptions("/repo"));

    const stream = await thread.runStreamed("Fix checkout", { outputSchema: {} });
    rpc.emit({
      method: "turn/completed",
      params: { threadId: "thread-1", turn: turn("turn-early", "completed") },
    });

    await expect(collect(stream)).resolves.toContainEqual({
      type: "item.completed",
      threadId: "thread-1",
      turnId: "turn-early",
      item: { type: "agent_message", id: "early", text: "early answer" },
    });
  });

  it("interrupts the exact turn once when cancellation arrives", async () => {
    const rpc = new FixtureConnection();
    rpc.respond("thread/resume", { thread: { id: "thread-1" } });
    rpc.respond("turn/start", { turn: { id: "turn-1" } });
    rpc.respond("turn/interrupt", {});
    const client = fixtureClient(rpc);
    const abort = new AbortController();
    const thread = client.resumeThread("thread-1", threadOptions("/repo"));
    const stream = await thread.runStreamed("Continue", { outputSchema: {}, signal: abort.signal });
    const collecting = collect(stream);
    abort.abort("USER_CANCELED");
    rpc.emit({
      method: "turn/completed",
      params: { threadId: "thread-1", turn: turn("turn-1", "interrupted") },
    });

    await expect(collecting).rejects.toThrow("RUN_CANCELED");
    expect(rpc.calls.filter(({ method }) => method === "turn/interrupt")).toEqual([{
      method: "turn/interrupt",
      params: { threadId: "thread-1", turnId: "turn-1" },
    }]);
  });

  it("cleans the session-stable private temp when the thread is disposed", async () => {
    const temporary = await createTempDir("oh-my-bug-app-client-");
    cleanups.push(temporary.cleanup);
    const projectDirectory = join(temporary.path, "project");
    await mkdir(projectDirectory);
    const rpc = new FixtureConnection();
    rpc.respond("thread/start", { thread: { id: "thread-1" } });
    rpc.respond("turn/start", { turn: { id: "turn-1" } });
    const client = new AppServerCodexClient(rpc);
    const thread = client.startThread(threadOptions(projectDirectory, "workspace-write"));
    const [privateTempName] = (await readdir(projectDirectory))
      .filter((entry) => entry.startsWith(".oh-my-bug-tmp-"));
    expect(privateTempName).toBeDefined();
    const privateTemp = join(projectDirectory, privateTempName!);

    const stream = await thread.runStreamed("Write", { outputSchema: {} });
    const start = rpc.calls.find(({ method }) => method === "thread/start")!;
    expect(start.params).toMatchObject({
      config: {
        sandbox_workspace_write: {
          exclude_slash_tmp: true,
          exclude_tmpdir_env_var: true,
        },
        shell_environment_policy: {
          inherit: "all",
          set: { TMPDIR: privateTemp, TMP: privateTemp, TEMP: privateTemp },
        },
      },
    });
    rpc.emit({
      method: "turn/completed",
      params: { threadId: "thread-1", turn: turn("turn-1", "completed") },
    });
    await collect(stream);
    await thread.dispose();
    await expect(access(privateTemp)).rejects.toMatchObject({ code: "ENOENT" });
    await client.dispose();
    await expect(access(privateTemp)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("recreates the same private temp when a later turn changes sandbox mode", async () => {
    const temporary = await createTempDir("oh-my-bug-app-client-baseline-");
    cleanups.push(temporary.cleanup);
    const projectDirectory = join(temporary.path, "project");
    await mkdir(projectDirectory);
    const rpc = new FixtureConnection();
    rpc.respond("thread/start", { thread: { id: "thread-1" } });
    rpc.respond("thread/resume", { thread: { id: "thread-1" } });
    rpc.respond("turn/start", { turn: { id: "turn-1" } });
    const client = new AppServerCodexClient(rpc);

    const writable = client.startThread(threadOptions(projectDirectory, "workspace-write"));
    const writableStream = await writable.runStreamed("Write", { outputSchema: {} });
    rpc.emit({
      method: "turn/completed",
      params: { threadId: "thread-1", turn: turn("turn-1", "completed") },
    });
    await collect(writableStream);
    const start = rpc.calls.find(({ method }) => method === "thread/start")!;
    const stableTemp = (start.params as {
      config: { shell_environment_policy: { set: { TMPDIR: string } } };
    }).config.shell_environment_policy.set.TMPDIR;
    await writable.dispose();
    await expect(access(stableTemp)).rejects.toMatchObject({ code: "ENOENT" });

    const readonly = client.resumeThread("thread-1", threadOptions(projectDirectory));
    await expect(access(stableTemp)).resolves.toBeUndefined();
    const readonlyStream = await readonly.runStreamed("Read", { outputSchema: {} });
    const resume = rpc.calls.find(({ method }) => method === "thread/resume")!;
    expect(resume.params).toMatchObject({
      config: {
        shell_environment_policy: {
          inherit: "all",
          set: { TMPDIR: stableTemp, TMP: stableTemp, TEMP: stableTemp },
        },
      },
    });
    rpc.emit({
      method: "turn/completed",
      params: { threadId: "thread-1", turn: turn("turn-1", "completed") },
    });
    await collect(readonlyStream);
    await readonly.dispose();
    await expect(access(stableTemp)).rejects.toMatchObject({ code: "ENOENT" });
    await client.dispose();
    await expect(access(stableTemp)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails an owned turn when the App Server disconnects before completion", async () => {
    const rpc = new FixtureConnection();
    rpc.respond("thread/start", { thread: { id: "thread-1" } });
    rpc.respond("turn/start", { turn: { id: "turn-1" } });
    const client = fixtureClient(rpc);
    const thread = client.startThread(threadOptions("/repo"));
    const stream = await thread.runStreamed("Fix checkout", { outputSchema: {} });

    await rpc.close();

    await expect(collect(stream)).rejects.toThrow("CODEX_APP_SERVER_DISCONNECTED");
  });

  it("maps a missing resumed rollout without replacing its thread id", async () => {
    const rpc = new FixtureConnection();
    rpc.reject("thread/resume", new Error(
      "CODEX_APP_SERVER_RPC_ERROR:-32600:no rollout found for thread id thread-missing",
    ));
    const client = fixtureClient(rpc);
    const thread = client.resumeThread("thread-missing", threadOptions("/repo"));

    await expect(thread.runStreamed("Continue", { outputSchema: {} })).rejects.toMatchObject({
      code: "NATIVE_THREAD_UNAVAILABLE",
      threadId: "thread-missing",
    });
  });
});

function fixtureClient(rpc: AppServerConnection): AppServerCodexClient {
  return new AppServerCodexClient(rpc, {
    ensurePrivateTemp: (workingDirectory) => join(workingDirectory, ".oh-my-bug-tmp-fixture"),
  });
}

class FixtureConnection implements AppServerConnection {
  readonly calls: Array<{ method: keyof AppServerMethods; params: unknown }> = [];
  private readonly responses = new Map<keyof AppServerMethods, unknown>();
  private readonly errors = new Map<keyof AppServerMethods, Error>();
  private readonly beforeResponses = new Map<keyof AppServerMethods, () => void>();
  private readonly queue = new NotificationQueue();

  initialize = vi.fn(async () => undefined);
  close = vi.fn(async () => this.queue.close());

  respond<Name extends keyof AppServerMethods>(
    method: Name,
    value: AppServerMethods[Name]["output"],
  ): void {
    this.responses.set(method, value);
  }

  reject(method: keyof AppServerMethods, error: Error): void { this.errors.set(method, error); }
  beforeResponse(method: keyof AppServerMethods, callback: () => void): void {
    this.beforeResponses.set(method, callback);
  }
  emit(notification: JsonRpcNotification): void { this.queue.push(notification); }

  async request<Name extends keyof AppServerMethods>(
    method: Name,
    params: AppServerMethods[Name]["input"],
  ): Promise<AppServerMethods[Name]["output"]> {
    this.calls.push({ method, params });
    const error = this.errors.get(method);
    if (error) throw error;
    this.beforeResponses.get(method)?.();
    await new Promise<void>((resolvePromise) => setImmediate(resolvePromise));
    return this.responses.get(method) as AppServerMethods[Name]["output"];
  }

  notifications(): AsyncIterable<JsonRpcNotification> { return this.queue; }
}

class NotificationQueue implements AsyncIterable<JsonRpcNotification> {
  private readonly values: JsonRpcNotification[] = [];
  private readonly waiters: Array<(result: IteratorResult<JsonRpcNotification>) => void> = [];
  private closed = false;

  push(value: JsonRpcNotification): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter({ done: false, value });
    else this.values.push(value);
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ done: true, value: undefined });
  }

  [Symbol.asyncIterator](): AsyncIterator<JsonRpcNotification> {
    return {
      next: async () => {
        const value = this.values.shift();
        if (value) return { done: false, value };
        if (this.closed) return { done: true, value: undefined };
        return new Promise((resolvePromise) => this.waiters.push(resolvePromise));
      },
    };
  }
}

function threadOptions(
  workingDirectory: string,
  sandboxMode: "read-only" | "workspace-write" = "read-only",
) {
  return {
    workingDirectory,
    sandboxMode,
    networkAccessEnabled: false,
    approvalPolicy: "never" as const,
    sessionId: "logical-session-1",
  };
}

function turn(id: string, status: "completed" | "interrupted" | "failed") {
  return {
    id,
    items: [],
    itemsView: "full",
    status,
    error: status === "failed"
      ? { message: "failed", codexErrorInfo: null, additionalDetails: null }
      : null,
    startedAt: 1,
    completedAt: 2,
    durationMs: 1,
  };
}

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const value of values) result.push(value);
  return result;
}
