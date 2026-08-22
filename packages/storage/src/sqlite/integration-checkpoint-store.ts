import type { IntegrationCheckpointStore } from "@oh-my-bug/core";

import type { RuntimeDatabase } from "./database.js";

export class SqliteIntegrationCheckpointStore implements IntegrationCheckpointStore {
  constructor(private readonly database: RuntimeDatabase) {}

  get(projectId: string, integration: string, key: string): string | undefined {
    const row = this.database.prepare(
      `SELECT checkpoint_value FROM integration_checkpoints
       WHERE project_id = ? AND integration = ? AND checkpoint_key = ?`,
    ).get(projectId, integration, key) as { checkpoint_value: string } | undefined;
    return row?.checkpoint_value;
  }

  save(
    projectId: string,
    integration: string,
    key: string,
    value: string | undefined,
  ): void {
    assertValue(projectId, "PROJECT_ID_REQUIRED");
    assertValue(integration, "INTEGRATION_REQUIRED");
    assertValue(key, "CHECKPOINT_KEY_REQUIRED");
    if (value === undefined) {
      this.database.prepare(
        `DELETE FROM integration_checkpoints
         WHERE project_id = ? AND integration = ? AND checkpoint_key = ?`,
      ).run(projectId, integration, key);
      return;
    }
    this.database.prepare(
      `INSERT INTO integration_checkpoints
       (project_id, integration, checkpoint_key, checkpoint_value)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(project_id, integration, checkpoint_key)
       DO UPDATE SET checkpoint_value = excluded.checkpoint_value`,
    ).run(projectId, integration, key, value);
  }
}

function assertValue(value: string, code: string): void {
  if (!value.trim()) throw new Error(code);
}
