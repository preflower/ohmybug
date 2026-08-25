import {
  confirmedTitle,
  type Issue,
  type RepairResult,
  type ReviewJson,
  type ReviewChoice,
  type ReviewRequest,
  type ReviewSubmission,
} from "@oh-my-bug/core";

function assessmentChoices(issue: Issue): ReviewChoice[] {
  const verdict = issue.assessment?.verdict;
  const choices: ReviewChoice[] = [];
  if (verdict === "BUG" || verdict === "FEATURE") {
    choices.push({
      id: "implement",
      label: "开始实现",
      continuation: { operation: "REPAIR", resumeStatus: "REPAIRING" },
    });
  }
  if (verdict === "NOT_A_BUG") {
    choices.push({
      id: "not-a-bug",
      label: "确认不是问题",
      continuation: { resumeStatus: "CLOSED", resolution: "NOT_A_BUG" },
    });
  }
  choices.push({
    id: "duplicate",
    label: "确认为重复 Issue",
    continuation: { resumeStatus: "CLOSED", resolution: "DUPLICATE" },
  });
  choices.push({
    id: "reassess",
    label: "要求重新分析",
    feedbackRequired: true,
    continuation: { operation: "ASSESS", resumeStatus: "ASSESSING" },
  });
  return choices;
}

export function assessmentReview(issue: Issue, id: string, now: string): ReviewRequest {
  if (issue.status !== "ASSESSING" || !issue.assessment) {
    throw new Error("ASSESSMENT_CONTEXT_REQUIRED");
  }
  return {
    id,
    kind: "assessment",
    requestedFrom: "ASSESSING",
    payload: {
      assessmentRevision: issue.assessment.revision,
      assessmentContentHash: issue.assessment.contentHash,
      verdict: issue.assessment.verdict,
    },
    choices: assessmentChoices(issue),
    requestedAt: now,
  };
}

export function deliveryReview(issue: Issue, id: string, now: string): ReviewRequest {
  if (issue.status !== "EVIDENCE_CHECK" || !issue.repair?.delivery || !issue.assessment) {
    throw new Error("DELIVERY_REVIEW_CONTEXT_REQUIRED");
  }
  const resolution = issue.assessment.verdict === "FEATURE"
    ? "IMPLEMENTED" as const
    : "FIXED" as const;
  return {
    id,
    kind: "delivery",
    requestedFrom: "EVIDENCE_CHECK",
    payload: {
      repairIteration: issue.repair.iteration,
      evidenceCount: issue.repair.delivery.evidence.length,
    },
    choices: [{
      id: "accept",
      label: "接受交付",
      continuation: {
        operation: "FINALIZE",
        resumeStatus: "FINALIZING",
        resolution,
      },
    }, {
      id: "request-changes",
      label: "要求修改",
      feedbackRequired: true,
      continuation: { operation: "REPAIR", resumeStatus: "REPAIRING" },
    }],
    requestedAt: now,
  };
}

export function businessMergeReview(
  issue: Issue,
  result: Extract<RepairResult, { kind: "BUSINESS_DECISION_REQUIRED" }>,
  id: string,
  now: string,
): ReviewRequest {
  if (issue.status !== "REPAIRING" || !issue.repair) {
    throw new Error("BUSINESS_REVIEW_CONTEXT_REQUIRED");
  }
  return {
    id,
    kind: "business-merge-conflict",
    requestedFrom: "REPAIRING",
    payload: {
      summary: result.summary,
      baseCommit: result.decision.baseCommit,
      issueCommit: result.decision.issueCommit,
      conflictPaths: result.decision.conflictPaths,
      baseIntent: result.decision.baseIntent,
      issueIntent: result.decision.issueIntent,
      incompatibility: result.decision.incompatibility,
      recommendation: result.decision.recommendation,
      rationale: result.decision.rationale,
      choices: result.decision.choices.map((choice) => ({
        id: choice.id,
        label: choice.label,
        description: choice.description,
      })),
    },
    choices: result.decision.choices.map((choice) => ({
      id: choice.id,
      label: choice.label,
      continuation: { operation: "REPAIR", resumeStatus: "REPAIRING" },
    })),
    requestedAt: now,
  };
}

function responseRecord(value: ReviewJson | undefined): Record<string, ReviewJson> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function responseString(
  submission: ReviewSubmission,
  key: string,
  code: string,
): string {
  const value = responseRecord(submission.data)[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value.trim();
}

export function reviewResponseTitle(submission: ReviewSubmission): string {
  return responseString(submission, "title", "REVIEW_TITLE_REQUIRED");
}

export function reviewResponseDuplicate(submission: ReviewSubmission): string {
  return responseString(submission, "duplicateOf", "DUPLICATE_TARGET_NOT_FOUND");
}

export function applyReviewSideEffects(input: {
  previous: Issue;
  next: Issue;
  submission: ReviewSubmission;
  duplicateOf?: string;
}): Issue {
  const { previous, submission } = input;
  const request = previous.review;
  if (!request) throw new Error("REVIEW_NOT_AVAILABLE");
  let next = input.next;
  if (request.kind === "assessment" && submission.choiceId === "implement") {
    if (previous.assessment?.verdict !== "BUG" && previous.assessment?.verdict !== "FEATURE") {
      throw new Error("ASSESSMENT_IMPLEMENTATION_NOT_AVAILABLE");
    }
    next = {
      ...next,
      ...confirmedTitle(previous.assessment.suggestedTitle, reviewResponseTitle(submission)),
      repair: { iteration: (previous.repair?.iteration ?? 0) + 1 },
    };
  }
  if (request.kind === "assessment" && submission.choiceId === "reassess") {
    next = { ...next, assessment: undefined, assessmentFeedback: submission.feedback };
  }
  if (request.kind === "assessment" && submission.choiceId === "duplicate") {
    if (!input.duplicateOf) throw new Error("DUPLICATE_TARGET_NOT_FOUND");
    next = { ...next, duplicateOf: input.duplicateOf };
  }
  if (request.kind === "delivery" && submission.choiceId === "request-changes") {
    next = {
      ...next,
      repair: {
        ...(previous.repair ?? { iteration: 0 }),
        iteration: (previous.repair?.iteration ?? 0) + 1,
        feedback: submission.feedback,
      },
    };
  }
  if (request.kind === "delivery" && submission.choiceId === "accept") {
    next = { ...next, finalizationRecovery: { automaticAttempts: 0 } };
  }
  return next;
}
