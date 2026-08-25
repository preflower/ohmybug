import type { IssueDto } from "../api/types.js";
import {
  Badge,
  type BadgeVariant,
} from "../components/ui/badge.js";

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

const issueStatusLabels: Record<IssueDto["status"], string> = {
  RECEIVED: "等待分析",
  ASSESSING: "分析中",
  REVIEW_REQUIRED: "待人工审核",
  ASSESSMENT_FAILED: "分析失败",
  PERMISSION_REQUIRED: "权限不足",
  REPAIRING: "实现中",
  EVIDENCE_CAPTURE: "实现完成，正在采集证据",
  EVIDENCE_CHECK: "证据检查中",
  EVIDENCE_FAILED: "证据采集失败",
  REPAIR_FAILED: "实现失败",
  FINALIZING: "交付处理中",
  FINALIZATION_RECOVERY: "AI 正在恢复交付",
  FINALIZATION_FAILED: "交付失败，待重新验证",
  COMPLETED: "已完成",
  CLOSED: "已关闭",
  CANCELED: "已取消",
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
