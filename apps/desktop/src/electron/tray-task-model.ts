import type { DesktopIssueStatus } from "../shared/issue-status.js";

export interface TrayIssue {
  id: string;
  identifier: string;
  title: string;
  status: DesktopIssueStatus;
  updatedAt: string;
}

export type TrayTaskGroup = "attention" | "processing";
export type TrayTaskIndicator = "failure" | "review" | "processing";

export interface TrayTaskItem extends TrayIssue {
  label: string;
  indicator: TrayTaskIndicator;
}

export interface TrayTaskSection {
  items: TrayTaskItem[];
  total: number;
  overflow: number;
}

export interface TrayTaskModel {
  attention: TrayTaskSection;
  processing: TrayTaskSection;
}

const attentionStatuses = new Set<DesktopIssueStatus>([
  "REVIEW_REQUIRED",
  "PERMISSION_REQUIRED",
  "ASSESSMENT_FAILED",
  "EVIDENCE_FAILED",
  "REPAIR_FAILED",
  "FINALIZATION_FAILED",
  "PAUSED",
]);

const reviewStatuses = new Set<DesktopIssueStatus>([
  "REVIEW_REQUIRED",
  "PERMISSION_REQUIRED",
  "PAUSED",
]);

const failureStatuses = new Set<DesktopIssueStatus>([
  "ASSESSMENT_FAILED",
  "EVIDENCE_FAILED",
  "REPAIR_FAILED",
  "FINALIZATION_FAILED",
]);

const processingStatuses = new Set<DesktopIssueStatus>([
  "RECEIVED",
  "ASSESSING",
  "REPAIRING",
  "EVIDENCE_CAPTURE",
  "EVIDENCE_CHECK",
  "FINALIZING",
  "FINALIZATION_RECOVERY",
]);

const segmenter = new Intl.Segmenter("zh-CN", { granularity: "grapheme" });

export function classifyTrayStatus(status: DesktopIssueStatus): TrayTaskGroup | null {
  if (attentionStatuses.has(status)) return "attention";
  if (processingStatuses.has(status)) return "processing";
  return null;
}

export function classifyTrayIndicator(status: DesktopIssueStatus): TrayTaskIndicator | null {
  if (reviewStatuses.has(status)) return "review";
  if (failureStatuses.has(status)) return "failure";
  if (processingStatuses.has(status)) return "processing";
  return null;
}

export function truncateTrayTitle(title: string, limit = 32): string {
  const graphemes = [...segmenter.segment(title)].map((entry) => entry.segment);
  return graphemes.length <= limit ? title : `${graphemes.slice(0, limit).join("")}…`;
}

export function buildTrayTaskModel(issues: TrayIssue[], limit = 4): TrayTaskModel {
  const grouped: Record<TrayTaskGroup, TrayIssue[]> = { attention: [], processing: [] };
  for (const issue of issues) {
    const group = classifyTrayStatus(issue.status);
    if (group) grouped[group].push(issue);
  }

  const section = (entries: TrayIssue[]): TrayTaskSection => {
    const ordered = [...entries].sort((left, right) => {
      const time = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
      return time || right.identifier.localeCompare(left.identifier, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });
    return {
      total: ordered.length,
      overflow: Math.max(0, ordered.length - limit),
      items: ordered.slice(0, limit).map((issue) => ({
        ...issue,
        label: `${issue.identifier} · ${truncateTrayTitle(issue.title)}`,
        indicator: classifyTrayIndicator(issue.status)!,
      })),
    };
  };

  return {
    attention: section(grouped.attention),
    processing: section(grouped.processing),
  };
}
