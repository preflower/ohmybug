import { describe, expect, it } from "vitest";

import { databasePath, createStore, issue, now, project } from "../helpers.js";

describe("SQLite recovery state", () => {
  it("retains Issue grants and a pending capability request across reopen", () => {
    const path = databasePath();
    const store = createStore(path);
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
    store.close();

    const reopened = createStore(path);
    expect(reopened.getIssue(issue.id)).toMatchObject({
      status: "PERMISSION_REQUIRED",
      capabilityGrants: [{
        capability: "NETWORK_ACCESS",
        requestId: "request-old",
      }],
      pendingCapabilityRequest: {
        id: "request-1",
        operation: "REPAIR",
        resumeStatus: "REPAIRING",
        capabilities: ["HOST_EXECUTION"],
      },
    });
    expect(reopened.listPendingOperations()).toEqual([]);
    reopened.close();
  });

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
