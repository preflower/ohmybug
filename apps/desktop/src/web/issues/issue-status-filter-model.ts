import { issueStatusLabels } from "../../shared/issue-status.js";
import type { IssueDto } from "../api/types.js";

export type IssueStatus = IssueDto["status"];

export const issueStatusOptions = Object.entries(issueStatusLabels) as Array<
  [IssueStatus, string]
>;

export function isIssueStatusVisibleByDefault(status: IssueStatus): boolean {
  return status !== "CANCELED" && status !== "CLOSED";
}

export function createDefaultVisibleIssueStatuses(): Set<IssueStatus> {
  return new Set(
    issueStatusOptions
      .map(([status]) => status)
      .filter(isIssueStatusVisibleByDefault),
  );
}
