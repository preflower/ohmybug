import { describe, expect, it } from "vitest";

import {
  beginFinalizationRecovery,
  recordBaseIntegrationStale,
  recordAgentSession,
  recordAssessment,
  recordAssessmentFailure,
  recordDelivery,
  recordEvidenceAcceptance,
  recordEvidenceFailure,
  recordEvidenceRejection,
  recordImplementationDraft,
  recordFinalizationRecoveryResult,
  recordRepairFailure,
  grantCapabilityRequest,
  recordCapabilityRequest,
  replaceAgentSession,
  requestReview,
  submitReview,
  type Assessment,
  type Delivery,
  type Issue,
  type IssueStatus,
} from "../../src/index.js";

const now = "2026-08-20T11:00:00.000Z";
const assessment: Assessment = {
  revision: 1,
  contentHash: "a".repeat(64),
  verdict: "BUG",
  suggestedTitle: "支付页无法打开",
  reasoning: "问题可稳定复现",
  rootCause: "支付页路由缺失",
  solution: "恢复支付页路由",
};
const delivery: Delivery = {
  summary: "支付页路由已恢复",
  evidence: [{
    type: "screenshot",
    label: "支付页正常打开",
    evidenceId: `sha256-${"a".repeat(64)}`,
  }],
};
const draft = {
  summary: delivery.summary,
  repairIteration: 2,
  implementationCompletedAt: now,
};
const integrationSnapshot = {
  baseBranch: "main",
  baseCommit: "a".repeat(40),
  issueBranch: "ohmybug/omb-19",
  issueCommit: "b".repeat(40),
  conflicts: [{
    path: "src/payment/router.ts",
    classification: "TEXTUAL" as const,
    resolution: "Preserved both imports",
  }],
  verification: [{
    command: "pnpm test",
    outcome: "PASSED" as const,
    summary: "Passed",
  }],
};

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

