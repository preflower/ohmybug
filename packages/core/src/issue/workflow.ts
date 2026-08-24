import { confirmedTitle } from "./title.js";
import type {
  Issue,
  IssueResolution,
  IssueStatus,
} from "./types.js";

export type IssueAction =
  | "START_ASSESSMENT"
  | "ASSESSMENT_READY"
  | "ASSESSMENT_ERRORED"
  | "RETRY_ASSESSMENT"
  | "REQUEST_REASSESSMENT"
  | "IMPLEMENTATION_READY"
  | "DELIVERY_READY"
  | "EVIDENCE_REJECTED"
  | "EVIDENCE_ACCEPTED"
  | "EVIDENCE_ERRORED"
  | "RETRY_EVIDENCE"
  | "REPAIR_ERRORED"
  | "RETRY_REPAIR"
  | "REJECT_DELIVERY"
  | "APPROVE_DELIVERY"
  | "BEGIN_FINALIZATION_RECOVERY"
  | "FINALIZATION_RECOVERY_ERRORED"
  | "FINALIZATION_RECOVERY_CHANGED_DELIVERY"
  | "FINALIZATION_ERRORED"
  | "RETRY_FINALIZATION"
  | "COMPLETE_DELIVERY"
  | "CANCEL";

type InternalIssueAction =
  | IssueAction
  | "APPROVE_IMPLEMENTATION"
  | "CONFIRM_NOT_A_BUG"
  | "CONFIRM_DUPLICATE";

const transitions: Record<
  IssueStatus,
  Partial<Record<InternalIssueAction, IssueStatus>>
> = {
  RECEIVED: { START_ASSESSMENT: "ASSESSING", CANCEL: "CANCELED" },
  ASSESSING: {
    ASSESSMENT_READY: "ASSESSMENT_REVIEW",
    ASSESSMENT_ERRORED: "ASSESSMENT_FAILED",
    CANCEL: "CANCELED",
  },
  ASSESSMENT_REVIEW: {
    REQUEST_REASSESSMENT: "ASSESSING",
    CONFIRM_NOT_A_BUG: "CLOSED",
    CONFIRM_DUPLICATE: "CLOSED",
    APPROVE_IMPLEMENTATION: "REPAIRING",
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
    EVIDENCE_ACCEPTED: "ACCEPTANCE_REVIEW",
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
  ACCEPTANCE_REVIEW: {
    REJECT_DELIVERY: "REPAIRING",
    APPROVE_DELIVERY: "FINALIZING",
    CANCEL: "CANCELED",
  },
  FINALIZING: {
    BEGIN_FINALIZATION_RECOVERY: "FINALIZATION_RECOVERY",
    FINALIZATION_ERRORED: "FINALIZATION_FAILED",
    COMPLETE_DELIVERY: "COMPLETED",
  },
  FINALIZATION_RECOVERY: {
    RETRY_FINALIZATION: "FINALIZING",
    FINALIZATION_RECOVERY_ERRORED: "FINALIZATION_FAILED",
    FINALIZATION_RECOVERY_CHANGED_DELIVERY: "EVIDENCE_CAPTURE",
    CANCEL: "CANCELED",
  },
  FINALIZATION_FAILED: { RETRY_FINALIZATION: "FINALIZING" },
  COMPLETED: {},
  CLOSED: {},
  CANCELED: {},
};

function resolutionFor(
  issue: Issue,
  action: InternalIssueAction,
): IssueResolution | undefined {
  switch (action) {
    case "CONFIRM_NOT_A_BUG":
      return "NOT_A_BUG";
    case "CONFIRM_DUPLICATE":
      return "DUPLICATE";
    case "APPROVE_DELIVERY":
      return issue.assessment?.verdict === "FEATURE" ? "IMPLEMENTED" : "FIXED";
    case "CANCEL":
      return "CANCELED";
    default:
      return undefined;
  }
}

function startsRepairIteration(action: InternalIssueAction): boolean {
  return [
    "APPROVE_IMPLEMENTATION",
    "RETRY_REPAIR",
    "REJECT_DELIVERY",
  ].includes(action);
}

function applyTransition(
  issue: Issue,
  action: InternalIssueAction,
  now: string,
): Issue {
  const nextStatus = transitions[issue.status][action];
  if (!nextStatus) {
    throw new Error(
      "Illegal Issue transition: " + issue.status + " + " + action,
    );
  }

  const resolution = resolutionFor(issue, action);
  const repair = startsRepairIteration(action)
    ? {
        iteration: (issue.repair?.iteration ?? 0) + 1,
        ...(issue.repair?.delivery
          ? { delivery: issue.repair.delivery }
          : {}),
      }
    : issue.repair;
  const finalizationRecovery = action === "APPROVE_DELIVERY"
    || (action === "RETRY_FINALIZATION" && issue.status === "FINALIZATION_FAILED")
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
    action === "REQUEST_REASSESSMENT" ||
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

interface AssessmentReference {
  assessmentRevision: number;
  assessmentContentHash: string;
}

export interface ApproveAssessmentInput extends AssessmentReference {
  title: string;
}

function assertCurrentAssessment(
  issue: Issue,
  reference: AssessmentReference,
): asserts issue is Issue & { assessment: NonNullable<Issue["assessment"]> } {
  if (
    !issue.assessment ||
    issue.assessment.revision !== reference.assessmentRevision ||
    issue.assessment.contentHash !== reference.assessmentContentHash
  ) {
    throw new Error("Stale Assessment approval");
  }
}

export function approveAssessment(
  issue: Issue,
  approval: ApproveAssessmentInput,
  now: string,
): Issue {
  assertCurrentAssessment(issue, approval);
  if (issue.assessment.verdict !== "BUG" && issue.assessment.verdict !== "FEATURE") {
    throw new Error("Only a BUG or FEATURE Assessment can grant implementation authority");
  }

  return {
    ...applyTransition(issue, "APPROVE_IMPLEMENTATION", now),
    ...confirmedTitle(issue.assessment.suggestedTitle, approval.title),
  };
}

/** @deprecated Use approveAssessment. */
export const approveBugAssessment = approveAssessment;
/** @deprecated Use ApproveAssessmentInput. */
export type ApproveBugAssessmentInput = ApproveAssessmentInput;

export type ConfirmAssessmentResolutionInput = AssessmentReference &
  (
    | { resolution: "NOT_A_BUG" }
    | { resolution: "DUPLICATE"; duplicateOf: string }
  );

export function confirmAssessmentResolution(
  issue: Issue,
  confirmation: ConfirmAssessmentResolutionInput,
  now: string,
): Issue {
  assertCurrentAssessment(issue, confirmation);

  if (
    confirmation.resolution === "NOT_A_BUG" &&
    issue.assessment.verdict !== "NOT_A_BUG"
  ) {
    throw new Error(
      "Only a NOT_A_BUG Assessment can be confirmed as NOT_A_BUG",
    );
  }

  const action =
    confirmation.resolution === "NOT_A_BUG"
      ? "CONFIRM_NOT_A_BUG"
      : "CONFIRM_DUPLICATE";
  const closed = applyTransition(issue, action, now);
  if (confirmation.resolution !== "DUPLICATE") {
    return closed;
  }

  const duplicateOf = confirmation.duplicateOf.trim();
  if (!duplicateOf || duplicateOf === issue.id) {
    throw new Error("Invalid duplicate Issue target");
  }
  return { ...closed, duplicateOf };
}
