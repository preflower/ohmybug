import type { IssueDto } from "../api/types.js";
import {
  Badge,
  type BadgeVariant,
} from "../components/ui/badge.js";
import { issueStatusLabels } from "../../shared/issue-status.js";

const statusVariants: Record<IssueDto["status"], BadgeVariant> = {
  RECEIVED: "neutral",
  ASSESSING: "default",
  ASSESSMENT_REVIEW: "review",
  ASSESSMENT_FAILED: "destructive",
  PERMISSION_REQUIRED: "review",
  REPAIRING: "default",
  EVIDENCE_CAPTURE: "default",
  EVIDENCE_CHECK: "default",
  EVIDENCE_FAILED: "destructive",
  REPAIR_FAILED: "destructive",
  ACCEPTANCE_REVIEW: "review",
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
  label = status === "FINALIZATION_RECOVERY"
    && (
      recoveryKind === "MERGE_CONFLICT"
      || recoveryKind === "MERGE_ENVIRONMENT"
      || recoveryStep === "merge"
    )
    ? "AI 正在修复合并"
    : issueStatusLabels[status],
}: {
  status: IssueDto["status"];
  recoveryKind?: "GENERATED_ARTIFACT_CLEANUP" | "MERGE_CONFLICT" | "MERGE_ENVIRONMENT";
  recoveryStep?: "status" | "add" | "commit" | "push" | "merge" | "release" | "unknown";
  label?: string;
}) {
  return <Badge variant={statusVariants[status]}>{label}</Badge>;
}
