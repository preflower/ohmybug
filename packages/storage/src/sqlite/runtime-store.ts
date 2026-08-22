import { randomUUID } from "node:crypto";

import {
  integrationInputSchema,
  issueSchema,
  runtimeProjectSchema,
  type AgentSessionRecord,
  type IntegrationInput,
  type Issue,
  type IssueEvent,
  type NewIssueEvent,
  type PendingOperation,
  type RuntimeProject,
  type RuntimeStore,
  type RuntimeTransaction,
} from "@oh-my-bug/core";

import type { RuntimeDatabase } from "./database.js";
import {
  getAgentSession as readAgentSession,
  insertAgentSession as createAgentSession,
  retireAgentSession as retireStoredAgentSession,
} from "./agent-session-store.js";

interface JsonRow { data_json: string }
interface ProjectRow extends JsonRow { id: string; project_key: string; revision: number }
interface PendingRow extends JsonRow { pending_operation: PendingOperation }
interface EventRow {
  id: string;
  issue_id: string;
  event_sequence: number;
  event_type: string;
  actor: IssueEvent["actor"];
  occurred_at: string;
  data_json: string;
}

export interface SqliteRuntimeStoreOptions {
  id?: () => string;
  now?: () => string;
}

function parseIssue(row: JsonRow | undefined): Issue | undefined {
  return row ? issueSchema.parse(JSON.parse(row.data_json)) : undefined;
}

function inputValues(issue: Issue, input: IntegrationInput): unknown[] {
  return [
    input.id,
    issue.id,
    issue.projectId,
    input.integration,
    input.inputKey,
    input.groupKey ?? null,
    input.receivedAt,
    JSON.stringify(input),
  ];
}

export class SqliteRuntimeStore implements RuntimeStore, RuntimeTransaction {
  private readonly id: () => string;
  private readonly now: () => string;

