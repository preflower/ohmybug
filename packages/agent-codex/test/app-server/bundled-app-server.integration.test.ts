import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { AppServerCodexClient } from "../../src/app-server/codex-client.js";
import type { JsonRpcNotification, JsonValue } from "../../src/app-server/protocol.js";
import { AppServerRpcClient } from "../../src/app-server/rpc-client.js";
import {
  CodexAppServerSupervisor,
  type AppServerConnection,
} from "../../src/app-server/supervisor.js";
import type { CodexClientEvent } from "../../src/codex-client.js";

const execFileAsync = promisify(execFile);
const integrationDescribe = process.env.OMB_CODEX_APP_SERVER_INTEGRATION === "1"
  ? describe.sequential
  : describe.skip;

integrationDescribe("bundled Codex App Server", () => {
  it("shares one active turn and accepts steering from a second client", async () => {
    await withFixture(async ({ primary, secondary, repository }) => {
      const thread = await primary.request("thread/start", threadStart(repository, "read-only"));
      const started = await primary.request("turn/start", turnStart(
        thread.thread.id,
        repository,
        "Run `sleep 8` with the shell tool. After it finishes, return JSON containing every user message received in this turn.",
      ));
      const collecting = collectTurn(primary, thread.thread.id, started.turn.id);
      try {
        await resumeWhenReadable(secondary, thread.thread.id, repository);
        const steered = await secondary.request("turn/steer", {
          threadId: thread.thread.id,
          expectedTurnId: started.turn.id,
          input: [textInput("SECOND_MESSAGE_SHARED_TURN")],
        });
        const notifications = await collecting;

        expect(steered.turnId).toBe(started.turn.id);
        expect(completedTurnIds(notifications)).toContain(started.turn.id);
        expect(JSON.stringify(notifications)).toContain("SECOND_MESSAGE_SHARED_TURN");
      } catch (error) {
        await primary.request("turn/interrupt", {
          threadId: thread.thread.id,
          turnId: started.turn.id,
        }).catch(() => undefined);
        await collecting.catch(() => undefined);
        throw error;
      }
    });
  }, 60_000);

  it("does not mix a later second-client turn into the first client's result", async () => {
    await withFixture(async ({ primary, secondary, repository }) => {
      const client = new AppServerCodexClient(primary);
      const thread = client.startThread(clientThreadOptions(repository, "read-only"));
      const firstStream = await thread.runStreamed(
        "Return exactly this JSON object: {\"owner\":\"PRIMARY\"}",
        { outputSchema: ownerSchema },
      );
      const firstEvents = await collect(firstStream);
      const threadId = thread.id!;
      const firstTurnId = firstEvents.find((event) => event.type === "turn.started")?.turnId;
      expect(firstTurnId).toBeTruthy();

      await secondary.request("thread/resume", {
        threadId,
        ...threadStart(repository, "read-only"),
      });
      const external = await secondary.request("turn/start", turnStart(
        threadId,
        repository,
        "Return exactly this JSON object: {\"owner\":\"SECONDARY\"}",
        ownerSchema,
      ));
      const externalNotifications = await collectTurn(secondary, threadId, external.turn.id);

      expect(correlatedTurnIds(firstEvents)).toEqual([firstTurnId]);
      expect(JSON.stringify(firstEvents)).not.toContain("SECONDARY");
      expect(completedTurnIds(externalNotifications)).toContain(external.turn.id);
    });
  }, 60_000);

  it("keeps one live private temp while sandbox modes change on the same thread", async () => {
    await withFixture(async ({ primary, repository }) => {
      const client = new AppServerCodexClient(primary);
      const writable = client.startThread(clientThreadOptions(repository, "workspace-write"));
      const writableEvents = await collect(await writable.runStreamed(environmentPrompt, {
        outputSchema: environmentSchema,
      }));
      const writableEnvironment = lastAgentJson(writableEvents);

      expect(writableEnvironment.TMPDIR).toBe(writableEnvironment.TMP);
      expect(writableEnvironment.TMPDIR).toBe(writableEnvironment.TEMP);
      expect(writableEnvironment.TMPDIR).toMatch(
        new RegExp(`^${escapeRegExp(repository)}/\\.oh-my-bug-tmp-`),
      );

      const readonly = client.resumeThread(writable.id!, clientThreadOptions(repository, "read-only"));
      const readonlyEvents = await collect(await readonly.runStreamed(environmentPrompt, {
        outputSchema: environmentSchema,
      }));
      expect(lastAgentJson(readonlyEvents)).toEqual(writableEnvironment);
      await client.dispose();
    });
  }, 60_000);

  it("maps an unavailable rollout without rewriting its native thread id", async () => {
    await withFixture(async ({ primary, repository }) => {
      const missingThreadId = randomUUID();
      const client = new AppServerCodexClient(primary);
      const thread = client.resumeThread(
        missingThreadId,
        clientThreadOptions(repository, "read-only"),
      );

      await expect(thread.runStreamed("Continue", { outputSchema: ownerSchema })).rejects
        .toMatchObject({ code: "NATIVE_THREAD_UNAVAILABLE", threadId: missingThreadId });
      expect(thread.id).toBe(missingThreadId);
    });
  }, 60_000);
});

