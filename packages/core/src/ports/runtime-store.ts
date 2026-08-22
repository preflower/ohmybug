import type { IntegrationInput } from "../integration/input.js";
import type { Issue } from "../issue/types.js";
import type { AgentSessionRecord } from "./agent-session-store.js";
import type {
  IssueEvent,
  NewIssueEvent,
  PendingOperation,
  RuntimeProject,
} from "../runtime/types.js";

export interface RuntimeStore {
  transaction<T>(work: (transaction: RuntimeTransaction) => T): T;
  registerProject(project: RuntimeProject): void;
  listProjects(): RuntimeProject[];
  getProject(projectId: string): RuntimeProject | undefined;
  updateProject(project: RuntimeProject, expectedRevision: number): RuntimeProject;
  getIssue(issueId: string): Issue | undefined;
  listIssues(projectId?: string): Issue[];
  listPendingOperations(): Array<{
    issue: Issue;
    operation: PendingOperation;
  }>;
  readEvents(issueId: string, afterSequence?: number): IssueEvent[];
  close(): void;
}

export interface RuntimeTransaction {
  getAgentSession(logicalSessionId: string): AgentSessionRecord | undefined;
  insertAgentSession(record: AgentSessionRecord): void;
  retireAgentSession(logicalSessionId: string, updatedAt: string): void;
  findIssueByInput(integration: string, inputKey: string): Issue | undefined;
  findActiveIssueByGroup(
    projectId: string,
    integration: string,
    groupKey: string,
  ): Issue | undefined;
  allocateIssueIdentity(projectId: string): {
    id: string;
    identifier: string;
  };
  insertIssue(issue: Issue, pendingOperation: PendingOperation): void;
  appendInput(
    issueId: string,
    expectedRevision: number,
    input: IntegrationInput,
  ): Issue;
  updateIssue(
    issue: Issue,
    expectedRevision: number,
    pendingOperation: PendingOperation | null,
  ): void;
  appendEvent(event: NewIssueEvent): IssueEvent;
}
