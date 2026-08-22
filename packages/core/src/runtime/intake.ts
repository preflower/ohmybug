import { integrationInputSchema, type IntegrationInput } from "../integration/input.js";
import { decideIntegrationInput } from "../integration/intake.js";
import { createIssue } from "../issue/create.js";
import type { Issue } from "../issue/types.js";
import type { RuntimeTransaction } from "../ports/runtime-store.js";
import type { IntakeResult, NewIssueEvent } from "./types.js";

export interface AcceptIntegrationInputCommand {
  projectId: string;
  input: IntegrationInput;
  transaction: RuntimeTransaction;
  id: () => string;
  now: string;
  beforeCreate?(issue: Issue): void;
}

function intakeEvent(
  command: AcceptIntegrationInputCommand,
  issueId: string,
  type: "ISSUE_CREATED" | "INPUT_APPENDED",
): NewIssueEvent {
  return {
    id: command.id(),
    issueId,
    type,
    actor: "SYSTEM",
    data: { inputId: command.input.id },
    occurredAt: command.now,
  };
}

export function acceptIntegrationInput(
  command: AcceptIntegrationInputCommand,
): IntakeResult {
  const input = integrationInputSchema.parse(command.input);
  const exactIssue = command.transaction.findIssueByInput(
    command.projectId,
    input.integration,
    input.inputKey,
  );
  const activeGroupIssue = !exactIssue && input.groupKey
    ? command.transaction.findActiveIssueByGroup(
        command.projectId,
        input.integration,
        input.groupKey,
      )
    : undefined;
  const decision = decideIntegrationInput(input, {
    exactInputExists: Boolean(exactIssue),
    activeGroupIssueId: activeGroupIssue?.id,
  });

  if (decision.kind === "IGNORE_DUPLICATE") {
    if (!exactIssue) throw new Error("EXACT_INPUT_ISSUE_REQUIRED");
    return { kind: "IGNORED_DUPLICATE", issueId: exactIssue.id };
  }

  if (decision.kind === "APPEND_TO_ISSUE") {
    if (!activeGroupIssue || activeGroupIssue.id !== decision.issueId) {
      throw new Error("ACTIVE_GROUP_ISSUE_REQUIRED");
    }
    const issue = command.transaction.appendInput(
      activeGroupIssue.id,
      activeGroupIssue.revision,
      input,
    );
    command.transaction.appendEvent(
      intakeEvent(command, issue.id, "INPUT_APPENDED"),
    );
    return { kind: "APPENDED", issue };
  }

  const identity = command.transaction.allocateIssueIdentity(command.projectId);
  const issue = createIssue({
    ...identity,
    projectId: command.projectId,
    input,
    now: command.now,
  });
  command.beforeCreate?.(issue);
  command.transaction.insertIssue(issue, "PREPARE");
  command.transaction.appendEvent(
    intakeEvent(command, issue.id, "ISSUE_CREATED"),
  );
  return { kind: "CREATED", issue };
}
