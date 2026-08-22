import { describe, expect, it } from "vitest";

import { transitionIssue } from "@oh-my-bug/core";
import { createStore, issue, now, project } from "../helpers.js";

describe("SQLite Issue updates", () => {
  it("persists compare-and-swap updates with an explicit pending operation", () => {
    const store = createStore();
    store.registerProject(project);
    store.transaction((transaction) => transaction.insertIssue(issue, "ASSESS"));
    const updated = transitionIssue(issue, "START_ASSESSMENT", now);
    store.transaction((transaction) => transaction.updateIssue(updated, issue.revision, "ASSESS"));
    expect(store.getIssue(issue.id)).toEqual(updated);
    expect(store.listPendingOperations()).toEqual([{ issue: updated, operation: "ASSESS" }]);
    expect(() => store.transaction((transaction) =>
      transaction.updateIssue({ ...updated, revision: 3 }, issue.revision, null),
    )).toThrow("CONCURRENT_UPDATE");
    store.close();
  });

  it("clears pending work only when null is supplied", () => {
    const store = createStore();
    store.registerProject(project);
    store.transaction((transaction) => transaction.insertIssue(issue, "ASSESS"));
    store.transaction((transaction) => transaction.updateIssue(issue, issue.revision, null));
    expect(store.listPendingOperations()).toEqual([]);
    store.close();
  });
});
