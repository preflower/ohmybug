import type { Issue } from "@oh-my-bug/core";
import { describe, expect, it } from "vitest";

import { delivery, FakeAgent } from "./helpers/fakes.js";
import { assessment, createHarness, now, reviewedIssue } from "./helpers/runtime.js";

describe("Runtime human commands", () => {
  it("grants the active capability request idempotently and requeues its operation", () => {
    const { commands, store, wakes } = createHarness();
    const paused = permissionRequiredIssue();
    insertPaused(store, paused);

    const resumed = commands.grantIssueCapabilities(
      paused.id,
      paused.revision,
      "request-1",
    );

    expect(resumed).toMatchObject({
      status: "REPAIRING",
      capabilityGrants: [{ capability: "HOST_EXECUTION", requestId: "request-1" }],
    });
    expect(store.listPendingOperations()).toEqual([{ issue: resumed, operation: "REPAIR" }]);
    expect(wakes()).toBe(1);
    expect(commands.grantIssueCapabilities(
      paused.id,
      paused.revision,
      "request-1",
    )).toEqual(resumed);
    expect(wakes()).toBe(1);
  });

  it("rejects stale capability grant input without changing the Issue", () => {
    const { commands, store } = createHarness();
    const paused = permissionRequiredIssue();
    insertPaused(store, paused);

    expect(() => commands.grantIssueCapabilities(
      paused.id,
      paused.revision - 1,
      "request-1",
    )).toThrow("CONCURRENT_UPDATE");
    expect(() => commands.grantIssueCapabilities(
      paused.id,
      paused.revision,
      "request-old",
    )).toThrow("CAPABILITY_REQUEST_STALE");
    expect(store.getIssue(paused.id)).toEqual(paused);
  });

  it("cancels a permission-blocked Issue and revokes its grants", async () => {
    const { commands, store } = createHarness();
    const paused = permissionRequiredIssue({
      capabilityGrants: [{
        capability: "NETWORK_ACCESS",
        requestId: "request-old",
        grantedAt: now,
      }],
    });
    insertPaused(store, paused);

    const canceled = await commands.cancelIssue(paused.id);

    expect(canceled).toMatchObject({ status: "CANCELED", resolution: "CANCELED" });
    expect(canceled.capabilityGrants).toBeUndefined();
    expect(canceled.pendingCapabilityRequest).toBeUndefined();
  });

  it("approves a current Bug Assessment and schedules Repair", () => {
    const { commands, store, wakes } = createHarness();
    const issue = reviewedIssue();
    store.transaction((transaction) => transaction.insertIssue(issue, "ASSESS"));

    const updated = commands.approveAssessment(issue.id, {
      assessmentRevision: assessment.revision,
      assessmentContentHash: assessment.contentHash,
      title: assessment.suggestedTitle,
    });

    expect(updated).toMatchObject({ status: "REPAIRING", title: "支付页无法打开" });
    expect(store.listPendingOperations()).toEqual([{ issue: updated, operation: "REPAIR" }]);
    expect(wakes()).toBe(1);
  });

  it("approves a current Feature Assessment and schedules implementation", () => {
    const { commands, store, wakes } = createHarness();
    const feature = {
      ...assessment,
      contentHash: "f".repeat(64),
      verdict: "FEATURE" as const,
      rootCause: undefined,
      solution: "Add CSV serialization and an export action.",
    };
    const issue = reviewedIssue({ id: "issue-feature", assessment: feature });
    store.transaction((transaction) => transaction.insertIssue(issue, "ASSESS"));

    const updated = commands.approveAssessment(issue.id, {
      assessmentRevision: feature.revision,
      assessmentContentHash: feature.contentHash,
      title: "支持 CSV 导出",
    });

    expect(updated).toMatchObject({ status: "REPAIRING", title: "支持 CSV 导出" });
    expect(store.listPendingOperations()).toEqual([{ issue: updated, operation: "REPAIR" }]);
    expect(wakes()).toBe(1);
  });

  it("persists reassessment feedback in the Issue and user activity event", () => {
    const { commands, store } = createHarness();
    const issue = reviewedIssue();
    store.transaction((transaction) => transaction.insertIssue(issue, "ASSESS"));
    expect(commands.requestReassessment(issue.id, "  Inspect the router  "))
      .toMatchObject({ status: "ASSESSING", assessmentFeedback: "Inspect the router" });

    expect(store.readEvents(issue.id)).toContainEqual(expect.objectContaining({
      actor: "USER",
      type: "REVIEW_SUBMITTED",
      data: expect.objectContaining({
        choiceId: "reassess",
        feedback: "Inspect the router",
      }),
    }));
  });

  it("rejects stale Assessment approval", () => {
    const { commands, store } = createHarness();
    const stale = reviewedIssue({ id: "issue-stale", identifier: "OMB-3" });
    store.transaction((transaction) => transaction.insertIssue(stale, "ASSESS"));
    expect(() => commands.approveAssessment(stale.id, {
      assessmentRevision: 2,
      assessmentContentHash: assessment.contentHash,
      title: assessment.suggestedTitle,
    })).toThrow(/Stale Assessment approval/);
  });

  it("clears the previous failure when retrying Repair", () => {
    const { commands, store } = createHarness();
    const failed = reviewedIssue({
      id: "issue-retry-repair",
      status: "REPAIR_FAILED",
      repair: { iteration: 1 },
      lastFailure: { stage: "REPAIR", code: "AGENT_FAILURE" },
      revision: 6,
    });
    store.transaction((transaction) => {
      transaction.insertIssue(failed, "REPAIR");
      transaction.updateIssue(failed, failed.revision, null);
    });

    const retrying = commands.retryIssue(failed.id);

    expect(retrying).toMatchObject({ status: "REPAIRING", repair: { iteration: 2 } });
    expect(retrying.lastFailure).toBeUndefined();
    expect(store.listPendingOperations()).toEqual([{ issue: retrying, operation: "REPAIR" }]);
  });

  it("retries evidence without scheduling Repair", () => {
    const { commands, store } = createHarness();
    const failed = reviewedIssue({
      id: "issue-retry-evidence",
      status: "EVIDENCE_FAILED",
      repair: {
        iteration: 2,
        evidenceRetries: 2,
        deliveryDraft: {
          summary: "Implemented",
          repairIteration: 2,
          implementationCompletedAt: now,
        },
      },
      lastFailure: { stage: "EVIDENCE", code: "EVIDENCE_RETRY_LIMIT_REACHED" },
      revision: 8,
    });
    store.transaction((transaction) => {
      transaction.insertIssue(failed, "REPAIR");
      transaction.updateIssue(failed, failed.revision, null);
    });

    const retrying = commands.retryIssue(failed.id);

    expect(retrying).toMatchObject({
      status: "EVIDENCE_CAPTURE",
      repair: { iteration: 2, deliveryDraft: failed.repair?.deliveryDraft },
    });
    expect(retrying.lastFailure).toBeUndefined();
    expect(store.listPendingOperations()).toEqual([{
      issue: retrying,
      operation: "CAPTURE_EVIDENCE",
    }]);
  });

  it("persists an approved Delivery as FIXED", () => {
    const { commands, store } = createHarness();
    const issue = reviewedIssue({
      id: "issue-delivery",
      status: "REVIEW_REQUIRED",
      agentSession: { agent: "fake", sessionId: "session-1" },
      repair: { iteration: 1, delivery },
      revision: 7,
    });
    store.transaction((transaction) => transaction.insertIssue(issue, "ASSESS"));

    const approved = commands.approveDelivery(issue.id);

    expect(approved).toMatchObject({ status: "FINALIZING", resolution: "FIXED" });
    expect(store.listPendingOperations()).toEqual([
      { issue: approved, operation: "FINALIZE" },
    ]);
    expect(store.readEvents(issue.id).map((event) => event.type)).toEqual(["REVIEW_SUBMITTED"]);
  });

  it("retries only a failed Delivery finalization", () => {
    const { commands, store } = createHarness();
    const failed = reviewedIssue({
      id: "issue-finalization-failed",
      status: "FINALIZATION_FAILED",
      resolution: "FIXED",
      repair: { iteration: 1, delivery },
      revision: 8,
    });
    store.transaction((transaction) => {
      transaction.insertIssue(failed, "FINALIZE");
      transaction.updateIssue(failed, failed.revision, null);
    });

    const retrying = commands.approveDelivery(failed.id);

    expect(retrying).toMatchObject({
      status: "FINALIZING",
      resolution: "FIXED",
      revision: 9,
    });
    expect(store.listPendingOperations()).toEqual([{
      issue: retrying,
      operation: "FINALIZE",
    }]);
    expect(store.readEvents(failed.id).map((event) => event.type))
      .toEqual(["DELIVERY_FINALIZATION_RETRIED"]);
  });

  it("rejects duplicate delivery actions while finalization recovery is active", () => {
    const { commands, store } = createHarness();
    const recovering = reviewedIssue({
      id: "issue-finalization-recovering",
      status: "FINALIZATION_RECOVERY",
      resolution: "FIXED",
      repair: { iteration: 1, delivery },
      finalizationRecovery: {
        automaticAttempts: 1,
        attemptId: "attempt-1",
        fingerprintRef: "fingerprint-1",
      },
      revision: 9,
    });
    store.transaction((transaction) => transaction.insertIssue(
      recovering,
      "RECOVER_FINALIZATION",
    ));

    expect(() => commands.approveDelivery(recovering.id)).toThrow();
    expect(() => commands.retryIssue(recovering.id)).toThrow("RETRY_NOT_AVAILABLE");
    expect(store.listPendingOperations().map((pending) => pending.operation))
      .toEqual(["RECOVER_FINALIZATION"]);
  });

  it("persists an approved Feature Delivery as IMPLEMENTED", () => {
    const { commands, store } = createHarness();
    const feature = { ...assessment, verdict: "FEATURE" as const, rootCause: undefined };
    const issue = reviewedIssue({
      id: "issue-feature-delivery",
      status: "REVIEW_REQUIRED",
      assessment: feature,
      agentSession: { agent: "fake", sessionId: "session-feature" },
      repair: { iteration: 1, delivery },
      revision: 7,
    });
    store.transaction((transaction) => transaction.insertIssue(issue, "ASSESS"));

    expect(commands.approveDelivery(issue.id)).toMatchObject({
      status: "FINALIZING",
      resolution: "IMPLEMENTED",
    });
  });

  it("confirms NOT_A_BUG only through a human command", () => {
    const { commands, store } = createHarness();
    const notBug = { ...assessment, verdict: "NOT_A_BUG" as const };
    const issue = reviewedIssue({ id: "issue-not-bug", assessment: notBug });
    store.transaction((transaction) => transaction.insertIssue(issue, "ASSESS"));
    expect(commands.confirmNotABug(issue.id, {
      assessmentRevision: notBug.revision,
      assessmentContentHash: notBug.contentHash,
    })).toMatchObject({ status: "CLOSED", resolution: "NOT_A_BUG" });
  });

  it.each([
    ["missing", "UNKNOWN-1"],
    ["blank", "   "],
  ])("rejects a %s duplicate target without changing the Issue", (_label, duplicateOf) => {
    const { commands, store } = createHarness();
    const issue = reviewedIssue({ id: "issue-duplicate", identifier: "OMB-10" });
    store.transaction((transaction) => transaction.insertIssue(issue, "ASSESS"));
    const reference = {
      assessmentRevision: assessment.revision,
      assessmentContentHash: assessment.contentHash,
    };

    expect(() => commands.confirmDuplicate(issue.id, reference, duplicateOf))
      .toThrow("DUPLICATE_TARGET_NOT_FOUND");
    expect(store.getIssue(issue.id)).toEqual(issue);
    expect(store.readEvents(issue.id)).toEqual([]);
  });

  it.each([
    ["Issue ID", "issue-duplicate"],
    ["Issue identifier", "OMB-10"],
  ])("rejects a duplicate target that is self by %s", (_label, duplicateOf) => {
    const { commands, store } = createHarness();
    const issue = reviewedIssue({ id: "issue-duplicate", identifier: "OMB-10" });
    store.transaction((transaction) => transaction.insertIssue(issue, "ASSESS"));

    expect(() => commands.confirmDuplicate(issue.id, {
      assessmentRevision: assessment.revision,
      assessmentContentHash: assessment.contentHash,
    }, duplicateOf)).toThrow("DUPLICATE_TARGET_SELF");
    expect(store.getIssue(issue.id)).toEqual(issue);
    expect(store.readEvents(issue.id)).toEqual([]);
  });

  it("hides cross-project targets and stores a same-project canonical identifier", () => {
    const { commands, store } = createHarness();
    commands.registerProject({
      id: "project-2",
      key: "OTHER",
      path: "/tmp/project-2",
      agent: { plugin: "fake" },
    });
    const issue = reviewedIssue({ id: "issue-duplicate", identifier: "OMB-10" });
    const target = reviewedIssue({ id: "target-id", identifier: "OMB-20" });
    const cross = reviewedIssue({
      id: "cross-id",
      projectId: "project-2",
      identifier: "OTHER-1",
    });
    store.transaction((transaction) => {
      transaction.insertIssue(issue, "ASSESS");
      transaction.insertIssue(target, "ASSESS");
      transaction.insertIssue(cross, "ASSESS");
    });

    expect(() => commands.confirmDuplicate(issue.id, {
      assessmentRevision: assessment.revision,
      assessmentContentHash: assessment.contentHash,
    }, "cross-id")).toThrow("DUPLICATE_TARGET_NOT_FOUND");
    expect(commands.confirmDuplicate(issue.id, {
      assessmentRevision: assessment.revision,
      assessmentContentHash: assessment.contentHash,
    }, "  target-id  ")).toMatchObject({
      status: "CLOSED",
      resolution: "DUPLICATE",
      duplicateOf: "OMB-20",
    });
  });

  it("explicitly rebuilds an unavailable Repair session and preserves context", async () => {
    const agent = new FakeAgent();
    const { commands, store } = createHarness(agent);
    const failed = reviewedIssue({
      id: "issue-rebuild",
      status: "REPAIR_FAILED",
      agentSession: { agent: "fake", sessionId: "session-old" },
      repair: { iteration: 2, delivery, feedback: "try again" },
      lastFailure: { stage: "REPAIR", code: "AGENT_SESSION_UNAVAILABLE" },
      revision: 9,
    });
    store.transaction((transaction) => {
      transaction.insertAgentSession({
        agent: "fake",
        logicalSessionId: "session-old",
        issueId: failed.id,
        projectId: failed.projectId,
        providerSessionId: "native-secret",
        lifecycle: "ACTIVE",
        updatedAt: now,
      });
      transaction.insertIssue(failed, "REPAIR");
      transaction.updateIssue(failed, failed.revision, null);
    });

    const rebuilt = await commands.rebuildAgentSession(failed.id, failed.revision);

    expect(rebuilt).toMatchObject({
      status: "REPAIRING",
      assessment: failed.assessment,
      repair: { iteration: 3, delivery },
      agentSession: { agent: "fake", sessionId: "session-1" },
    });
    expect(store.getAgentSession("session-old")?.lifecycle).toBe("RETIRED");
    expect(store.getAgentSession("session-1")).toMatchObject({ lifecycle: "ACTIVE" });
    expect(store.getAgentSession("session-1")).not.toHaveProperty("providerSessionId");
    expect(store.listPendingOperations()[0]?.operation).toBe("REPAIR");
    const events = store.readEvents(failed.id);
    expect(events.map((event) => event.type)).toEqual([
      "AGENT_SESSION_REBUILD_REQUESTED",
      "AGENT_SESSION_REBUILT",
    ]);
    expect(JSON.stringify(events)).not.toContain("native-secret");
  });

  it("does not rebuild a session for any other failure", async () => {
    const agent = new FakeAgent();
    const { commands, store } = createHarness(agent);
    const failed = reviewedIssue({
      id: "issue-no-rebuild",
      status: "ASSESSMENT_FAILED",
      agentSession: { agent: "fake", sessionId: "session-old" },
      lastFailure: { stage: "ASSESSMENT", code: "AGENT_FAILURE" },
      revision: 5,
    });
    store.transaction((transaction) => transaction.insertIssue(failed, "ASSESS"));
    store.transaction((transaction) => transaction.updateIssue(failed, failed.revision, null));

    await expect(commands.rebuildAgentSession(failed.id, failed.revision))
      .rejects.toThrow("AGENT_SESSION_REBUILD_NOT_AVAILABLE");
    expect(agent.createdSessions).toEqual([]);
  });

  it("persists cancellation before aborting the session-selected Agent", async () => {
    const agent = new FakeAgent();
    const { commands, store } = createHarness(agent);
    const issue = reviewedIssue({
      id: "issue-cancel",
      agentSession: { agent: "fake", sessionId: "session-active" },
    });
    store.transaction((transaction) => transaction.insertIssue(issue, "ASSESS"));
    agent.cancel = async (session, reason) => {
      expect(store.getIssue(issue.id)?.status).toBe("CANCELED");
      agent.canceledSessions.push(session.sessionId);
      agent.cancellations.push({ sessionId: session.sessionId, reason });
    };

    await expect(commands.cancelIssue(issue.id)).resolves.toMatchObject({
      status: "CANCELED",
      resolution: "CANCELED",
    });
    expect(agent.canceledSessions).toEqual(["session-active"]);
    expect(agent.cancellations).toEqual([{
      sessionId: "session-active",
      reason: "USER_CANCELED",
    }]);
    expect(store.listPendingOperations()).toEqual([]);
  });
});

function permissionRequiredIssue(overrides: Partial<Issue> = {}): Issue {
  return reviewedIssue({
    status: "PERMISSION_REQUIRED",
    revision: 7,
    repair: { iteration: 1 },
    pendingCapabilityRequest: {
      id: "request-1",
      operation: "REPAIR",
      stage: "REPAIR",
      resumeStatus: "REPAIRING",
      capabilities: ["HOST_EXECUTION"],
      reason: "Launch Electron acceptance",
      requestedAt: now,
    },
    ...overrides,
  });
}

function insertPaused(
  store: ReturnType<typeof createHarness>["store"],
  paused: Issue,
): void {
  store.transaction((transaction) => {
    transaction.insertIssue(paused, "REPAIR");
    transaction.updateIssue(paused, paused.revision, null);
  });
}
