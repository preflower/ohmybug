import type { IssueDto } from "../api/types.js";
import {
  Badge,
  type BadgeVariant,
} from "../components/ui/badge.js";
import { issueStatusLabels } from "../../shared/issue-status.js";

const statusVariants: Record<IssueDto["status"], BadgeVariant> = {
  RECEIVED: "neutral",
  ASSESSING: "default",
  REVIEW_REQUIRED: "review",
  ASSESSMENT_FAILED: "destructive",
  PERMISSION_REQUIRED: "review",
  REPAIRING: "default",
  EVIDENCE_CAPTURE: "default",
  EVIDENCE_CHECK: "default",
  EVIDENCE_FAILED: "destructive",
  REPAIR_FAILED: "destructive",
  FINALIZING: "default",
  FINALIZATION_RECOVERY: "review",
  FINALIZATION_FAILED: "destructive",
  COMPLETED: "success",
  CLOSED: "neutral",
  CANCELED: "neutral",
};

export function IssueStatusBadge({
  status,
  recoveryKind,
  recoveryStep,
  reviewKind,
  label = status === "FINALIZATION_RECOVERY"
    && (
      recoveryKind === "MERGE_CONFLICT"
      || recoveryKind === "MERGE_ENVIRONMENT"
      || recoveryStep === "merge"
    )
    ? "AI 正在修复合并"
    : status === "REVIEW_REQUIRED"
      ? reviewKind === "assessment"
        ? "待确认判断"
        : reviewKind === "delivery"
          ? "待验收"
          : reviewKind === "business-merge-conflict"
            ? "待确认业务冲突"
            : "待人工审核"
      : issueStatusLabels[status],
}: {
  status: IssueDto["status"];
  recoveryKind?: "GENERATED_ARTIFACT_CLEANUP" | "MERGE_CONFLICT" | "MERGE_ENVIRONMENT";
  recoveryStep?: "status" | "add" | "commit" | "push" | "merge" | "release" | "unknown";
  reviewKind?: string;
  label?: string;
}) {
  return <Badge variant={statusVariants[status]}>{label}</Badge>;
}
