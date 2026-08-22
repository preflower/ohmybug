import type { IntegrationInput } from "./input.js";

export interface IntakeFacts {
  exactInputExists: boolean;
  activeGroupIssueId?: string;
}

export type IntakeDecision =
  | { kind: "IGNORE_DUPLICATE" }
  | { kind: "APPEND_TO_ISSUE"; issueId: string }
  | { kind: "CREATE_ISSUE" };

export function decideIntegrationInput(
  input: IntegrationInput,
  facts: IntakeFacts,
): IntakeDecision {
  if (facts.exactInputExists) {
    return { kind: "IGNORE_DUPLICATE" };
  }

  if (input.groupKey && facts.activeGroupIssueId) {
    return {
      kind: "APPEND_TO_ISSUE",
      issueId: facts.activeGroupIssueId,
    };
  }

  return { kind: "CREATE_ISSUE" };
}
