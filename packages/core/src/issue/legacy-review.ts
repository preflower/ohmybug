import { requestReview } from "./results.js";
import { issueSchema } from "./schema.js";
import type {
  Issue,
  ReviewChoice,
  ReviewRequest,
} from "./types.js";

type LegacyReviewStatus = "ASSESSMENT_REVIEW" | "ACCEPTANCE_REVIEW";

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

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
  if (issue.assessment?.suspectedDuplicateOf) {
    choices.push({
      id: "duplicate",
      label: "确认为重复 Issue",
      continuation: { resumeStatus: "CLOSED", resolution: "DUPLICATE" },
    });
  }
  choices.push({
    id: "reassess",
    label: "要求重新分析",
    feedbackRequired: true,
    continuation: { operation: "ASSESS", resumeStatus: "ASSESSING" },
  });
  return choices;
}

function legacyReviewRequest(
  issue: Issue,
  legacyStatus: LegacyReviewStatus,
  legacyRevision: number,
): ReviewRequest {
  if (legacyStatus === "ASSESSMENT_REVIEW") {
    return {
      id: `legacy:${issue.id}:${legacyRevision}:assessment`,
      kind: "assessment",
      requestedFrom: "ASSESSING",
      payload: {
        assessmentRevision: issue.assessment?.revision ?? null,
        assessmentContentHash: issue.assessment?.contentHash ?? null,
        verdict: issue.assessment?.verdict ?? null,
      },
      choices: assessmentChoices(issue),
      requestedAt: issue.updatedAt,
    };
  }
  const resolution = issue.assessment?.verdict === "FEATURE"
    ? "IMPLEMENTED" as const
    : "FIXED" as const;
  return {
    id: `legacy:${issue.id}:${legacyRevision}:delivery`,
    kind: "delivery",
    requestedFrom: "EVIDENCE_CHECK",
    payload: {
      repairIteration: issue.repair?.iteration ?? null,
      evidenceCount: issue.repair?.delivery?.evidence.length ?? 0,
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
    requestedAt: issue.updatedAt,
  };
}

export function parsePersistedIssue(value: unknown): Issue {
  const record = objectRecord(value);
  const status = record?.status;
  if (status !== "ASSESSMENT_REVIEW" && status !== "ACCEPTANCE_REVIEW") {
    return issueSchema.parse(value);
  }
  const sourceStatus = status === "ASSESSMENT_REVIEW" ? "ASSESSING" : "EVIDENCE_CHECK";
  const current = issueSchema.parse({ ...record, status: sourceStatus });
  return requestReview(
    current,
    legacyReviewRequest(current, status, current.revision),
    current.updatedAt,
  );
}
