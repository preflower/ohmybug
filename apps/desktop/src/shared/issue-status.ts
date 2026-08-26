import type { RuntimeOperationOutput } from "@oh-my-bug/runtime/protocol";

export type DesktopIssueStatus = RuntimeOperationOutput<"getIssue">["status"];

export const issueStatusLabels: Record<DesktopIssueStatus, string> = {
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
  PAUSED: "已暂停",
  COMPLETED: "已完成",
  CLOSED: "已关闭",
  CANCELED: "已取消",
};

export function isTerminalIssueStatus(status: DesktopIssueStatus): boolean {
  return status === "COMPLETED" || status === "CLOSED" || status === "CANCELED";
}
