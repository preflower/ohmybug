import type { IntegrationInput } from "../integration/input.js";
import { provisionalTitle } from "./title.js";
import type { Issue } from "./types.js";

export interface CreateIssueInput {
  id: string;
  projectId: string;
  identifier: string;
  input: IntegrationInput;
  now: string;
}

export function createIssue(command: CreateIssueInput): Issue {
  return {
    id: command.id,
    projectId: command.projectId,
    identifier: command.identifier,
    title: provisionalTitle(command.input.data),
    titleSource: "integration",
    status: "RECEIVED",
    inputs: [command.input],
    revision: 1,
    createdAt: command.now,
    updatedAt: command.now,
  };
}
