import type { Data } from "../integration/data.js";
import type { Issue } from "./types.js";

const MAX_TITLE_LENGTH = 120;

function normalizedTitle(value: string): string {
  const title = value.trim().replace(/\s+/g, " ");
  if (!title) {
    throw new Error("Issue title cannot be blank");
  }
  return title.slice(0, MAX_TITLE_LENGTH);
}

export function provisionalTitle(data: Data): string {
  const firstLine = data.content.trim().split(/\r?\n/, 1)[0] ?? "";
  return normalizedTitle(data.summary ?? firstLine);
}

export interface ConfirmIssueTitleInput {
  assessmentTitle: string;
  title: string;
  now: string;
}

export function confirmedTitle(
  assessmentTitle: string,
  title: string,
): Pick<Issue, "title" | "titleSource"> {
  const normalizedAssessment = normalizedTitle(assessmentTitle);
  const normalizedConfirmed = normalizedTitle(title);
  return {
    title: normalizedConfirmed,
    titleSource:
      normalizedConfirmed === normalizedAssessment ? "assessment" : "user",
  };
}

export function confirmIssueTitle(
  issue: Issue,
  input: ConfirmIssueTitleInput,
): Issue {
  return {
    ...issue,
    ...confirmedTitle(input.assessmentTitle, input.title),
    revision: issue.revision + 1,
    updatedAt: input.now,
  };
}
