import { rm } from "node:fs/promises";

import type { AgentSessionRecord } from "@oh-my-bug/core";
import { afterEach, describe, expect, it } from "vitest";

import {
  openRuntimeDatabase,
  SqliteAgentSessionStore,
  SqliteRuntimeStore,
} from "../../src/index.js";
import { databasePath, now, project } from "../helpers.js";

const databases: string[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((path) => rm(path, { force: true })));
});

function activeSession(overrides: Partial<AgentSessionRecord> = {}): AgentSessionRecord {
  return {
    agent: "codex",
    logicalSessionId: "logical-1",
    issueId: "issue-1",
    projectId: project.id,
    providerSessionId: "thread-1",
    lifecycle: "ACTIVE",
    updatedAt: "2026-08-20T10:01:00.000Z",
    ...overrides,
  };
}

describe("SQLite Agent sessions", () => {
  it("persists an opaque provider session across a database restart", async () => {
    const path = databasePath();
    databases.push(path, `${path}-shm`, `${path}-wal`);
    let database = openRuntimeDatabase(path);
    let runtimeStore = new SqliteRuntimeStore(database, { now: () => now });
    runtimeStore.registerProject(project);
    const state = activeSession();

    await new SqliteAgentSessionStore(database).save(state);
    runtimeStore.close();

    database = openRuntimeDatabase(path);
    runtimeStore = new SqliteRuntimeStore(database, { now: () => now });
    await expect(new SqliteAgentSessionStore(database).get(state.logicalSessionId)).resolves.toEqual(state);
    runtimeStore.close();
  });

  it("allows retired history but enforces one active session per Issue", async () => {
    const database = openRuntimeDatabase(":memory:");
    const runtimeStore = new SqliteRuntimeStore(database, { now: () => now });
    runtimeStore.registerProject(project);
    const sessions = new SqliteAgentSessionStore(database);
    await sessions.save(activeSession());

    await expect(sessions.save(activeSession({
      logicalSessionId: "logical-2",
      providerSessionId: "thread-2",
    }))).rejects.toThrow("AGENT_SESSION_ISSUE_CONFLICT");

    runtimeStore.transaction((transaction) => {
      transaction.retireAgentSession("logical-1", "2026-08-20T10:02:00.000Z");
      transaction.insertAgentSession(activeSession({
        logicalSessionId: "logical-2",
        providerSessionId: "thread-2",
        updatedAt: "2026-08-20T10:02:00.000Z",
      }));
    });

    await expect(sessions.get("logical-1")).resolves.toMatchObject({ lifecycle: "RETIRED" });
    await expect(sessions.get("logical-2")).resolves.toEqual(activeSession({
      logicalSessionId: "logical-2",
      providerSessionId: "thread-2",
      updatedAt: "2026-08-20T10:02:00.000Z",
    }));
    runtimeStore.close();
  });
});
