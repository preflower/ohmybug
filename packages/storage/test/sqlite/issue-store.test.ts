import { describe, expect, it } from "vitest";

import { transitionIssue } from "@oh-my-bug/core";
import { createStore, issue, now, project } from "../helpers.js";

describe("SQLite Issue updates", () => {
  it("stores an intentionally paused capability request without pending work", () => {
    const store = createStore();
    store.registerProject(project);
    const paused = {
      ...issue,
      status: "PERMISSION_REQUIRED" as const,
      revision: 4,
      capabilityGrants: [{
        capability: "NETWORK_ACCESS" as const,
        requestId: "request-old",
        grantedAt: now,
      }],
      pendingCapabilityRequest: {
        id: "request-1",
        operation: "REPAIR" as const,
        stage: "REPAIR" as const,
        resumeStatus: "REPAIRING" as const,
        capabilities: ["HOST_EXECUTION" as const],
        reason: "Launch Electron acceptance",
        requestedAt: now,
      },
    };
    store.transaction((transaction) => {
      transaction.insertIssue(paused, "REPAIR");
      transaction.updateIssue(paused, paused.revision, null);
    });

    expect(store.getIssue(issue.id)).toEqual(paused);
    expect(store.listPendingOperations()).toEqual([]);
    store.close();
  });

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
