import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { IntegrationInput } from "@oh-my-bug/core";
import { afterEach, describe, expect, it } from "vitest";

import { createRuntime } from "../../src/index.js";
import { FakeAgent } from "../helpers/fakes.js";
import { project } from "../helpers/runtime.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryDatabase(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return join(directory, "runtime.sqlite");
}

function input(id: string, inputKey: string, groupKey?: string): IntegrationInput {
  return {
    id,
    integration: "test-channel",
    inputKey,
    ...(groupKey ? { groupKey } : {}),
    rawData: { message: inputKey },
    data: { content: inputKey },
    receivedAt: "2026-08-20T16:00:00.000Z",
  };
}

describe("SQLite-backed intake acceptance", () => {
  it("accepts the same Manual command independently in different projects", async () => {
    let sequence = 0;
    const runtime = createRuntime({
      databasePath: temporaryDatabase("omb-runtime-project-idempotency-"),
      agent: new FakeAgent(),
      id: () => `project-idempotency-${++sequence}`,
      now: () => "2026-08-20T16:00:00.000Z",
    });
    const otherProject = {
      ...project,
      id: "project-2",
      key: "OTHER",
      path: "/tmp/project-2",
    };
    runtime.registerProject(project);
    runtime.registerProject(otherProject);

    const first = await runtime.submitManual(project.id, {
      commandId: "same-command",
      content: "Payment route fails",
    });
    const second = await runtime.submitManual(otherProject.id, {
      commandId: "same-command",
      content: "Payment route fails",
    });

    expect(first.kind).toBe("CREATED");
    expect(second.kind).toBe("CREATED");
    expect(runtime.listIssues(project.id)).toHaveLength(1);
    expect(runtime.listIssues(otherProject.id)).toHaveLength(1);
    await runtime.stop();
  });

  it("keeps exact Manual idempotency after reopening SQLite", async () => {
    let sequence = 0;
    const databasePath = temporaryDatabase("omb-runtime-idempotency-");
    const options = {
      databasePath,
      agent: new FakeAgent(),
      id: () => `idempotency-${++sequence}`,
      now: () => "2026-08-20T16:00:00.000Z",
    };
    const firstRuntime = createRuntime(options);
    firstRuntime.registerProject(project);
    const first = await firstRuntime.submitManual(project.id, {
      commandId: "same-command",
      content: "Payment route fails",
    });
    if (first.kind !== "CREATED") throw new Error("CREATED_REQUIRED");
    await firstRuntime.stop();

    const reopened = createRuntime(options);
    const duplicate = await reopened.submitManual(project.id, {
      commandId: "same-command",
      content: "Payment route fails",
    });
    expect(duplicate).toEqual({ kind: "IGNORED_DUPLICATE", issueId: first.issue.id });
    expect(reopened.listIssues(project.id)).toHaveLength(1);
    expect(reopened.getIssue(first.issue.id).inputs).toHaveLength(1);
    await reopened.stop();
  });

  it("appends an active group and creates a new Issue after terminal closure", async () => {
    let sequence = 0;
    const databasePath = temporaryDatabase("omb-runtime-grouping-");
    const options = {
      databasePath,
      agent: new FakeAgent(),
      id: () => `grouping-${++sequence}`,
      now: () => "2026-08-20T16:00:00.000Z",
    };
    const runtime = createRuntime(options);
    runtime.registerProject(project);
    const first = runtime.acceptIntegrationInput(project.id, input("input-1", "event-1", "payment-route"));
    if (first.kind !== "CREATED") throw new Error("CREATED_REQUIRED");
    const appended = runtime.acceptIntegrationInput(project.id, input("input-2", "event-2", "payment-route"));
    expect(appended).toMatchObject({ kind: "APPENDED", issue: { id: first.issue.id } });
    expect(runtime.getIssue(first.issue.id).inputs).toHaveLength(2);

    await runtime.cancelIssue(first.issue.id);
    const afterClosure = runtime.acceptIntegrationInput(project.id, input("input-3", "event-3", "payment-route"));
    if (afterClosure.kind !== "CREATED") throw new Error("NEW_ISSUE_REQUIRED");
    expect(afterClosure.issue.id).not.toBe(first.issue.id);
    await runtime.stop();

    const reopened = createRuntime(options);
    await reopened.start();
    await reopened.drain();
    expect(reopened.getIssue(first.issue.id)).toMatchObject({
      status: "CANCELED",
      resolution: "CANCELED",
      inputs: expect.arrayContaining([
        expect.objectContaining({ inputKey: "event-1" }),
        expect.objectContaining({ inputKey: "event-2" }),
      ]),
    });
    expect(reopened.getIssue(afterClosure.issue.id)).toMatchObject({
      status: "REVIEW_REQUIRED",
      inputs: [expect.objectContaining({ inputKey: "event-3" })],
    });
    await reopened.stop();
  });
});
