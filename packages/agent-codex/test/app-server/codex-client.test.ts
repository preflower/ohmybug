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
  it("starts a thread and normalizes only its owned turn", async () => {
    const rpc = new FixtureConnection();
    rpc.respond("thread/start", { thread: { id: "thread-1" } });
    rpc.respond("turn/start", { turn: { id: "turn-runtime" } });
    const client = new AppServerCodexClient(rpc);
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
        item: { type: "agent_message", text: "{\"ok\":true}" },
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
    const client = new AppServerCodexClient(rpc);
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
      item: { type: "agent_message", text: "early answer" },
    });
  });

  it("interrupts the exact turn once when cancellation arrives", async () => {
    const rpc = new FixtureConnection();
    rpc.respond("thread/resume", { thread: { id: "thread-1" } });
    rpc.respond("turn/start", { turn: { id: "turn-1" } });
    rpc.respond("turn/interrupt", {});
    const client = new AppServerCodexClient(rpc);
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

  it("preserves private temp isolation and cleans the owned directory", async () => {
    const temporary = await createTempDir("oh-my-bug-app-client-");
    cleanups.push(temporary.cleanup);
    const projectDirectory = join(temporary.path, "project");
    await mkdir(projectDirectory);
    const rpc = new FixtureConnection();
    rpc.respond("thread/start", { thread: { id: "thread-1" } });
    rpc.respond("turn/start", { turn: { id: "turn-1" } });
    const client = new AppServerCodexClient(rpc, {
      environment: { TMPDIR: "/baseline/tmp", TMP: "/baseline/tmp", TEMP: "/baseline/tmp" },
    });
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
    await expect(access(privateTemp)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("restores baseline temp variables after a workspace-write turn", async () => {
    const temporary = await createTempDir("oh-my-bug-app-client-baseline-");
    cleanups.push(temporary.cleanup);
    const projectDirectory = join(temporary.path, "project");
    await mkdir(projectDirectory);
    const rpc = new FixtureConnection();
    rpc.respond("thread/start", { thread: { id: "thread-1" } });
    rpc.respond("thread/resume", { thread: { id: "thread-1" } });
    rpc.respond("turn/start", { turn: { id: "turn-1" } });
    const baseline = { TMPDIR: "/baseline/tmpdir", TMP: "/baseline/tmp", TEMP: "/baseline/temp" };
    const client = new AppServerCodexClient(rpc, { environment: baseline });

    const writable = client.startThread(threadOptions(projectDirectory, "workspace-write"));
    const writableStream = await writable.runStreamed("Write", { outputSchema: {} });
    rpc.emit({
      method: "turn/completed",
      params: { threadId: "thread-1", turn: turn("turn-1", "completed") },
    });
    await collect(writableStream);

    const readonly = client.resumeThread("thread-1", threadOptions(projectDirectory));
    const readonlyStream = await readonly.runStreamed("Read", { outputSchema: {} });
    const resume = rpc.calls.find(({ method }) => method === "thread/resume")!;
    expect(resume.params).toMatchObject({
      config: { shell_environment_policy: { inherit: "all", set: baseline } },
    });
    rpc.emit({
      method: "turn/completed",
      params: { threadId: "thread-1", turn: turn("turn-1", "completed") },
    });
    await collect(readonlyStream);
  });

  it("fails an owned turn when the App Server disconnects before completion", async () => {
    const rpc = new FixtureConnection();
    rpc.respond("thread/start", { thread: { id: "thread-1" } });
    rpc.respond("turn/start", { turn: { id: "turn-1" } });
    const client = new AppServerCodexClient(rpc);
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
    const client = new AppServerCodexClient(rpc);
    const thread = client.resumeThread("thread-missing", threadOptions("/repo"));

    await expect(thread.runStreamed("Continue", { outputSchema: {} })).rejects.toMatchObject({
      code: "NATIVE_THREAD_UNAVAILABLE",
      threadId: "thread-missing",
    });
  });
});

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
    skipGitRepoCheck: true,
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
