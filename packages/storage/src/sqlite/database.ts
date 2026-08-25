import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { parsePersistedIssue } from "@oh-my-bug/core";

import { runtimeSchema } from "./schema.js";

export type RuntimeDatabase = BetterSqlite3.Database;

interface TableDefinitionRow {
  sql: string | null;
}

function migrateIntegrationInputsToProjectScope(database: RuntimeDatabase): void {
  const table = database.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'integration_inputs'",
  ).get() as TableDefinitionRow | undefined;
  const normalizedSql = table?.sql?.replace(/\s+/g, "").toLowerCase();
  if (!normalizedSql?.includes("unique(integration,input_key)")) return;

  database.transaction(() => {
    database.exec(`
      DROP INDEX IF EXISTS integration_inputs_group_index;
      ALTER TABLE integration_inputs RENAME TO integration_inputs_legacy;

      CREATE TABLE integration_inputs (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id),
        integration TEXT NOT NULL,
        input_key TEXT NOT NULL,
        group_key TEXT,
        received_at TEXT NOT NULL,
        data_json TEXT NOT NULL,
        UNIQUE(project_id, integration, input_key)
      );

      INSERT INTO integration_inputs
        (id, issue_id, project_id, integration, input_key, group_key, received_at, data_json)
      SELECT id, issue_id, project_id, integration, input_key, group_key, received_at, data_json
      FROM integration_inputs_legacy;

      DROP TABLE integration_inputs_legacy;
      CREATE INDEX integration_inputs_group_index
        ON integration_inputs(project_id, integration, group_key);
    `);
  })();
}

function migrateDeliveryFinalizationStatuses(database: RuntimeDatabase): void {
  database.prepare(
    `UPDATE issues
     SET status = CASE
           WHEN pending_operation = 'FINALIZE' THEN 'FINALIZING'
           ELSE 'FINALIZATION_FAILED'
         END,
         data_json = json_set(
           data_json,
           '$.status',
           CASE
             WHEN pending_operation = 'FINALIZE' THEN 'FINALIZING'
             ELSE 'FINALIZATION_FAILED'
           END
         )
     WHERE status = 'APPROVED'
        OR json_extract(data_json, '$.status') = 'APPROVED'`,
  ).run();
}

function migrateFinalizationRecoveryBudget(database: RuntimeDatabase): void {
  database.prepare(
    `UPDATE issues
     SET data_json = json_set(
       data_json,
       '$.finalizationRecovery',
       json_object('automaticAttempts', 0)
     )
     WHERE status IN ('FINALIZING', 'FINALIZATION_FAILED')
       AND json_type(data_json, '$.finalizationRecovery') IS NULL`,
  ).run();
}

function migrateUnifiedReviewStatuses(database: RuntimeDatabase): void {
  const rows = database.prepare(
    `SELECT id, data_json FROM issues
     WHERE status IN ('ASSESSMENT_REVIEW', 'ACCEPTANCE_REVIEW')`,
  ).all() as Array<{ id: string; data_json: string }>;
  if (rows.length === 0) return;
  const update = database.prepare(
    `UPDATE issues SET status = ?, revision = ?, data_json = ? WHERE id = ?`,
  );
  database.transaction(() => {
    for (const row of rows) {
      const issue = parsePersistedIssue(JSON.parse(row.data_json));
      update.run(issue.status, issue.revision, JSON.stringify(issue), row.id);
    }
  })();
}

export function openRuntimeDatabase(path: string): RuntimeDatabase {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const database = new BetterSqlite3(path);
  database.pragma("foreign_keys = ON");
  if (path !== ":memory:") database.pragma("journal_mode = WAL");
  database.exec(runtimeSchema);
  migrateUnifiedReviewStatuses(database);
  migrateDeliveryFinalizationStatuses(database);
  migrateFinalizationRecoveryBudget(database);
  migrateIntegrationInputsToProjectScope(database);
  database.prepare(
    `UPDATE issues
     SET status = 'COMPLETED', data_json = json_set(data_json, '$.status', 'COMPLETED')
     WHERE status = 'CLOSED'
       AND json_extract(data_json, '$.resolution') IN ('FIXED', 'IMPLEMENTED')`,
  ).run();
  return database;
}

export function openRuntimeDatabaseReadOnly(path: string): RuntimeDatabase {
  const database = new BetterSqlite3(path, { readonly: true, fileMustExist: true });
  database.pragma("query_only = ON");
  return database;
}
