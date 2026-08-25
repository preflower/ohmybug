import type {
  Issue,
  IssueStatus,
} from "./types.js";

export type IssueAction =
  | "START_ASSESSMENT"
  | "ASSESSMENT_READY"
  | "ASSESSMENT_ERRORED"
  | "RETRY_ASSESSMENT"
  | "IMPLEMENTATION_READY"
  | "DELIVERY_READY"
  | "EVIDENCE_REJECTED"
  | "EVIDENCE_ACCEPTED"
  | "EVIDENCE_ERRORED"
  | "RETRY_EVIDENCE"
  | "REPAIR_ERRORED"
  | "RETRY_REPAIR"
  | "BEGIN_FINALIZATION_RECOVERY"
  | "FINALIZATION_RECOVERY_ERRORED"
  | "FINALIZATION_RECOVERY_CHANGED_DELIVERY"
  | "FINALIZATION_ERRORED"
  | "BASE_INTEGRATION_STALE"
  | "RETRY_FINALIZATION"
  | "RETRY_FINALIZATION_REPAIR"
  | "COMPLETE_DELIVERY"
  | "CANCEL";

const transitions: Record<
  IssueStatus,
  Partial<Record<IssueAction, IssueStatus>>
> = {
  RECEIVED: { START_ASSESSMENT: "ASSESSING", CANCEL: "CANCELED" },
  ASSESSING: {
    ASSESSMENT_READY: "ASSESSING",
    ASSESSMENT_ERRORED: "ASSESSMENT_FAILED",
    CANCEL: "CANCELED",
  },
  ASSESSMENT_FAILED: {
    RETRY_ASSESSMENT: "ASSESSING",
    CANCEL: "CANCELED",
  },
  REPAIRING: {
    IMPLEMENTATION_READY: "EVIDENCE_CAPTURE",
    REPAIR_ERRORED: "REPAIR_FAILED",
    CANCEL: "CANCELED",
  },
  EVIDENCE_CAPTURE: {
    DELIVERY_READY: "EVIDENCE_CHECK",
    EVIDENCE_ERRORED: "EVIDENCE_FAILED",
    CANCEL: "CANCELED",
  },
  EVIDENCE_CHECK: {
    EVIDENCE_REJECTED: "EVIDENCE_CAPTURE",
    EVIDENCE_ACCEPTED: "EVIDENCE_CHECK",
    EVIDENCE_ERRORED: "EVIDENCE_FAILED",
    CANCEL: "CANCELED",
  },
  EVIDENCE_FAILED: {
    RETRY_EVIDENCE: "EVIDENCE_CAPTURE",
    CANCEL: "CANCELED",
  },
  REPAIR_FAILED: {
    RETRY_REPAIR: "REPAIRING",
    CANCEL: "CANCELED",
  },
  PERMISSION_REQUIRED: { CANCEL: "CANCELED" },
  REVIEW_REQUIRED: { CANCEL: "CANCELED" },
  FINALIZING: {
    BEGIN_FINALIZATION_RECOVERY: "FINALIZATION_RECOVERY",
    FINALIZATION_ERRORED: "FINALIZATION_FAILED",
    BASE_INTEGRATION_STALE: "REPAIRING",
    COMPLETE_DELIVERY: "COMPLETED",
  },
  FINALIZATION_RECOVERY: {
    RETRY_FINALIZATION: "FINALIZING",
    FINALIZATION_RECOVERY_ERRORED: "FINALIZATION_FAILED",
    FINALIZATION_RECOVERY_CHANGED_DELIVERY: "EVIDENCE_CAPTURE",
    CANCEL: "CANCELED",
  },
  FINALIZATION_FAILED: { RETRY_FINALIZATION_REPAIR: "REPAIRING" },
  COMPLETED: {},
  CLOSED: {},
  CANCELED: {},
};

function applyTransition(
  issue: Issue,
  action: IssueAction,
  now: string,
): Issue {
  const nextStatus = transitions[issue.status][action];
  if (!nextStatus) {
    throw new Error(
      "Illegal Issue transition: " + issue.status + " + " + action,
    );
  }

  const resolution = action === "CANCEL" ? "CANCELED" : undefined;
  const repair = action === "RETRY_REPAIR"
    ? {
        iteration: (issue.repair?.iteration ?? 0) + 1,
        ...(issue.repair?.delivery
          ? { delivery: issue.repair.delivery }
          : {}),
      }
    : issue.repair;
  const finalizationRecovery = action === "RETRY_FINALIZATION" && issue.status === "FINALIZATION_FAILED"
    ? { automaticAttempts: 0 as const }
    : issue.finalizationRecovery;
  const nextIssue: Issue = {
    ...issue,
    status: nextStatus,
    ...(resolution ? { resolution } : {}),
    ...(repair ? { repair } : {}),
    ...(finalizationRecovery ? { finalizationRecovery } : {}),
    revision: issue.revision + 1,
    updatedAt: now,
  };
  if (
    action === "START_ASSESSMENT" ||
    action === "RETRY_ASSESSMENT"
  ) {
    delete nextIssue.assessment;
  }
  if (action === "RETRY_ASSESSMENT" || action === "RETRY_REPAIR") {
    delete nextIssue.lastFailure;
  }
  if (["COMPLETED", "CLOSED", "CANCELED"].includes(nextIssue.status)) {
    delete nextIssue.capabilityGrants;
    delete nextIssue.pendingCapabilityRequest;
    delete nextIssue.finalizationRecovery;
    delete nextIssue.review;
    delete nextIssue.lastFailure;
  }
  return nextIssue;
}

export function transitionIssue(
  issue: Issue,
  action: IssueAction,
  now: string,
): Issue {
  return applyTransition(issue, action, now);
}
