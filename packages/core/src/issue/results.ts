import {
  agentSessionRefSchema,
  assessmentSchema,
  deliverySchema,
} from "../agent/schemas.js";
import {
  reviewRequestSchema,
  reviewSubmissionSchema,
} from "./schema.js";
import type {
  AgentSessionRef,
  Assessment,
  Delivery,
  FinalizationRecoveryResult,
} from "../agent/types.js";
import type {
  FinalizationRecoveryContextSummary,
  Issue,
  IssueFailure,
  PendingCapabilityRequest,
  ReviewChoice,
  ReviewOperation,
  ReviewRequest,
  ReviewSourceStatus,
  ReviewSubmission,
  WorkspaceFinalizationDiagnostic,
} from "./types.js";
import { transitionIssue } from "./workflow.js";

function required(value: string, code: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(code);
  return trimmed;
}

function withFailure(issue: Issue, failure: IssueFailure): Issue {
  return { ...issue, lastFailure: failure };
}

const allowedReviewContinuations: Record<ReviewSourceStatus, ReadonlySet<string>> = {
  ASSESSING: new Set([
    "ASSESSING:ASSESS:-",
    "REPAIRING:REPAIR:-",
    "CLOSED:-:NOT_A_BUG",
    "CLOSED:-:DUPLICATE",
  ]),
  REPAIRING: new Set(["REPAIRING:REPAIR:-"]),
  EVIDENCE_CHECK: new Set([
    "REPAIRING:REPAIR:-",
    "FINALIZING:FINALIZE:FIXED",
    "FINALIZING:FINALIZE:IMPLEMENTED",
  ]),
};

function reviewContinuationKey(choice: ReviewChoice): string {
  const continuation = choice.continuation;
  return [
    continuation.resumeStatus,
    continuation.operation ?? "-",
    continuation.resolution ?? "-",
  ].join(":");
}

export function requestReview(
  issue: Issue,
  requestInput: ReviewRequest,
  now: string,
): Issue {
  if (issue.review || issue.status === "REVIEW_REQUIRED") {
    throw new Error("REVIEW_ALREADY_REQUIRED");
  }
  const request = reviewRequestSchema.parse(requestInput);
  if (issue.status !== request.requestedFrom) {
    throw new Error("REVIEW_SOURCE_STATUS_MISMATCH");
  }
  if (request.choices.some((choice) =>
    !allowedReviewContinuations[request.requestedFrom].has(reviewContinuationKey(choice)))) {
    throw new Error("REVIEW_CONTINUATION_NOT_ALLOWED");
  }
  return {
    ...issue,
    status: "REVIEW_REQUIRED",
    review: request,
    lastFailure: undefined,
    revision: issue.revision + 1,
    updatedAt: now,
  };
}

export function submitReview(
  issue: Issue,
  submissionInput: ReviewSubmission,
  now: string,
): {
  issue: Issue;
  operation: ReviewOperation | null;
  request: ReviewRequest;
  choice: ReviewChoice;
} {
  const submission = reviewSubmissionSchema.parse(submissionInput);
  if (issue.revision !== submission.expectedRevision) {
    throw new Error("REVIEW_SUBMISSION_STALE");
  }
  if (issue.status !== "REVIEW_REQUIRED" || !issue.review) {
    throw new Error("REVIEW_NOT_AVAILABLE");
  }
  const request = issue.review;
  if (request.id !== submission.requestId) throw new Error("REVIEW_REQUEST_STALE");
  const choice = request.choices.find((candidate) => candidate.id === submission.choiceId);
  if (!choice) throw new Error("REVIEW_CHOICE_NOT_AVAILABLE");
  if (choice.feedbackRequired && !submission.feedback) {
    throw new Error("REVIEW_FEEDBACK_REQUIRED");
  }
  const continuation = choice.continuation;
  const next: Issue = {
    ...issue,
    status: continuation.resumeStatus,
    ...(continuation.resolution ? { resolution: continuation.resolution } : {}),
    review: undefined,
    lastFailure: undefined,
    revision: issue.revision + 1,
    updatedAt: now,
  };
  if (continuation.resumeStatus === "CLOSED") {
    delete next.capabilityGrants;
    delete next.pendingCapabilityRequest;
    delete next.finalizationRecovery;
  }
  return {
    issue: next,
    operation: continuation.operation ?? null,
    request,
    choice,
  };
}

const resumeStatusByOperation = {
  ASSESS: "ASSESSING",
  REPAIR: "REPAIRING",
  CAPTURE_EVIDENCE: "EVIDENCE_CAPTURE",
  RECOVER_FINALIZATION: "FINALIZATION_RECOVERY",
} as const;