describe("Issue workflow results", () => {
  const businessReview = {
    id: "review-19",
    kind: "business-merge-conflict",
    requestedFrom: "REPAIRING" as const,
    payload: { incompatibility: "Only one rounding rule can be active" },
    choices: [{
      id: "use-issue-behavior",
      label: "Use Issue behavior",
      feedbackRequired: true,
      continuation: { operation: "REPAIR" as const, resumeStatus: "REPAIRING" as const },
    }],
    requestedAt: now,
  };

  it("pauses one active operation for a bounded generic review", () => {
    const paused = requestReview(issueAt("REPAIRING"), businessReview, now);

    expect(paused).toMatchObject({
      status: "REVIEW_REQUIRED",
      review: businessReview,
      revision: 2,
    });
    expect(() => requestReview(paused, businessReview, now))
      .toThrow("REVIEW_ALREADY_REQUIRED");
    expect(() => requestReview(issueAt("REPAIRING"), {
      ...businessReview,
      choices: [{
        id: "escape",
        label: "Escape Repair",
        continuation: { operation: "FINALIZE", resumeStatus: "FINALIZING" },
      }],
    }, now)).toThrow("REVIEW_CONTINUATION_NOT_ALLOWED");
  });

  it("submits the current review atomically and returns its operation", () => {
    const paused = requestReview(issueAt("REPAIRING"), businessReview, now);
    const submitted = submitReview(paused, {
      expectedRevision: paused.revision,
      requestId: businessReview.id,
      choiceId: "use-issue-behavior",
      feedback: "Preserve per-line rounding",
    }, "2026-08-25T00:10:00.000Z");

    expect(submitted.operation).toBe("REPAIR");
    expect(submitted.issue).toMatchObject({ status: "REPAIRING", revision: 3 });
    expect(submitted.issue.review).toBeUndefined();
    expect(() => submitReview(paused, {
      expectedRevision: paused.revision - 1,
      requestId: businessReview.id,
      choiceId: "use-issue-behavior",
      feedback: "Preserve per-line rounding",
    }, now)).toThrow("REVIEW_SUBMISSION_STALE");
    expect(() => submitReview(paused, {
      expectedRevision: paused.revision,
      requestId: "stale-review",
      choiceId: "use-issue-behavior",
      feedback: "Preserve per-line rounding",
    }, now)).toThrow("REVIEW_REQUEST_STALE");
    expect(() => submitReview(paused, {
      expectedRevision: paused.revision,
      requestId: businessReview.id,
      choiceId: "unknown",
      feedback: "Preserve per-line rounding",
    }, now)).toThrow("REVIEW_CHOICE_NOT_AVAILABLE");
    expect(() => submitReview(paused, {
      expectedRevision: paused.revision,
      requestId: businessReview.id,
      choiceId: "use-issue-behavior",
    }, now)).toThrow("REVIEW_FEEDBACK_REQUIRED");
  });

  const diagnostic = {
    providerId: "git",
    step: "add" as const,
    code: "GIT_COMMAND_FAILED:add",
    exitCode: 128,
    message: "Git could not add a generated directory",
    stderr: "fatal: adding files failed",
    relatedPaths: [".pnpm-store/shared/v11/tmp/_tmp_fixture"],
  };
  const capabilityRequest = {
    id: "request-1",
    operation: "REPAIR" as const,
    stage: "REPAIR" as const,
    capabilities: ["HOST_EXECUTION" as const],
    reason: "Launch the application",
    requestedAt: now,
  };

  it("binds one logical Agent session idempotently", () => {
    const session = { agent: "fake", sessionId: "session-1" };
    const bound = recordAgentSession(issueAt("RECEIVED"), session, now);
    expect(bound).toMatchObject({ agentSession: session, revision: 2 });
    expect(recordAgentSession(bound, session, now)).toBe(bound);
    expect(() => recordAgentSession(bound, { ...session, sessionId: "session-2" }, now))
      .toThrow("AGENT_SESSION_ALREADY_BOUND");
  });

  it("replaces an unavailable Assessment session only through explicit rebuild", () => {
    const failed: Issue = {
      ...issueAt("ASSESSMENT_FAILED"),
      agentSession: { agent: "codex", sessionId: "logical-1" },
      assessment,
      assessmentFeedback: "Inspect the router again",
      lastFailure: { stage: "ASSESSMENT", code: "AGENT_SESSION_UNAVAILABLE" },
    };

    const rebuilt = replaceAgentSession(
      failed,
      { agent: "codex", sessionId: "logical-2" },
      "2026-08-21T03:10:00.000Z",
    );

    expect(rebuilt).toMatchObject({
      status: "ASSESSING",
      agentSession: { agent: "codex", sessionId: "logical-2" },
      assessment,
      assessmentFeedback: "Inspect the router again",
      revision: 2,
      updatedAt: "2026-08-21T03:10:00.000Z",
    });
    expect(rebuilt.lastFailure).toBeUndefined();
  });

  it("preserves repair context when rebuilding an unavailable session", () => {
    const failed: Issue = {
      ...issueAt("REPAIR_FAILED"),
      agentSession: { agent: "codex", sessionId: "logical-1" },
      assessment,
      repair: { iteration: 2, feedback: "Show the total", delivery },
      lastFailure: { stage: "REPAIR", code: "AGENT_SESSION_UNAVAILABLE" },
    };

    const rebuilt = replaceAgentSession(
      failed,
      { agent: "codex", sessionId: "logical-2" },
      "2026-08-21T03:10:00.000Z",
    );

    expect(rebuilt).toMatchObject({
      status: "REPAIRING",
      assessment,
      repair: { iteration: 3, feedback: "Show the total", delivery },
    });
  });

  it("rejects rebuild outside the unavailable-session failure boundary", () => {
    const session = { agent: "codex", sessionId: "logical-2" };
    expect(() => replaceAgentSession(issueAt("ASSESSMENT_FAILED"), session, now))
      .toThrow("AGENT_SESSION_REBUILD_NOT_AVAILABLE");
    expect(() => replaceAgentSession({
      ...issueAt("ASSESSMENT_FAILED"),
      agentSession: { agent: "codex", sessionId: "logical-1" },
      lastFailure: { stage: "ASSESSMENT", code: "AGENT_SESSION_UNAVAILABLE" },
    }, { agent: "other", sessionId: "logical-2" }, now))
      .toThrow("AGENT_SESSION_PLUGIN_MISMATCH");
    expect(() => replaceAgentSession({
      ...issueAt("ASSESSMENT_FAILED"),
      agentSession: { agent: "codex", sessionId: "logical-1" },
      lastFailure: { stage: "ASSESSMENT", code: "AGENT_SESSION_UNAVAILABLE" },
    }, { agent: "codex", sessionId: "logical-1" }, now))
      .toThrow("AGENT_SESSION_REBUILD_SAME_SESSION");
  });

  it("records structured assessment success and failure", () => {
    expect(recordAssessment(issueAt("ASSESSING"), assessment, now)).toMatchObject({
      status: "ASSESSING",
      assessment,
      assessmentFeedback: undefined,
      lastFailure: undefined,
    });
    expect(recordAssessmentFailure(issueAt("ASSESSING"), "AGENT_TIMEOUT", now)).toMatchObject({
      status: "ASSESSMENT_FAILED",
      lastFailure: { stage: "ASSESSMENT", code: "AGENT_TIMEOUT" },
    });
  });

  it("starts one bounded finalization recovery attempt", () => {
    const finalizing: Issue = {
      ...issueAt("FINALIZING"),
      finalizationRecovery: { automaticAttempts: 0 },
    };
    const context = {
      recoveryKind: "MERGE_CONFLICT" as const,
      merge: {
        kind: "MERGE_CONFLICT" as const,
        baseBranch: "main",
        baseCommit: "a".repeat(40),
        issueBranch: "ohmybug/ohmybug-21",
        issueCommit: "b".repeat(40),
        conflictPaths: ["src/feature.ts"],
        mergeMessages: ["content conflict"],
        mergePrepared: true,
      },
    };
    const recovering = beginFinalizationRecovery(finalizing, {
      attemptId: "recovery-1",
      diagnostic,
      fingerprintRef: "fingerprint-1",
      context,
    }, now);

    expect(recovering).toMatchObject({
      status: "FINALIZATION_RECOVERY",
      finalizationRecovery: {
        automaticAttempts: 1,
        attemptId: "recovery-1",
        diagnostic,
        fingerprintRef: "fingerprint-1",
        context,
      },
    });
    expect(() => beginFinalizationRecovery({
      ...finalizing,
      finalizationRecovery: { automaticAttempts: 1 },
    }, {
      attemptId: "recovery-2",
      diagnostic,
      fingerprintRef: "fingerprint-2",
      context,
    }, now)).toThrow("FINALIZATION_RECOVERY_BUDGET_SPENT");
  });

  it("returns stale accepted integration to a fresh Repair iteration", () => {
    const finalizing: Issue = {
      ...issueAt("FINALIZING"),
      assessment,
      agentSession: { agent: "codex", sessionId: "logical-1" },
      repair: {
        iteration: 2,
        deliveryDraft: { ...draft, integration: integrationSnapshot },
        delivery,
      },
      resolution: "FIXED",
      finalizationRecovery: { automaticAttempts: 1 },
      lastFailure: { stage: "FINALIZATION_RECOVERY", code: "OLD" },
    };

    const stale = recordBaseIntegrationStale(finalizing, "c".repeat(40), now);

    expect(stale).toMatchObject({
      status: "REPAIRING",
      assessment,
      agentSession: finalizing.agentSession,
      repair: {
        iteration: 3,
        feedback: expect.stringContaining("c".repeat(40)),
      },
      revision: finalizing.revision + 1,
    });
    expect(stale.repair).not.toHaveProperty("deliveryDraft");
    expect(stale.repair).not.toHaveProperty("delivery");
    expect(stale).not.toHaveProperty("resolution");
    expect(stale).not.toHaveProperty("finalizationRecovery");
    expect(stale).not.toHaveProperty("lastFailure");
    expect(() => recordBaseIntegrationStale(issueAt("REPAIRING"), "base", now))
      .toThrow(/Illegal Issue transition/);
  });

  it.each([
    ["UNCHANGED", "FINALIZING"],
    ["CHANGED", "EVIDENCE_CAPTURE"],
    ["UNSAFE", "FINALIZATION_FAILED"],
  ] as const)("routes deterministic %s recovery validation to %s", (validation, status) => {
    const recovering: Issue = {
      ...issueAt("FINALIZATION_RECOVERY"),
      repair: { iteration: 2, delivery },
      finalizationRecovery: {
        automaticAttempts: 1,
        attemptId: "recovery-1",
        diagnostic,
        fingerprintRef: "fingerprint-1",
      },
    };
    const result = recordFinalizationRecoveryResult(recovering, {
      summary: "Removed generated package-manager cache",
      diagnosis: "An empty nested repository blocked git add",
      disposition: "RECOVERED",
      affectedPaths: [".pnpm-store/shared/v11/tmp/_tmp_fixture"],
    }, validation, now);

    expect(result.status).toBe(status);
    expect(result.finalizationRecovery?.summary).toBe(
      "Removed generated package-manager cache",
    );
    if (validation === "CHANGED") {
      expect(result.repair).toMatchObject({
        iteration: 3,
        evidenceRetries: 0,
        deliveryDraft: {
          summary: "Removed generated package-manager cache",
          repairIteration: 3,
        },
      });
      expect(result.repair?.delivery).toBeUndefined();
    }
    if (validation === "UNSAFE") {
      expect(result.lastFailure).toEqual({
        stage: "FINALIZATION_RECOVERY",
        code: "FINALIZATION_RECOVERY_UNSAFE",
      });
    }
  });

  it("persists implementation before evidence and retries proof without a new iteration", () => {
    const drafted = recordImplementationDraft(
      { ...issueAt("REPAIRING"), repair: { iteration: 2 } },
      delivery.summary,
      now,
    );
    expect(drafted).toMatchObject({
      status: "EVIDENCE_CAPTURE",
      repair: { iteration: 2, evidenceRetries: 0, deliveryDraft: draft },
    });
    const repaired = recordDelivery(
      drafted,
      delivery,
      now,
    );
    expect(repaired).toMatchObject({ status: "EVIDENCE_CHECK", repair: { iteration: 2, delivery } });

    const evidenceRejected = recordEvidenceRejection(repaired, "Screenshot is unreadable", now);
    expect(evidenceRejected).toMatchObject({
      status: "EVIDENCE_CAPTURE",
      repair: {
        iteration: 2,
        feedback: "Screenshot is unreadable",
        deliveryDraft: draft,
      },
    });
  });

  it("binds a validated integration snapshot to the delivery draft", () => {
    const drafted = recordImplementationDraft(
      { ...issueAt("REPAIRING"), repair: { iteration: 2 } },
      delivery.summary,
      now,
      integrationSnapshot,
    );
    expect(drafted.repair?.deliveryDraft?.integration).toEqual(integrationSnapshot);

    const rejected = recordEvidenceRejection({
      ...drafted,
      status: "EVIDENCE_CHECK",
      repair: { ...drafted.repair!, delivery },
    }, "Capture again", now);
    expect(rejected.repair?.deliveryDraft?.integration).toEqual(integrationSnapshot);

    const nextIteration = recordImplementationDraft({
      ...drafted,
      status: "REPAIRING",
      repair: { ...drafted.repair!, iteration: 3 },
    }, "New implementation", now);
    expect(nextIteration.repair?.deliveryDraft?.integration).toBeUndefined();
  });

  it("records reviewable evidence and repair failures", () => {
    expect(recordEvidenceAcceptance(issueAt("EVIDENCE_CHECK"), now).status)
      .toBe("EVIDENCE_CHECK");
    expect(recordRepairFailure(issueAt("REPAIRING"), "AGENT_FAILURE", now)).toMatchObject({
      status: "REPAIR_FAILED",
      lastFailure: { stage: "REPAIR", code: "AGENT_FAILURE" },
    });
    expect(recordEvidenceFailure({
      ...issueAt("EVIDENCE_CAPTURE"),
      repair: { iteration: 2, deliveryDraft: draft },
    }, "EVIDENCE_RETRY_LIMIT_REACHED", now)).toMatchObject({
      status: "EVIDENCE_FAILED",
      repair: { iteration: 2, deliveryDraft: draft },
      lastFailure: { stage: "EVIDENCE", code: "EVIDENCE_RETRY_LIMIT_REACHED" },
    });
  });

  it("rejects blank diagnostics", () => {
    expect(() => recordAssessmentFailure(issueAt("ASSESSING"), " ", now))
      .toThrow("ERROR_CODE_REQUIRED");
  });

  it("rejects results that do not belong to the current state", () => {
    expect(() => recordAssessment(issueAt("RECEIVED"), assessment, now)).toThrow(/Illegal Issue transition/);
    expect(() => recordDelivery(issueAt("ASSESSING"), delivery, now)).toThrow(/Illegal Issue transition/);
  });

  it.each([
    ["ASSESSING", "ASSESSMENT", "ASSESS"],
    ["REPAIRING", "REPAIR", "REPAIR"],
    ["EVIDENCE_CAPTURE", "EVIDENCE", "CAPTURE_EVIDENCE"],
    ["FINALIZATION_RECOVERY", "FINALIZATION_RECOVERY", "RECOVER_FINALIZATION"],
  ] as const)("pauses %s for a capability request", (status, stage, operation) => {
    const current = {
      ...issueAt(status),
      ...(status === "EVIDENCE_CAPTURE"
        ? { repair: { iteration: 2, evidenceRetries: 1, deliveryDraft: draft } }
        : {}),
      lastFailure: { stage, code: "AGENT_FAILURE" },
    };
    const paused = recordCapabilityRequest(current, {
      ...capabilityRequest,
      stage,
      operation,
    }, now);

    expect(paused).toMatchObject({
      status: "PERMISSION_REQUIRED",
      pendingCapabilityRequest: {
        id: "request-1",
        resumeStatus: status,
        stage,
        operation,
      },
    });
    expect(paused.repair?.evidenceRetries).toBe(current.repair?.evidenceRetries);
    expect(paused.lastFailure).toBeUndefined();
  });

  it("grants only the active request and restores its exact stage", () => {
    const paused = recordCapabilityRequest(
      issueAt("REPAIRING"),
      capabilityRequest,
      now,
    );
    const later = "2026-08-24T08:10:00.000Z";
    const resumed = grantCapabilityRequest(paused, "request-1", later);

    expect(resumed).toMatchObject({
      status: "REPAIRING",
      capabilityGrants: [{
        capability: "HOST_EXECUTION",
        requestId: "request-1",
        grantedAt: later,
      }],
    });
    expect(resumed.pendingCapabilityRequest).toBeUndefined();
    expect(() => grantCapabilityRequest(paused, "stale", later))
      .toThrow("CAPABILITY_REQUEST_STALE");
  });

  it("normalizes requests to capabilities not already granted", () => {
    const paused = recordCapabilityRequest({
      ...issueAt("REPAIRING"),
      capabilityGrants: [{
        capability: "NETWORK_ACCESS",
        requestId: "request-old",
        grantedAt: now,
      }],
    }, {
      ...capabilityRequest,
      capabilities: ["NETWORK_ACCESS", "HOST_EXECUTION"],
    }, now);

    expect(paused.pendingCapabilityRequest?.capabilities).toEqual(["HOST_EXECUTION"]);
    expect(() => recordCapabilityRequest({
      ...issueAt("REPAIRING"),
      capabilityGrants: [{
        capability: "HOST_EXECUTION",
        requestId: "request-old",
        grantedAt: now,
      }],
    }, capabilityRequest, now)).toThrow("CAPABILITY_ALREADY_GRANTED");
  });
});
