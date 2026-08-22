import { mkdtempSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { IntegrationInput, Issue, RuntimeProject } from "@oh-my-bug/core";
import { openRuntimeDatabase, SqliteRuntimeStore } from "../src/index.js";

export const now = "2026-08-20T14:00:00.000Z";
export const project: RuntimeProject = {
  id: "project-1",
  key: "OMB",
  path: "/tmp/project-1",
};
export const input: IntegrationInput = {
  id: "input-1",
  integration: "sentry",
  inputKey: "event-1",
  groupKey: "payment-route",
  rawData: { id: "event-1" },
  data: { content: "Payment route fails" },
  receivedAt: now,
};
export const issue: Issue = {
  id: "issue-1",
  projectId: project.id,
  identifier: "OMB-1",
  title: "Payment route fails",
  titleSource: "integration",
  status: "RECEIVED",
  inputs: [input],
  revision: 1,
  createdAt: now,
  updatedAt: now,
};

export function databasePath(): string {
  return join(mkdtempSync(join(tmpdir(), "omb-runtime-store-")), "runtime.sqlite");
}

export function createStore(path = databasePath()): SqliteRuntimeStore {
  return new SqliteRuntimeStore(openRuntimeDatabase(path), {
    id: () => "issue-2",
    now: () => now,
  });
}

export async function createTempDir(prefix: string): Promise<{
  path: string;
  cleanup: () => Promise<void>;
}> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  return {
    path,
    cleanup: () => rm(path, { recursive: true, force: true }),
  };
}
