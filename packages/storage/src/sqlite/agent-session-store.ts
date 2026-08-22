import {
  agentSessionRecordSchema,
  type AgentSessionRecord,
  type AgentSessionStore,
} from "@oh-my-bug/core";

import type { RuntimeDatabase } from "./database.js";

interface AgentSessionRow {
  logical_session_id: string;
  agent: string;
  issue_id: string;
  project_id: string;
  provider_session_id: string | null;
  lifecycle: AgentSessionRecord["lifecycle"];
  updated_at: string;
}

export class SqliteAgentSessionStore implements AgentSessionStore {
  constructor(private readonly database: RuntimeDatabase) {}

  async get(logicalSessionId: string): Promise<AgentSessionRecord | undefined> {
    return getAgentSession(this.database, logicalSessionId);
  }

  async save(record: AgentSessionRecord): Promise<void> {
    upsertAgentSession(this.database, record);
  }
}

export function getAgentSession(
  database: RuntimeDatabase,
  logicalSessionId: string,
): AgentSessionRecord | undefined {
  const row = database.prepare(
    `SELECT logical_session_id, agent, issue_id, project_id, provider_session_id, lifecycle, updated_at
     FROM agent_sessions WHERE logical_session_id = ?`,
  ).get(logicalSessionId) as AgentSessionRow | undefined;
  return row ? agentSessionRecordSchema.parse({
    agent: row.agent,
    logicalSessionId: row.logical_session_id,
    issueId: row.issue_id,
    projectId: row.project_id,
    ...(row.provider_session_id ? { providerSessionId: row.provider_session_id } : {}),
    lifecycle: row.lifecycle,
    updatedAt: row.updated_at,
  }) : undefined;
}

export function insertAgentSession(database: RuntimeDatabase, recordInput: AgentSessionRecord): void {
  const record = agentSessionRecordSchema.parse(recordInput);
  try {
    database.prepare(
      `INSERT INTO agent_sessions
       (logical_session_id, agent, issue_id, project_id, provider_session_id, lifecycle, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      record.logicalSessionId,
      record.agent,
      record.issueId,
      record.projectId,
      record.providerSessionId ?? null,
      record.lifecycle,
      record.updatedAt,
    );
  } catch (error) {
    if (isActiveIssueConflict(error)) throw new Error("AGENT_SESSION_ISSUE_CONFLICT", { cause: error });
    throw error;
  }
}

export function retireAgentSession(database: RuntimeDatabase, logicalSessionId: string, updatedAt: string): void {
  const parsed = agentSessionRecordSchema.shape.updatedAt.parse(updatedAt);
  const changed = database.prepare(
    `UPDATE agent_sessions SET lifecycle = 'RETIRED', updated_at = ?
     WHERE logical_session_id = ? AND lifecycle = 'ACTIVE'`,
  ).run(parsed, logicalSessionId);
  if (changed.changes !== 1) throw new Error("AGENT_SESSION_NOT_ACTIVE");
}

function upsertAgentSession(database: RuntimeDatabase, recordInput: AgentSessionRecord): void {
  const record = agentSessionRecordSchema.parse(recordInput);
  try {
    database.prepare(
      `INSERT INTO agent_sessions
       (logical_session_id, agent, issue_id, project_id, provider_session_id, lifecycle, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(logical_session_id) DO UPDATE SET
         agent = excluded.agent,
         issue_id = excluded.issue_id,
         project_id = excluded.project_id,
         provider_session_id = excluded.provider_session_id,
         lifecycle = excluded.lifecycle,
         updated_at = excluded.updated_at`,
    ).run(
      record.logicalSessionId,
      record.agent,
      record.issueId,
      record.projectId,
      record.providerSessionId ?? null,
      record.lifecycle,
      record.updatedAt,
    );
  } catch (error) {
    if (isActiveIssueConflict(error)) throw new Error("AGENT_SESSION_ISSUE_CONFLICT", { cause: error });
    throw error;
  }
}

function isActiveIssueConflict(error: unknown): boolean {
  return error instanceof Error &&
    error.message.includes("UNIQUE constraint failed: agent_sessions.issue_id");
}
