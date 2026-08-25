import {
  issueSchema,
  parsePersistedIssue,
  type Issue,
  type NewIssueEvent,
} from "@oh-my-bug/core";
import type {
  ModuleStateStore,
  WorkspaceBinding,
  WorkspacePersistence,
  WorkspaceProjectConfiguration,
} from "@oh-my-bug/module-api";

import type { RuntimeDatabase } from "./database.js";

interface JsonRow {
  data_json: string;
}

interface IssueRow extends JsonRow {
  revision: number;
}

interface ProjectConfigurationRow {
  provider_id: string;
  config_json: string;
}

interface BindingRow {
  issue_id: string;
  provider_id: string;
  resource_id: string;
  status: WorkspaceBinding["status"];
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

function parseBinding(row: BindingRow | undefined): WorkspaceBinding | undefined {
  if (!row) return undefined;
  return {
    issueId: row.issue_id,
    providerId: row.provider_id,
    resourceId: row.resource_id,
    status: row.status,
    ...(row.last_error ? { lastError: row.last_error } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function assertRelated(
  binding: WorkspaceBinding,
  issue: Issue,
  event: NewIssueEvent,
): void {
  if (binding.issueId !== issue.id || event.issueId !== issue.id) {
    throw new Error("WORKSPACE_ISSUE_MISMATCH");
  }
}

function writeBinding(database: RuntimeDatabase, binding: WorkspaceBinding): void {
  database.prepare(
    `INSERT INTO workspace_bindings
      (issue_id, provider_id, resource_id, status, last_error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(issue_id) DO UPDATE SET
       provider_id = excluded.provider_id,
       resource_id = excluded.resource_id,
       status = excluded.status,
       last_error = excluded.last_error,
       updated_at = excluded.updated_at`,
  ).run(
    binding.issueId,
    binding.providerId,
    binding.resourceId,
    binding.status,
    binding.lastError ?? null,
    binding.createdAt,
    binding.updatedAt,
  );
}

function appendEvent(database: RuntimeDatabase, event: NewIssueEvent): void {
  const sequence = database.prepare(
    `SELECT COALESCE(MAX(event_sequence), 0) + 1 AS sequence
     FROM issue_events WHERE issue_id = ?`,
  ).get(event.issueId) as { sequence: number };
  database.prepare(
    `INSERT INTO issue_events
      (id, issue_id, event_sequence, event_type, actor, occurred_at, data_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    event.id,
    event.issueId,
    sequence.sequence,
    event.type,
    event.actor,
    event.occurredAt,
    JSON.stringify(event.data),
  );
}

export class SqliteWorkspaceStore implements WorkspacePersistence, ModuleStateStore {
  constructor(private readonly database: RuntimeDatabase) {}

  transaction<T>(work: () => T): T {
    return this.database.transaction(work)();
  }

  getProjectConfiguration(
    projectId: string,
  ): WorkspaceProjectConfiguration | undefined {
    const row = this.database.prepare(
      `SELECT provider_id, config_json
       FROM workspace_project_configurations WHERE project_id = ?`,
    ).get(projectId) as ProjectConfigurationRow | undefined;
    return row
      ? {
          provider: row.provider_id,
          config: JSON.parse(row.config_json) as WorkspaceProjectConfiguration["config"],
        }
      : undefined;
  }

  setProjectConfiguration(
    projectId: string,
    value: WorkspaceProjectConfiguration,
  ): void {
    this.database.prepare(
      `INSERT INTO workspace_project_configurations (project_id, provider_id, config_json)
       VALUES (?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET
         provider_id = excluded.provider_id,
         config_json = excluded.config_json`,
    ).run(projectId, value.provider, JSON.stringify(value.config));
  }

  getBinding(issueId: string): WorkspaceBinding | undefined {
    const row = this.database.prepare(
      `SELECT issue_id, provider_id, resource_id, status, last_error, created_at, updated_at
       FROM workspace_bindings WHERE issue_id = ?`,
    ).get(issueId) as BindingRow | undefined;
    return parseBinding(row);
  }

  recoverBinding(binding: WorkspaceBinding): void {
    if (binding.status !== "READY") throw new Error("WORKSPACE_BINDING_NOT_READY");
    writeBinding(this.database, binding);
  }

  beginAcquire(binding: WorkspaceBinding): void {
    if (binding.status !== "PREPARING") throw new Error("WORKSPACE_BINDING_NOT_PREPARING");
    writeBinding(this.database, binding);
  }

  completeAcquire(input: {
    binding: WorkspaceBinding;
    issue: Issue;
    expectedRevision: number;
    event: NewIssueEvent;
  }): Issue {
    return this.database.transaction(() => {
      const issue = issueSchema.parse(input.issue);
      assertRelated(input.binding, issue, input.event);
      if (input.binding.status !== "READY") throw new Error("WORKSPACE_BINDING_NOT_READY");
      if (!issue.projectPath) throw new Error("PROJECT_PATH_REQUIRED");

      const currentRow = this.database.prepare(
        "SELECT revision, data_json FROM issues WHERE id = ?",
      ).get(issue.id) as IssueRow | undefined;
      if (!currentRow || currentRow.revision !== input.expectedRevision) {
        throw new Error("CONCURRENT_UPDATE");
      }
      const current = parsePersistedIssue(JSON.parse(currentRow.data_json));
      if (current.projectPath && current.projectPath !== issue.projectPath) {
        throw new Error("PROJECT_PATH_CONFLICT");
      }

      const changed = this.database.prepare(
        `UPDATE issues
         SET status = ?, revision = ?, pending_operation = 'ASSESS',
             agent_session_id = ?, data_json = ?
         WHERE id = ? AND revision = ?`,
      ).run(
        issue.status,
        issue.revision,
        issue.agentSession?.sessionId ?? null,
        JSON.stringify(issue),
        issue.id,
        input.expectedRevision,
      );
      if (changed.changes !== 1) throw new Error("CONCURRENT_UPDATE");
      writeBinding(this.database, input.binding);
      appendEvent(this.database, input.event);
      return issue;
    })();
  }

  failAcquire(binding: WorkspaceBinding, event: NewIssueEvent): void {
    if (binding.issueId !== event.issueId) throw new Error("WORKSPACE_ISSUE_MISMATCH");
    if (binding.status !== "FAILED") throw new Error("WORKSPACE_BINDING_NOT_FAILED");
    this.database.transaction(() => {
      writeBinding(this.database, binding);
      appendEvent(this.database, event);
    })();
  }

  completeRelease(input: {
    binding: WorkspaceBinding;
    issue: Issue;
    expectedRevision: number;
    event: NewIssueEvent;
  }): Issue {
    return this.database.transaction(() => {
      const issue = issueSchema.parse(input.issue);
      assertRelated(input.binding, issue, input.event);
      if (input.binding.status !== "RELEASED") {
        throw new Error("WORKSPACE_BINDING_NOT_RELEASED");
      }
      if (issue.status !== "COMPLETED") throw new Error("ISSUE_NOT_COMPLETED");

      const changed = this.database.prepare(
        `UPDATE issues
         SET status = ?, revision = ?, pending_operation = NULL,
             agent_session_id = ?, data_json = ?
         WHERE id = ? AND revision = ?`,
      ).run(
        issue.status,
        issue.revision,
        issue.agentSession?.sessionId ?? null,
        JSON.stringify(issue),
        issue.id,
        input.expectedRevision,
      );
      if (changed.changes !== 1) throw new Error("CONCURRENT_UPDATE");
      writeBinding(this.database, input.binding);
      appendEvent(this.database, input.event);
      return issue;
    })();
  }

  get<T>(moduleId: string, resourceId: string): T | undefined {
    const row = this.database.prepare(
      "SELECT data_json FROM module_resources WHERE module_id = ? AND resource_id = ?",
    ).get(moduleId, resourceId) as JsonRow | undefined;
    return row ? JSON.parse(row.data_json) as T : undefined;
  }

  set<T>(moduleId: string, resourceId: string, value: T): void {
    this.database.prepare(
      `INSERT INTO module_resources (module_id, resource_id, data_json)
       VALUES (?, ?, ?)
       ON CONFLICT(module_id, resource_id) DO UPDATE SET data_json = excluded.data_json`,
    ).run(moduleId, resourceId, JSON.stringify(value));
  }

  delete(moduleId: string, resourceId: string): void {
    this.database.prepare(
      "DELETE FROM module_resources WHERE module_id = ? AND resource_id = ?",
    ).run(moduleId, resourceId);
  }
}
