import { describe, expect, it } from "vitest";

import {
  completeIssuePause,
  transitionIssue,
  type Issue,
  type IssueStatus,
} from "../../src/index.js";

const now = "2026-08-25T00:00:00.000Z";

function issueAt(status: IssueStatus): Issue {
  return {
    id: "issue-1",
    projectId: "project-1",
    identifier: "OMB-1",
    title: "支付页打不开",
    titleSource: "integration",
    status,
    inputs: [],
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
}

describe("Issue workflow", () => {
  const capabilityGrants = [{
    capability: "HOST_EXECUTION" as const,
    requestId: "request-1",
    grantedAt: now,
  }];

  it("keeps readiness in its source status until Runtime requests review", () => {
    expect(transitionIssue(issueAt("ASSESSING"), "ASSESSMENT_READY", now).status)
      .toBe("ASSESSING");
    expect(transitionIssue(issueAt("EVIDENCE_CHECK"), "EVIDENCE_ACCEPTED", now).status)
      .toBe("EVIDENCE_CHECK");
  });

  it.each([
    ["ASSESSMENT_FAILED", "RETRY_ASSESSMENT", "ASSESSING"],
    ["EVIDENCE_CHECK", "EVIDENCE_REJECTED", "EVIDENCE_CAPTURE"],
    ["EVIDENCE_FAILED", "RETRY_EVIDENCE", "EVIDENCE_CAPTURE"],
    ["REPAIR_FAILED", "RETRY_REPAIR", "REPAIRING"],
  ] as const)("%s + %s -> %s", (from, action, to) => {
    expect(transitionIssue(issueAt(from), action, now).status).toBe(to);
  });

  it("clears stale assessment and failure state when retrying", () => {
    const assessment = {
      revision: 1,
      contentHash: "a".repeat(64),
      verdict: "BUG" as const,
      suggestedTitle: "修复支付页",
      reasoning: "路由缺失",
      rootCause: "路由被删除",
      solution: "恢复路由",
    };
    const retried = transitionIssue({
      ...issueAt("ASSESSMENT_FAILED"),
      assessment,
      lastFailure: { stage: "ASSESSMENT", code: "AGENT_FAILURE" },
    }, "RETRY_ASSESSMENT", now);

    expect(retried.assessment).toBeUndefined();
    expect(retried.lastFailure).toBeUndefined();
  });

  it("increments a repair iteration only for a repair retry", () => {
    const retried = transitionIssue({
      ...issueAt("REPAIR_FAILED"),
      repair: { iteration: 2 },
    }, "RETRY_REPAIR", now);
    const evidenceRejected = transitionIssue({
      ...issueAt("EVIDENCE_CHECK"),
      repair: { iteration: 2 },
    }, "EVIDENCE_REJECTED", now);

    expect(retried.repair).toEqual({ iteration: 3 });
    expect(evidenceRejected.repair).toEqual({ iteration: 2 });
  });

  it("separates active and failed finalization", () => {
    const finalizing = {
      ...issueAt("FINALIZING"),
      resolution: "FIXED" as const,
      finalizationRecovery: { automaticAttempts: 0 as const },
    };
    const failed = transitionIssue(finalizing, "FINALIZATION_ERRORED", now);

    expect(failed.status).toBe("FINALIZATION_FAILED");
    expect(transitionIssue(failed, "RETRY_FINALIZATION_REPAIR", now)).toMatchObject({
      status: "REPAIRING",
    });
    expect(transitionIssue(finalizing, "COMPLETE_DELIVERY", now)).toMatchObject({
      status: "COMPLETED",
      resolution: "FIXED",
    });
    expect(transitionIssue(finalizing, "BASE_INTEGRATION_STALE", now)).toMatchObject({
      status: "REPAIRING",
    });
    expect(() => transitionIssue(issueAt("REPAIRING"), "BASE_INTEGRATION_STALE", now))
      .toThrow(/Illegal Issue transition/);
  });

  it("preserves the automatic recovery budget on an automatic retry", () => {
    const recovering = {
      ...issueAt("FINALIZATION_RECOVERY"),
      finalizationRecovery: { automaticAttempts: 1 as const },
    };
    expect(transitionIssue(recovering, "RETRY_FINALIZATION", now)).toMatchObject({
      status: "FINALIZING",
      finalizationRecovery: { automaticAttempts: 1 },
    });
  });

  it("cancels a generic review and clears review state", () => {
    const canceled = transitionIssue({
      ...issueAt("REVIEW_REQUIRED"),
      review: {
        id: "review-19",
        kind: "business-merge-conflict",
        requestedFrom: "REPAIRING",
        payload: {},
        choices: [{
          id: "continue",
          label: "Continue",
          continuation: { operation: "REPAIR", resumeStatus: "REPAIRING" },
        }],
        requestedAt: now,
      },
    }, "CANCEL", now);

    expect(canceled).toMatchObject({ status: "CANCELED", resolution: "CANCELED" });
    expect(canceled.review).toBeUndefined();
  });

  it("cancels a permission pause and revokes capability state", () => {
    const canceled = transitionIssue({
      ...issueAt("PERMISSION_REQUIRED"),
      capabilityGrants,
      pendingCapabilityRequest: {
        id: "request-2",
        operation: "REPAIR",
        stage: "REPAIR",
        resumeStatus: "REPAIRING",
        capabilities: ["NETWORK_ACCESS"],
        reason: "Download test fixture",
        requestedAt: now,
      },
    }, "CANCEL", now);

    expect(canceled.status).toBe("CANCELED");
    expect(canceled.capabilityGrants).toBeUndefined();
    expect(canceled.pendingCapabilityRequest).toBeUndefined();
  });

  it.each([
    ["ASSESSING", "ASSESS"],
    ["REPAIRING", "REPAIR"],
    ["EVIDENCE_CAPTURE", "CAPTURE_EVIDENCE"],
    ["FINALIZATION_RECOVERY", "RECOVER_FINALIZATION"],
  ] as const)("pauses and resumes %s", (status, operation) => {
    const active = {
      ...issueAt(status),
      agentSession: { agent: "fake", sessionId: "session-1" },
      repair: status === "ASSESSING" ? undefined : { iteration: 2 },
    };

    const paused = transitionIssue(active, "PAUSE", now);
    expect(paused).toMatchObject({
      status: "PAUSED",
      pauseContext: { operation, resumeStatus: status, pausedAt: now, ready: false },
      agentSession: active.agentSession,
      repair: active.repair,
    });

    expect(() => transitionIssue(paused, "RESUME", now))
      .toThrow("ISSUE_PAUSE_IN_PROGRESS");
    const ready = completeIssuePause(paused, now);
    const resumed = transitionIssue(ready, "RESUME", now);
    expect(resumed).toMatchObject({
      status,
      agentSession: active.agentSession,
      repair: active.repair,
    });
    expect(resumed.pauseContext).toBeUndefined();
  });

  it.each([
    "RECEIVED",
    "ASSESSMENT_FAILED",
    "EVIDENCE_CHECK",
    "EVIDENCE_FAILED",
    "REPAIR_FAILED",
    "PERMISSION_REQUIRED",
    "REVIEW_REQUIRED",
    "FINALIZATION_FAILED",
  ] as const)("allows terminal cancellation from passive %s", (status) => {
    expect(transitionIssue(issueAt(status), "CANCEL", now)).toMatchObject({
      status: "CANCELED",
      resolution: "CANCELED",
    });
  });

  it.each([
    "ASSESSING",
    "REPAIRING",
    "EVIDENCE_CAPTURE",
    "FINALIZATION_RECOVERY",
  ] as const)("requires pause instead of cancellation while %s is active", (status) => {
    expect(() => transitionIssue(issueAt(status), "CANCEL", now))
      .toThrow(/Illegal Issue transition/);
  });

  it("clears grants and failures when finalization completes", () => {
    const completed = transitionIssue({
      ...issueAt("FINALIZING"),
      capabilityGrants,
      lastFailure: { stage: "FINALIZATION_RECOVERY", code: "RECOVERY_FAILED" },
    }, "COMPLETE_DELIVERY", now);

    expect(completed.status).toBe("COMPLETED");
    expect(completed.capabilityGrants).toBeUndefined();
    expect(completed.lastFailure).toBeUndefined();
  });

  it("rejects actions outside their current state", () => {
    expect(() => transitionIssue(issueAt("RECEIVED"), "COMPLETE_DELIVERY", now))
      .toThrow(/Illegal Issue transition/);
    expect(() => transitionIssue(issueAt("COMPLETED"), "CANCEL", now))
      .toThrow(/Illegal Issue transition/);
  });
});
