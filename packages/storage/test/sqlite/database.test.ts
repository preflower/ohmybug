import { describe, expect, it } from "vitest";
import BetterSqlite3 from "better-sqlite3";

import { SqliteRuntimeStore } from "../../src/index.js";
import { runtimeSchema } from "../../src/sqlite/schema.js";
import { createStore, databasePath, input, issue, now, project } from "../helpers.js";

describe("SQLite Runtime database", () => {
  it("rolls back every write when the transaction callback throws", () => {
    const store = createStore();
    store.registerProject(project);
    expect(() => store.transaction((transaction) => {
      transaction.insertIssue(issue, "ASSESS");
      throw new Error("ROLLBACK_PROBE");
    })).toThrow("ROLLBACK_PROBE");
    expect(store.getIssue(issue.id)).toBeUndefined();
    store.close();
  });

  it("registers identical project context idempotently and rejects conflicts", () => {
    const store = createStore();
    store.registerProject(project);
    store.registerProject(project);
    expect(store.getProject(project.id)).toEqual({
      ...project,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
    expect(() => store.registerProject({ ...project, path: "/tmp/other-project" }))
      .toThrow("PROJECT_CONFLICT");
    expect(() => store.registerProject({ ...project, id: "project-2" }))
      .toThrow("PROJECT_CONFLICT");
    store.close();
  });

  it("migrates the legacy global input identity constraint", () => {
    const path = databasePath();
    const legacy = new BetterSqlite3(path);
    legacy.exec(runtimeSchema.replace(
      "UNIQUE(project_id, integration, input_key)",
      "UNIQUE(integration, input_key)",
    ));
    const legacyStore = new SqliteRuntimeStore(legacy, {
      id: () => "legacy-generated-id",
      now: () => now,
    });
    legacyStore.registerProject(project);
    legacyStore.transaction((transaction) => transaction.insertIssue(issue, "ASSESS"));
    legacyStore.close();

    const store = createStore(path);
    const otherProject = { ...project, id: "project-2", key: "OTHER" };
    const otherIssue = {
      ...issue,
      id: "issue-2",
      projectId: otherProject.id,
      identifier: "OTHER-1",
      inputs: [{ ...input, id: "input-2" }],
    };
    store.registerProject(otherProject);
    store.transaction((transaction) => transaction.insertIssue(otherIssue, "ASSESS"));

    expect(store.listIssues()).toEqual([issue, otherIssue]);
    store.close();
  });
});
