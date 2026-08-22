export const runtimeSchema = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  project_key TEXT NOT NULL UNIQUE,
  revision INTEGER NOT NULL DEFAULT 1,
  next_issue_sequence INTEGER NOT NULL DEFAULT 1,
  data_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS integration_checkpoints (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  integration TEXT NOT NULL,
  checkpoint_key TEXT NOT NULL,
  checkpoint_value TEXT NOT NULL,
  PRIMARY KEY(project_id, integration, checkpoint_key)
);

CREATE TABLE IF NOT EXISTS agent_sessions (
  logical_session_id TEXT PRIMARY KEY,
  agent TEXT NOT NULL,
  issue_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider_session_id TEXT,
  lifecycle TEXT NOT NULL CHECK(lifecycle IN ('ACTIVE', 'RETIRED')),
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_agent_session_per_issue
  ON agent_sessions(issue_id) WHERE lifecycle = 'ACTIVE';

CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  identifier TEXT NOT NULL,
  status TEXT NOT NULL,
  revision INTEGER NOT NULL,
  pending_operation TEXT,
  agent_session_id TEXT,
  data_json TEXT NOT NULL,
  UNIQUE(project_id, identifier)
);

CREATE TABLE IF NOT EXISTS integration_inputs (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id),
  integration TEXT NOT NULL,
  input_key TEXT NOT NULL,
  group_key TEXT,
  received_at TEXT NOT NULL,
  data_json TEXT NOT NULL,
  UNIQUE(integration, input_key)
);

CREATE TABLE IF NOT EXISTS issue_events (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  event_sequence INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  data_json TEXT NOT NULL,
  UNIQUE(issue_id, event_sequence)
);

CREATE INDEX IF NOT EXISTS issues_status_index ON issues(status);
CREATE INDEX IF NOT EXISTS issues_pending_operation_index ON issues(pending_operation);
CREATE INDEX IF NOT EXISTS integration_inputs_group_index
  ON integration_inputs(project_id, integration, group_key);
`;
