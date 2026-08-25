import type { IssueDto } from "../api/types.js";
import {
  Badge,
  type BadgeVariant,
} from "../components/ui/badge.js";

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

const issueStatusLabels: Record<IssueDto["status"], string> = {
  RECEIVED: "等待分析",
  ASSESSING: "分析中",
  ASSESSMENT_REVIEW: "待确认判断",
  ASSESSMENT_FAILED: "分析失败",
  PERMISSION_REQUIRED: "权限不足",
  REPAIRING: "实现中",
  EVIDENCE_CAPTURE: "实现完成，正在采集证据",
  EVIDENCE_CHECK: "证据检查中",
  EVIDENCE_FAILED: "证据采集失败",
  REPAIR_FAILED: "实现失败",
  ACCEPTANCE_REVIEW: "待验收",
  FINALIZING: "交付处理中",
  FINALIZATION_RECOVERY: "AI 正在恢复交付",
  FINALIZATION_FAILED: "交付失败，待重试",
  COMPLETED: "已完成",
  CLOSED: "已关闭",
  CANCELED: "已取消",
};

export function IssueStatusBadge({
  status,
  label = issueStatusLabels[status],
}: {
  status: IssueDto["status"];
  label?: string;
}) {
  return <Badge variant={statusVariants[status]}>{label}</Badge>;
}
