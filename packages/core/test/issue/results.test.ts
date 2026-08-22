import { describe, expect, it } from "vitest";

import {
  recordAgentSession,
  recordAssessment,
  recordAssessmentFailure,
  recordDelivery,
  recordEvidenceAcceptance,
  recordEvidenceRejection,
  recordRepairFailure,
  replaceAgentSession,
  requestAssessmentChanges,
  requestDeliveryChanges,
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
      status: "ASSESSMENT_REVIEW",
      assessment,
      assessmentFeedback: undefined,
      lastFailure: undefined,
    });
    expect(recordAssessmentFailure(issueAt("ASSESSING"), "AGENT_TIMEOUT", now)).toMatchObject({
      status: "ASSESSMENT_FAILED",
      lastFailure: { stage: "ASSESSMENT", code: "AGENT_TIMEOUT" },
    });
  });

  it("preserves the previous Delivery and explicit feedback across repair loops", () => {
    const repaired = recordDelivery(
      { ...issueAt("REPAIRING"), repair: { iteration: 2 } },
      delivery,
      now,
    );
    expect(repaired).toMatchObject({ status: "EVIDENCE_CHECK", repair: { iteration: 2, delivery } });

    const evidenceRejected = recordEvidenceRejection(repaired, "Screenshot is unreadable", now);
    expect(evidenceRejected).toMatchObject({
      status: "REPAIRING",
      repair: { iteration: 3, feedback: "Screenshot is unreadable", delivery },
    });
    const humanRejected = requestDeliveryChanges(
      { ...repaired, status: "ACCEPTANCE_REVIEW" },
      "Show the full response",
      now,
    );
    expect(humanRejected).toMatchObject({
      status: "REPAIRING",
      repair: { iteration: 3, feedback: "Show the full response", delivery },
    });
  });

  it("records reviewable evidence and repair failures", () => {
    expect(recordEvidenceAcceptance(issueAt("EVIDENCE_CHECK"), now).status)
      .toBe("ACCEPTANCE_REVIEW");
    expect(recordRepairFailure(issueAt("REPAIRING"), "AGENT_FAILURE", now)).toMatchObject({
      status: "REPAIR_FAILED",
      lastFailure: { stage: "REPAIR", code: "AGENT_FAILURE" },
    });
    expect(recordRepairFailure(issueAt("EVIDENCE_CHECK"), "EVIDENCE_INSPECTION_FAILED", now))
      .toMatchObject({
        status: "REPAIR_FAILED",
        lastFailure: { stage: "REPAIR", code: "EVIDENCE_INSPECTION_FAILED" },
      });
  });

  it("persists assessment feedback and rejects blank diagnostics", () => {
    expect(requestAssessmentChanges(issueAt("ASSESSMENT_REVIEW"), "Inspect the router", now))
      .toMatchObject({ status: "ASSESSING", assessmentFeedback: "Inspect the router" });
    expect(() => requestAssessmentChanges(issueAt("ASSESSMENT_REVIEW"), " ", now))
      .toThrow("FEEDBACK_REQUIRED");
    expect(() => recordAssessmentFailure(issueAt("ASSESSING"), " ", now))
      .toThrow("ERROR_CODE_REQUIRED");
  });

  it("rejects results that do not belong to the current state", () => {
    expect(() => recordAssessment(issueAt("RECEIVED"), assessment, now)).toThrow(/Illegal Issue transition/);
    expect(() => recordDelivery(issueAt("ASSESSMENT_REVIEW"), delivery, now)).toThrow(/Illegal Issue transition/);
  });
});
