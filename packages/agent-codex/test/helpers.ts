import type {
  AgentSessionRecord,
  AgentSessionStore,
  Issue,
  RuntimeProject,
} from "@oh-my-bug/core";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  CodexClient,
  CodexClientEvent,
  CodexThread,
  CodexThreadOptions,
  CodexTurnOptions,
} from "../src/codex-client.js";

export class MemorySessions implements AgentSessionStore {
  readonly values = new Map<string, AgentSessionRecord>();
  readonly saves: AgentSessionRecord[] = [];

  async get(logicalSessionId: string) {
    return this.values.get(logicalSessionId);
  }

  async save(record: AgentSessionRecord) {
    const saved = { ...record };
    this.saves.push(saved);
    this.values.set(record.logicalSessionId, saved);
  }
}

export interface FixtureTurn {
  events?: CodexClientEvent[];
  error?: unknown;
  runStreamedError?: unknown;
  waitForAbort?: boolean;
}

export class FixtureClient implements CodexClient {
  readonly starts: CodexThreadOptions[] = [];
  readonly resumes: Array<{ threadId: string; options: CodexThreadOptions }> = [];
  readonly prompts: string[] = [];
  readonly signals: AbortSignal[] = [];
  private threadSequence = 0;

  constructor(
    private readonly outputs: Array<string | FixtureTurn>,
    private readonly disposeError?: unknown,
  ) {}

  startThread(options: CodexThreadOptions): CodexThread {
    this.starts.push(options);
    this.threadSequence += 1;
    return this.thread(`thread-${this.threadSequence}`);
  }

  resumeThread(threadId: string, options: CodexThreadOptions): CodexThread {
    this.resumes.push({ threadId, options });
    return this.thread(threadId);
  }

  private thread(id: string): CodexThread {
    return {
      id,
      dispose: async () => {
        if (this.disposeError !== undefined) throw this.disposeError;
      },
      runStreamed: async (prompt: string, options: CodexTurnOptions) => {
        this.prompts.push(prompt);
        if (options.signal) this.signals.push(options.signal);
        const output = this.outputs.shift();
        if (output === undefined) throw new Error("FIXTURE_OUTPUT_MISSING");
        if (typeof output !== "string") {
          if (output.runStreamedError !== undefined) throw output.runStreamedError;
          return stream(output.events ?? [], output.error, output.waitForAbort ? options.signal : undefined);
        }
        return stream([
          { type: "thread.started", threadId: id },
          { type: "turn.started", threadId: id, turnId: "turn-fixture" },
          {
            type: "item.completed",
            threadId: id,
            turnId: "turn-fixture",
            item: { type: "agent_message", text: output },
          },
          { type: "turn.completed", threadId: id, turnId: "turn-fixture" },
        ]);
      },
    };
  }
}

function stream(
  events: CodexClientEvent[],
  error?: unknown,
  waitForAbort?: AbortSignal,
): AsyncIterable<CodexClientEvent> {
  return {
    async *[Symbol.asyncIterator]() {
      yield* events;
      if (waitForAbort && !waitForAbort.aborted) {
        await new Promise<void>((resolveAbort) => {
          waitForAbort.addEventListener("abort", () => resolveAbort(), { once: true });
        });
      }
      if (error !== undefined) throw error;
    },
  };
}

export const project: RuntimeProject = {
  id: "project-1",
  key: "CHK",
  path: "/repo/checkout",
  instructions: "Follow AGENTS.md",
  commands: { test: "pnpm test", acceptanceUrl: "http://127.0.0.1:4173" },
  agent: { plugin: "codex" },
};

export function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "issue-1",
    projectId: project.id,
    projectPath: project.path,
    identifier: "CHK-1",
    title: "Checkout fails",
    titleSource: "integration",
    status: "ASSESSING",
    inputs: [{
      id: "input-1",
      integration: "manual",
      inputKey: "command-1",
      rawData: { content: "Expired sessions return 500" },
      data: { content: "Expired sessions return 500" },
      receivedAt: "2026-08-20T10:00:00.000Z",
    }],
    revision: 2,
    createdAt: "2026-08-20T10:00:00.000Z",
    updatedAt: "2026-08-20T10:01:00.000Z",
    ...overrides,
  };
}

export async function bindSession(
  sessions: MemorySessions,
  logicalSessionId = "logical-1",
  providerSessionId?: string,
): Promise<void> {
  await sessions.save({
    agent: "codex",
    logicalSessionId,
    issueId: "issue-1",
    projectId: "project-1",
    ...(providerSessionId ? { providerSessionId } : {}),
    lifecycle: "ACTIVE",
    updatedAt: "2026-08-20T10:00:00.000Z",
  });
}

export async function createTempDir(prefix: string): Promise<{
  path: string;
  cleanup: () => Promise<void>;
}> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  return { path, cleanup: () => rm(path, { recursive: true, force: true }) };
}
