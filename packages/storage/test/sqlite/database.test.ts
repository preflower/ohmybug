import { describe, expect, it } from "vitest";

import { createStore, issue, now, project } from "../helpers.js";

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
});
