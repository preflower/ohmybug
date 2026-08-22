import {
  agentSessionRefSchema,
  assessmentSchema,
  deliverySchema,
} from "../agent/schemas.js";
import type {
  AgentSessionRef,
  Assessment,
  Delivery,
} from "../agent/types.js";
import type { Issue, IssueFailure } from "./types.js";
import { transitionIssue } from "./workflow.js";

function required(value: string, code: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(code);
  return trimmed;
}

function withFailure(issue: Issue, failure: IssueFailure): Issue {
  return { ...issue, lastFailure: failure };
}

export function recordAgentSession(
  issue: Issue,
  sessionInput: AgentSessionRef,
  now: string,
): Issue {
  const session = agentSessionRefSchema.parse(sessionInput);
  if (issue.agentSession) {
    if (
      issue.agentSession.agent !== session.agent ||
      issue.agentSession.sessionId !== session.sessionId
    ) {
      throw new Error("AGENT_SESSION_ALREADY_BOUND");
    }
    return issue;
  }
  return {
    ...issue,
    agentSession: session,
    revision: issue.revision + 1,
    updatedAt: now,
  };
}

export function replaceAgentSession(
  issue: Issue,
  sessionInput: AgentSessionRef,
  now: string,
): Issue {
  const session = agentSessionRefSchema.parse(sessionInput);
  const expectedStage = issue.status === "ASSESSMENT_FAILED"
    ? "ASSESSMENT"
    : issue.status === "REPAIR_FAILED"
      ? "REPAIR"
      : undefined;
  if (
    !expectedStage ||
    !issue.agentSession ||
    issue.lastFailure?.stage !== expectedStage ||
    issue.lastFailure.code !== "AGENT_SESSION_UNAVAILABLE"
  ) {
    throw new Error("AGENT_SESSION_REBUILD_NOT_AVAILABLE");
  }
  if (session.agent !== issue.agentSession.agent) {
    throw new Error("AGENT_SESSION_PLUGIN_MISMATCH");
  }
  if (session.sessionId === issue.agentSession.sessionId) {
    throw new Error("AGENT_SESSION_REBUILD_SAME_SESSION");
  }

  const action = issue.status === "ASSESSMENT_FAILED"
    ? "RETRY_ASSESSMENT"
    : "RETRY_REPAIR";
  const transitioned = transitionIssue(issue, action, now);
  return {
    ...transitioned,
    agentSession: session,
    ...(issue.assessment ? { assessment: issue.assessment } : {}),
    ...(issue.status === "REPAIR_FAILED" && issue.repair
      ? { repair: { ...issue.repair, iteration: issue.repair.iteration + 1 } }
      : {}),
    lastFailure: undefined,
  };
}

export function recordAssessment(
  issue: Issue,
  assessmentInput: Assessment,
  now: string,
): Issue {
  const next = transitionIssue(issue, "ASSESSMENT_READY", now);
  return {
    ...next,
    assessment: assessmentSchema.parse(assessmentInput),
    assessmentFeedback: undefined,
    lastFailure: undefined,
  };
}

export function recordAssessmentFailure(
  issue: Issue,
  errorCode: string,
  now: string,
): Issue {
  const code = required(errorCode, "ERROR_CODE_REQUIRED");
  return withFailure(
    transitionIssue(issue, "ASSESSMENT_ERRORED", now),
    { stage: "ASSESSMENT", code },
  );
}

export function recordDelivery(
  issue: Issue,
  deliveryInput: Delivery,
  now: string,
): Issue {
  const delivery = deliverySchema.parse(deliveryInput);
  const next = transitionIssue(issue, "DELIVERY_READY", now);
  return {
    ...next,
    repair: {
      iteration: issue.repair?.iteration ?? 1,
      ...(issue.repair?.evidenceRetries !== undefined
        ? { evidenceRetries: issue.repair.evidenceRetries }
        : {}),
      ...(issue.repair?.automaticEvidenceRetries !== undefined
        ? { automaticEvidenceRetries: issue.repair.automaticEvidenceRetries }
        : {}),
      ...(issue.repair?.deliveryDraft
        ? { deliveryDraft: issue.repair.deliveryDraft }
        : {}),
      delivery,
    },
    lastFailure: undefined,
  };
}

export function recordEvidenceRejection(
  issue: Issue,
  feedbackInput: string,
  now: string,
): Issue {
  const feedback = required(feedbackInput, "FEEDBACK_REQUIRED");
  const next = transitionIssue(issue, "EVIDENCE_REJECTED", now);
  const { delivery: _delivery, ...repair } = next.repair ?? { iteration: 1 };
  return {
    ...next,
    repair: { ...repair, feedback },
  };
}

export function recordEvidenceAcceptance(issue: Issue, now: string): Issue {
  return transitionIssue(issue, "EVIDENCE_ACCEPTED", now);
}

export function recordImplementationDraft(
  issue: Issue,
  summaryInput: string,
  now: string,
): Issue {
  const summary = required(summaryInput, "DELIVERY_SUMMARY_REQUIRED");
  const iteration = issue.repair?.iteration ?? 1;
  const next = transitionIssue(issue, "IMPLEMENTATION_READY", now);
  return {
    ...next,
    repair: {
      iteration,
      evidenceRetries: issue.repair?.evidenceRetries ?? 0,
      deliveryDraft: {
        summary,
        repairIteration: iteration,
        implementationCompletedAt: now,
      },
    },
    lastFailure: undefined,
  };
}

export function recordEvidenceFailure(
  issue: Issue,
  errorCode: string,
  now: string,
): Issue {
  return withFailure(
    transitionIssue(issue, "EVIDENCE_ERRORED", now),
    { stage: "EVIDENCE", code: required(errorCode, "ERROR_CODE_REQUIRED") },
  );
}

export function retryEvidence(issue: Issue, now: string): Issue {
  return {
    ...transitionIssue(issue, "RETRY_EVIDENCE", now),
    lastFailure: undefined,
  };
}

export function recordRepairFailure(
  issue: Issue,
  errorCode: string,
  now: string,
): Issue {
  const code = required(errorCode, "ERROR_CODE_REQUIRED");
  return withFailure(
    transitionIssue(issue, "REPAIR_ERRORED", now),
    { stage: "REPAIR", code },
  );
}

export function requestAssessmentChanges(
  issue: Issue,
  feedbackInput: string,
  now: string,
): Issue {
  const feedback = required(feedbackInput, "FEEDBACK_REQUIRED");
  return {
    ...transitionIssue(issue, "REQUEST_REASSESSMENT", now),
    assessmentFeedback: feedback,
    lastFailure: undefined,
  };
}

export function requestDeliveryChanges(
  issue: Issue,
  feedbackInput: string,
  now: string,
): Issue {
  const feedback = required(feedbackInput, "FEEDBACK_REQUIRED");
  const next = transitionIssue(issue, "REJECT_DELIVERY", now);
  return {
    ...next,
    repair: { ...(next.repair ?? { iteration: 1 }), feedback },
    lastFailure: undefined,
  };
}