const stageByOperation = {
  ASSESS: "ASSESSMENT",
  REPAIR: "REPAIR",
  CAPTURE_EVIDENCE: "EVIDENCE",
  RECOVER_FINALIZATION: "FINALIZATION_RECOVERY",
} as const;

export function recordCapabilityRequest(
  issue: Issue,
  request: Omit<PendingCapabilityRequest, "resumeStatus">,
  now: string,
): Issue {
  const expectedStatus = resumeStatusByOperation[request.operation];
  if (issue.status !== expectedStatus || request.stage !== stageByOperation[request.operation]) {
    throw new Error("CAPABILITY_REQUEST_STAGE_MISMATCH");
  }
  const alreadyGranted = new Set(
    issue.capabilityGrants?.map((grant) => grant.capability),
  );
  const capabilities = [...new Set(request.capabilities)]
    .filter((capability) => !alreadyGranted.has(capability));
  if (capabilities.length === 0) throw new Error("CAPABILITY_ALREADY_GRANTED");
  return {
    ...issue,
    status: "PERMISSION_REQUIRED",
    pendingCapabilityRequest: {
      ...request,
      capabilities,
      resumeStatus: expectedStatus,
    },
    lastFailure: undefined,
    revision: issue.revision + 1,
    updatedAt: now,
  };
}

export function grantCapabilityRequest(
  issue: Issue,
  requestId: string,
  now: string,
): Issue {
  const request = issue.pendingCapabilityRequest;
  if (issue.status !== "PERMISSION_REQUIRED" || !request) {
    throw new Error("CAPABILITY_REQUEST_NOT_AVAILABLE");
  }
  if (request.id !== requestId) throw new Error("CAPABILITY_REQUEST_STALE");
  const grants = new Map(
    issue.capabilityGrants?.map((grant) => [grant.capability, grant]),
  );
  for (const capability of request.capabilities) {
    grants.set(capability, { capability, requestId, grantedAt: now });
  }
  return {
    ...issue,
    status: request.resumeStatus,
    capabilityGrants: [...grants.values()],
    pendingCapabilityRequest: undefined,
    revision: issue.revision + 1,
    updatedAt: now,
  };
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

export interface BeginFinalizationRecoveryInput {
  attemptId: string;
  diagnostic: WorkspaceFinalizationDiagnostic;
  fingerprintRef: string;
  context: FinalizationRecoveryContextSummary;
}

export function beginFinalizationRecovery(
  issue: Issue,
  input: BeginFinalizationRecoveryInput,
  now: string,
): Issue {
  if ((issue.finalizationRecovery?.automaticAttempts ?? 0) >= 1) {
    throw new Error("FINALIZATION_RECOVERY_BUDGET_SPENT");
  }
  const attemptId = required(input.attemptId, "FINALIZATION_RECOVERY_ATTEMPT_REQUIRED");
  const fingerprintRef = required(
    input.fingerprintRef,
    "FINALIZATION_RECOVERY_FINGERPRINT_REQUIRED",
  );
  return {
    ...transitionIssue(issue, "BEGIN_FINALIZATION_RECOVERY", now),
    finalizationRecovery: {
      automaticAttempts: 1,
      attemptId,
      diagnostic: input.diagnostic,
      fingerprintRef,
      context: input.context,
    },
    lastFailure: undefined,
  };
}

export type FinalizationRecoveryValidationKind =
  | "UNCHANGED"
  | "CHANGED"
  | "UNSAFE";

export function recordFinalizationRecoveryResult(
  issue: Issue,
  result: FinalizationRecoveryResult,
  validationKind: FinalizationRecoveryValidationKind,
  now: string,
): Issue {
  const summary = required(result.summary, "FINALIZATION_RECOVERY_SUMMARY_REQUIRED");
  const finalizationRecovery = {
    ...(issue.finalizationRecovery ?? { automaticAttempts: 1 as const }),
    summary,
  };
  if (validationKind === "UNCHANGED") {
    return {
      ...transitionIssue(issue, "RETRY_FINALIZATION", now),
      finalizationRecovery,
      lastFailure: undefined,
    };
  }
  if (validationKind === "CHANGED") {
    const iteration = (issue.repair?.iteration ?? 0) + 1;
    return {
      ...transitionIssue(issue, "FINALIZATION_RECOVERY_CHANGED_DELIVERY", now),
      finalizationRecovery,
      repair: {
        iteration,
        evidenceRetries: 0,
        deliveryDraft: {
          summary,
          repairIteration: iteration,
          implementationCompletedAt: now,
        },
      },
      lastFailure: undefined,
    };
  }
  return withFailure({
    ...transitionIssue(issue, "FINALIZATION_RECOVERY_ERRORED", now),
    finalizationRecovery,
  }, {
    stage: "FINALIZATION_RECOVERY",
    code: "FINALIZATION_RECOVERY_UNSAFE",
  });
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
