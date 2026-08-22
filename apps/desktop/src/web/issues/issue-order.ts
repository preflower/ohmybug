import type { IssueDto } from "../api/types.js";

export function newestIssuesFirst(issues: IssueDto[]): IssueDto[] {
  return [...issues].sort((left, right) => {
    const createdAt = Date.parse(right.createdAt) - Date.parse(left.createdAt);
    if (createdAt !== 0) return createdAt;
    return right.identifier.localeCompare(left.identifier, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
}
