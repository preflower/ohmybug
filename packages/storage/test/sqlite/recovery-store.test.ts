import { describe, expect, it } from "vitest";

import { databasePath, createStore, issue, project } from "../helpers.js";

describe("SQLite recovery state", () => {
  it("retains Agent session and pending operation across reopen", () => {
    const path = databasePath();
    const store = createStore(path);
    store.registerProject(project);
    const repairing = {
      ...issue,
      status: "REPAIRING" as const,
      agentSession: { agent: "fake", sessionId: "session-1" },
      repair: { iteration: 1 },
      revision: 2,
    };
    store.transaction((transaction) => transaction.insertIssue(repairing, "REPAIR"));
    store.close();

    const reopened = createStore(path);
    expect(reopened.getIssue(issue.id)).toEqual(repairing);
    expect(reopened.listPendingOperations()).toEqual([{ issue: repairing, operation: "REPAIR" }]);
    reopened.transaction((transaction) => transaction.updateIssue(repairing, repairing.revision, null));
    reopened.close();

    const cleared = createStore(path);
    expect(cleared.listPendingOperations()).toEqual([]);
    cleared.close();
  });

  it("retains pending evidence inspection across reopen", () => {
    const path = databasePath();
    const store = createStore(path);
    store.registerProject(project);
    const evidenceChecking = {
      ...issue,
      status: "EVIDENCE_CHECK" as const,
      agentSession: { agent: "fake", sessionId: "session-1" },
      repair: {
        iteration: 1,
        delivery: {
          summary: "Implemented",
          evidence: [{
            type: "screenshot" as const,
            label: "Proof",
            evidenceId: `sha256-${"a".repeat(64)}`,
          }],
        },
      },
      revision: 3,
    };
    store.transaction((transaction) =>
      transaction.insertIssue(evidenceChecking, "EVIDENCE"));
    store.close();

    const reopened = createStore(path);
    expect(reopened.listPendingOperations()).toEqual([{
      issue: evidenceChecking,
      operation: "EVIDENCE",
    }]);
    reopened.close();
  });
});