  constructor(
    private readonly database: RuntimeDatabase,
    options: SqliteRuntimeStoreOptions = {},
  ) {
    this.id = options.id ?? randomUUID;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  transaction<T>(work: (transaction: RuntimeTransaction) => T): T {
    return this.database.transaction(() => work(this))();
  }

  registerProject(projectInput: RuntimeProject): void {
    const project = runtimeProjectSchema.parse(projectInput);
    const existing = this.database
      .prepare("SELECT id, project_key, revision, data_json FROM projects WHERE id = ? OR project_key = ?")
      .get(project.id, project.key) as ProjectRow | undefined;
    if (existing) {
      const saved = runtimeProjectSchema.parse(JSON.parse(existing.data_json));
      const candidate = runtimeProjectSchema.parse({
        ...project,
        revision: project.revision ?? saved.revision,
        createdAt: project.createdAt ?? saved.createdAt,
        updatedAt: project.updatedAt ?? saved.updatedAt,
      });
      if (JSON.stringify(saved) === JSON.stringify(candidate)) return;
      throw new Error("PROJECT_CONFLICT");
    }
    const timestamp = this.now();
    const saved = runtimeProjectSchema.parse({
      ...project,
      revision: project.revision ?? 1,
      createdAt: project.createdAt ?? timestamp,
      updatedAt: project.updatedAt ?? timestamp,
    });
    this.database.prepare(
      "INSERT INTO projects (id, project_key, revision, next_issue_sequence, data_json) VALUES (?, ?, ?, 1, ?)",
    ).run(saved.id, saved.key, saved.revision, JSON.stringify(saved));
  }

  listProjects(): RuntimeProject[] {
    const rows = this.database.prepare(
      "SELECT data_json FROM projects ORDER BY project_key",
    ).all() as JsonRow[];
    return rows.map((row) => runtimeProjectSchema.parse(JSON.parse(row.data_json)));
  }

  getProject(projectId: string): RuntimeProject | undefined {
    const row = this.database.prepare("SELECT data_json FROM projects WHERE id = ?")
      .get(projectId) as JsonRow | undefined;
    return row ? runtimeProjectSchema.parse(JSON.parse(row.data_json)) : undefined;
  }

  updateProject(projectInput: RuntimeProject, expectedRevision: number): RuntimeProject {
    const project = runtimeProjectSchema.parse(projectInput);
    const current = this.getProject(project.id);
    if (!current || current.revision !== expectedRevision) throw new Error("CONCURRENT_UPDATE");
    const updated = runtimeProjectSchema.parse({
      ...project,
      revision: expectedRevision + 1,
      createdAt: current.createdAt,
      updatedAt: this.now(),
    });
    let changed: { changes: number };
    try {
      changed = this.database.prepare(
        `UPDATE projects SET project_key = ?, revision = ?, data_json = ?
         WHERE id = ? AND revision = ?`,
      ).run(
        updated.key,
        updated.revision,
        JSON.stringify(updated),
        updated.id,
        expectedRevision,
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
        throw new Error("PROJECT_CONFLICT", { cause: error });
      }
      throw error;
    }
    if (changed.changes !== 1) throw new Error("CONCURRENT_UPDATE");
    return updated;
  }

  getIssue(issueId: string): Issue | undefined {
    return parseIssue(this.database.prepare("SELECT data_json FROM issues WHERE id = ?")
      .get(issueId) as JsonRow | undefined);
  }

  listIssues(projectId?: string): Issue[] {
    const rows = (projectId
      ? this.database.prepare("SELECT data_json FROM issues WHERE project_id = ? ORDER BY identifier").all(projectId)
      : this.database.prepare("SELECT data_json FROM issues ORDER BY project_id, identifier").all()) as JsonRow[];
    return rows.map((row) => issueSchema.parse(JSON.parse(row.data_json)));
  }

  listPendingOperations(): Array<{ issue: Issue; operation: PendingOperation }> {
    const rows = this.database.prepare(
      `SELECT data_json, pending_operation FROM issues
       WHERE pending_operation IS NOT NULL ORDER BY project_id, identifier`,
    ).all() as PendingRow[];
    return rows.map((row) => ({
      issue: issueSchema.parse(JSON.parse(row.data_json)),
      operation: row.pending_operation,
    }));
  }

  readEvents(issueId: string, afterSequence = 0): IssueEvent[] {
    const rows = this.database.prepare(
      `SELECT id, issue_id, event_sequence, event_type, actor, occurred_at, data_json
       FROM issue_events WHERE issue_id = ? AND event_sequence > ?
       ORDER BY event_sequence`,
    ).all(issueId, afterSequence) as EventRow[];
    return rows.map((row) => ({
      id: row.id,
      issueId: row.issue_id,
      sequence: row.event_sequence,
      type: row.event_type,
      actor: row.actor,
      occurredAt: row.occurred_at,
      data: JSON.parse(row.data_json) as Record<string, unknown>,
    }));
  }

  close(): void { this.database.close(); }

  getAgentSession(logicalSessionId: string): AgentSessionRecord | undefined {
    return readAgentSession(this.database, logicalSessionId);
  }

  insertAgentSession(record: AgentSessionRecord): void {
    createAgentSession(this.database, record);
  }

  retireAgentSession(logicalSessionId: string, updatedAt: string): void {
    retireStoredAgentSession(this.database, logicalSessionId, updatedAt);
  }

  findIssueByInput(integration: string, inputKey: string): Issue | undefined {
    return parseIssue(this.database.prepare(
      `SELECT issues.data_json FROM integration_inputs
       JOIN issues ON issues.id = integration_inputs.issue_id
       WHERE integration_inputs.integration = ? AND integration_inputs.input_key = ?`,
    ).get(integration, inputKey) as JsonRow | undefined);
  }

  findActiveIssueByGroup(
    projectId: string,
    integration: string,
    groupKey: string,
  ): Issue | undefined {
    return parseIssue(this.database.prepare(
      `SELECT issues.data_json FROM integration_inputs
       JOIN issues ON issues.id = integration_inputs.issue_id
       WHERE integration_inputs.project_id = ?
         AND integration_inputs.integration = ?
         AND integration_inputs.group_key = ?
         AND issues.status NOT IN ('COMPLETED', 'CLOSED', 'CANCELED')
       ORDER BY issues.rowid DESC LIMIT 1`,
    ).get(projectId, integration, groupKey) as JsonRow | undefined);
  }

  allocateIssueIdentity(projectId: string): { id: string; identifier: string } {
    const row = this.database.prepare(
      "SELECT project_key, next_issue_sequence FROM projects WHERE id = ?",
    ).get(projectId) as { project_key: string; next_issue_sequence: number } | undefined;
    if (!row) throw new Error("PROJECT_NOT_FOUND");
    this.database.prepare(
      "UPDATE projects SET next_issue_sequence = next_issue_sequence + 1 WHERE id = ?",
    ).run(projectId);
    return { id: this.id(), identifier: `${row.project_key}-${row.next_issue_sequence}` };
  }

  insertIssue(issueInput: Issue, pendingOperation: PendingOperation): void {
    const issue = issueSchema.parse(issueInput);
    this.database.prepare(
      `INSERT INTO issues
       (id, project_id, identifier, status, revision, pending_operation, agent_session_id, data_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      issue.id,
      issue.projectId,
      issue.identifier,
      issue.status,
      issue.revision,
      pendingOperation,
      issue.agentSession?.sessionId ?? null,
      JSON.stringify(issue),
    );
    const statement = this.database.prepare(
      `INSERT INTO integration_inputs
       (id, issue_id, project_id, integration, input_key, group_key, received_at, data_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const input of issue.inputs) statement.run(...inputValues(issue, input));
  }

  appendInput(
    issueId: string,
    expectedRevision: number,
    inputValue: IntegrationInput,
  ): Issue {
    const current = this.getIssue(issueId);
    if (!current || current.revision !== expectedRevision) throw new Error("CONCURRENT_UPDATE");
    const input = integrationInputSchema.parse(inputValue);
    const updated = issueSchema.parse({
      ...current,
      inputs: [...current.inputs, input],
      revision: current.revision + 1,
      updatedAt: input.receivedAt,
    });
    const changed = this.database.prepare(
      `UPDATE issues SET revision = ?, data_json = ? WHERE id = ? AND revision = ?`,
    ).run(updated.revision, JSON.stringify(updated), issueId, expectedRevision);
    if (changed.changes !== 1) throw new Error("CONCURRENT_UPDATE");
    this.database.prepare(
      `INSERT INTO integration_inputs
       (id, issue_id, project_id, integration, input_key, group_key, received_at, data_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(...inputValues(updated, input));
    return updated;
  }

  updateIssue(
    issueInput: Issue,
    expectedRevision: number,
    pendingOperation: PendingOperation | null,
  ): void {
    const issue = issueSchema.parse(issueInput);
    const changed = this.database.prepare(
      `UPDATE issues SET status = ?, revision = ?, pending_operation = ?, agent_session_id = ?, data_json = ?
       WHERE id = ? AND revision = ?`,
    ).run(
      issue.status,
      issue.revision,
      pendingOperation,
      issue.agentSession?.sessionId ?? null,
      JSON.stringify(issue),
      issue.id,
      expectedRevision,
    );
    if (changed.changes !== 1) throw new Error("CONCURRENT_UPDATE");
  }

  appendEvent(event: NewIssueEvent): IssueEvent {
    const sequenceRow = this.database.prepare(
      `SELECT COALESCE(MAX(event_sequence), 0) + 1 AS sequence
       FROM issue_events WHERE issue_id = ?`,
    ).get(event.issueId) as { sequence: number };
    const complete: IssueEvent = { ...event, sequence: sequenceRow.sequence };
    this.database.prepare(
      `INSERT INTO issue_events
       (id, issue_id, event_sequence, event_type, actor, occurred_at, data_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      complete.id,
      complete.issueId,
      complete.sequence,
      complete.type,
      complete.actor,
      complete.occurredAt,
      JSON.stringify(complete.data),
    );
    return complete;
  }
}
