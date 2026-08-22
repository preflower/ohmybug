import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import BetterSqlite3 from "better-sqlite3";

import { runtimeSchema } from "./schema.js";

export type RuntimeDatabase = BetterSqlite3.Database;

export function openRuntimeDatabase(path: string): RuntimeDatabase {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const database = new BetterSqlite3(path);
  database.pragma("foreign_keys = ON");
  if (path !== ":memory:") database.pragma("journal_mode = WAL");
  database.exec(runtimeSchema);
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