interface IntegrationFixture {
  primary: AppServerConnection;
  secondary: AppServerRpcClient;
  repository: string;
}

async function withFixture(run: (fixture: IntegrationFixture) => Promise<void>): Promise<void> {
  const root = await mkdtemp("/tmp/omb-app-server-integration-");
  const repository = join(root, "repo");
  const dataRoot = join(root, "data");
  await mkdir(repository);
  await execFileAsync("git", ["init", repository]);
  const supervisor = new CodexAppServerSupervisor({ dataRoot, startupTimeoutMs: 15_000 });
  let secondary: AppServerRpcClient | undefined;
  try {
    const primary = await supervisor.start();
    secondary = await AppServerRpcClient.connect(supervisor.endpoint(), {
      clientName: "oh-my-bug-integration-secondary",
      clientTitle: "Oh My Bug ?! Integration Secondary",
    });
    await secondary.initialize();
    await run({ primary, secondary, repository });
  } finally {
    await secondary?.close().catch(() => undefined);
    await supervisor.stop().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
}

function threadStart(repository: string, sandbox: "read-only" | "workspace-write") {
  return {
    cwd: repository,
    approvalPolicy: "never" as const,
    sandbox,
  };
}

function turnStart(
  threadId: string,
  repository: string,
  prompt: string,
  outputSchema: JsonValue = messagesSchema,
) {
  return {
    threadId,
    input: [textInput(prompt)],
    cwd: repository,
    approvalPolicy: "never" as const,
    sandboxPolicy: { type: "readOnly", networkAccess: false },
    outputSchema,
  };
}

function textInput(text: string) {
  return { type: "text" as const, text, text_elements: [] as never[] };
}

async function collectTurn(
  connection: AppServerConnection,
  threadId: string,
  turnId: string,
): Promise<JsonRpcNotification[]> {
  return withTimeout((async () => {
    const notifications: JsonRpcNotification[] = [];
    for await (const notification of connection.notifications()) {
      notifications.push(notification);
      if (
        notification.method === "turn/completed" &&
        isRecord(notification.params) &&
        notification.params.threadId === threadId &&
        isRecord(notification.params.turn) &&
        notification.params.turn.id === turnId
      ) return notifications;
    }
    throw new Error("CODEX_APP_SERVER_DISCONNECTED");
  })(), 55_000);
}

async function resumeWhenReadable(
  connection: AppServerConnection,
  threadId: string,
  repository: string,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (true) {
    try {
      await connection.request("thread/resume", {
        threadId,
        ...threadStart(repository, "read-only"),
      });
      return;
    } catch (error) {
      if (!(error instanceof Error) || !/rollout[^\n]*is empty/i.test(error.message)) throw error;
      if (Date.now() >= deadline) throw error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    }
  }
}

function completedTurnIds(notifications: JsonRpcNotification[]): string[] {
  return notifications.flatMap((notification) => {
    if (notification.method !== "turn/completed" || !isRecord(notification.params)) return [];
    const turn = notification.params.turn;
    return isRecord(turn) && typeof turn.id === "string" ? [turn.id] : [];
  });
}

function correlatedTurnIds(events: CodexClientEvent[]): string[] {
  return [...new Set(events.flatMap((event) => (
    "turnId" in event && event.turnId ? [event.turnId] : []
  )))];
}

function clientThreadOptions(
  repository: string,
  sandboxMode: "read-only" | "workspace-write",
) {
  return {
    workingDirectory: repository,
    sandboxMode,
    networkAccessEnabled: false,
    approvalPolicy: "never" as const,
    sessionId: "integration-session",
  };
}

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  return withTimeout((async () => {
    const result: T[] = [];
    for await (const value of values) result.push(value);
    return result;
  })(), 55_000);
}

function lastAgentJson(events: CodexClientEvent[]): Record<string, string> {
  const messages = events.flatMap((event) => (
    event.type === "item.completed" && event.item.type === "agent_message"
      ? [event.item.text]
      : []
  ));
  const message = messages.at(-1);
  if (!message) throw new Error("CODEX_OUTPUT_MISSING");
  return JSON.parse(message) as Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function withTimeout<T>(task: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("CODEX_INTEGRATION_TIMEOUT")), milliseconds);
    task.then(
      (value) => { clearTimeout(timeout); resolve(value); },
      (error) => { clearTimeout(timeout); reject(error); },
    );
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const messagesSchema = {
  type: "object",
  properties: { messages: { type: "array", items: { type: "string" } } },
  required: ["messages"],
  additionalProperties: false,
} satisfies JsonValue;

const ownerSchema = {
  type: "object",
  properties: { owner: { type: "string" } },
  required: ["owner"],
  additionalProperties: false,
} satisfies JsonValue;

const environmentSchema = {
  type: "object",
  properties: {
    TMPDIR: { type: "string" },
    TMP: { type: "string" },
    TEMP: { type: "string" },
  },
  required: ["TMPDIR", "TMP", "TEMP"],
  additionalProperties: false,
} satisfies JsonValue;

const environmentPrompt = [
  "Run this exact shell command and return only its JSON output:",
  "node -e 'console.log(JSON.stringify({TMPDIR:process.env.TMPDIR,TMP:process.env.TMP,TEMP:process.env.TEMP}))'",
].join("\n");
