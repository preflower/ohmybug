import { describe, expect, it } from "vitest";
import BetterSqlite3 from "better-sqlite3";

import {
  openRuntimeDatabase,
  openRuntimeDatabaseReadOnly,
  SqliteRuntimeStore,
} from "../../src/index.js";
import { runtimeSchema } from "../../src/sqlite/schema.js";
import { createStore, databasePath, input, issue, now, project } from "../helpers.js";

describe("SQLite Runtime database", () => {
  it("migrates legacy assessment and acceptance review rows", () => {
    const path = databasePath();
    const legacy = new BetterSqlite3(path);
    legacy.exec(runtimeSchema);
    legacy.prepare(
      `INSERT INTO projects (id, project_key, revision, next_issue_sequence, data_json)
       VALUES (?, ?, 1, 3, ?)`,
    ).run(project.id, project.key, JSON.stringify(project));
    const insert = legacy.prepare(
      `INSERT INTO issues
        (id, project_id, identifier, status, revision, pending_operation, data_json)
       VALUES (?, ?, ?, ?, 7, NULL, ?)`,
    );
    const assessment = {
      revision: 2,
      contentHash: "a".repeat(64),
      verdict: "BUG",
      suggestedTitle: "Fix payment route",
      reasoning: "The route is missing",
      rootCause: "Route registration was removed",
      solution: "Restore the route",
    };
    insert.run(
      "legacy-assessment",
      project.id,
      "OMB-1",
      "ASSESSMENT_REVIEW",
      JSON.stringify({
        ...issue,
        id: "legacy-assessment",
        status: "ASSESSMENT_REVIEW",
        revision: 7,
        assessment,
      }),
    );
    insert.run(
      "legacy-delivery",
      project.id,
      "OMB-2",
      "ACCEPTANCE_REVIEW",
      JSON.stringify({
        ...issue,
        id: "legacy-delivery",
        identifier: "OMB-2",
        status: "ACCEPTANCE_REVIEW",
        revision: 7,
        assessment,
        repair: {
          iteration: 1,
          delivery: {
            summary: "Payment route restored",
            evidence: [{
              type: "screenshot",
              label: "Payment page",
              evidenceId: `sha256-${"b".repeat(64)}`,
            }],
          },
        },
      }),
    );
    legacy.close();

    const store = new SqliteRuntimeStore(openRuntimeDatabase(path));
    expect(store.getIssue("legacy-assessment")).toMatchObject({
      status: "REVIEW_REQUIRED",
      revision: 8,
      review: {
        id: "legacy:legacy-assessment:7:assessment",
        kind: "assessment",
        requestedFrom: "ASSESSING",
      },
    });
    expect(store.getIssue("legacy-delivery")).toMatchObject({
      status: "REVIEW_REQUIRED",
      revision: 8,
      review: {
        id: "legacy:legacy-delivery:7:delivery",
        kind: "delivery",
        requestedFrom: "EVIDENCE_CHECK",
      },
    });
    const rows = store.listIssues();
    expect(rows).toHaveLength(2);
    store.close();

    const raw = new BetterSqlite3(path, { readonly: true });
    expect(raw.prepare("SELECT status, revision FROM issues ORDER BY id").all()).toEqual([
      { status: "REVIEW_REQUIRED", revision: 8 },
      { status: "REVIEW_REQUIRED", revision: 8 },
    ]);
    raw.close();
  });

  it("decodes a legacy review from a read-only database without writing", () => {
    const path = databasePath();
    const legacy = new BetterSqlite3(path);
    legacy.exec(runtimeSchema);
    legacy.prepare(
      `INSERT INTO projects (id, project_key, revision, next_issue_sequence, data_json)
       VALUES (?, ?, 1, 2, ?)`,
    ).run(project.id, project.key, JSON.stringify(project));
    legacy.prepare(
      `INSERT INTO issues
        (id, project_id, identifier, status, revision, pending_operation, data_json)
       VALUES (?, ?, ?, 'ASSESSMENT_REVIEW', 7, NULL, ?)`,
    ).run(
      "legacy-read-only",
      project.id,
      "OMB-1",
      JSON.stringify({
        ...issue,
        id: "legacy-read-only",
        status: "ASSESSMENT_REVIEW",
        revision: 7,
        assessment: {
          revision: 1,
          contentHash: "a".repeat(64),
          verdict: "NOT_A_BUG",
          suggestedTitle: "Expected behavior",
          reasoning: "The product intentionally behaves this way",
        },
      }),
    );
    legacy.close();

    const store = new SqliteRuntimeStore(openRuntimeDatabaseReadOnly(path));
    expect(store.getIssue("legacy-read-only")).toMatchObject({
      status: "REVIEW_REQUIRED",
      revision: 8,
      review: { kind: "assessment" },
    });
    store.close();

    const raw = new BetterSqlite3(path, { readonly: true });
    expect(raw.prepare("SELECT status, revision FROM issues").get()).toEqual({
      status: "ASSESSMENT_REVIEW",
      revision: 7,
    });
    raw.close();
  });

  it("rolls back every write when the transaction callback throws", () => {
    const store = createStore();
    store.registerProject(project);
    expect(() => store.transaction((transaction) => {
      transaction.insertIssue(issue, "ASSESS");
      throw new Error("ROLLBACK_PROBE");
    })).toThrow("ROLLBACK_PROBE");
    expect(store.getIssue(issue.id)).toBeUndefined();
    store.close();
  });

  it("registers identical project context idempotently and rejects conflicts", () => {
    const store = createStore();
    store.registerProject(project);
    store.registerProject(project);
    expect(store.getProject(project.id)).toEqual({
      ...project,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
    expect(() => store.registerProject({ ...project, path: "/tmp/other-project" }))
      .toThrow("PROJECT_CONFLICT");
    expect(() => store.registerProject({ ...project, id: "project-2" }))
      .toThrow("PROJECT_CONFLICT");
    store.close();
  });

  it("migrates the legacy global input identity constraint", () => {
    const path = databasePath();
    const legacy = new BetterSqlite3(path);
    legacy.exec(runtimeSchema.replace(
      "UNIQUE(project_id, integration, input_key)",
      "UNIQUE(integration, input_key)",
    ));
    const legacyStore = new SqliteRuntimeStore(legacy, {
      id: () => "legacy-generated-id",
      now: () => now,
    });
    legacyStore.registerProject(project);
    legacyStore.transaction((transaction) => transaction.insertIssue(issue, "ASSESS"));
    legacyStore.close();

    const store = createStore(path);
    const otherProject = { ...project, id: "project-2", key: "OTHER" };
    const otherIssue = {
      ...issue,
      id: "issue-2",
      projectId: otherProject.id,
      identifier: "OTHER-1",
      inputs: [{ ...input, id: "input-2" }],
    };
    store.registerProject(otherProject);
    store.transaction((transaction) => transaction.insertIssue(otherIssue, "ASSESS"));

    expect(store.listIssues()).toEqual([issue, otherIssue]);
    store.close();
  });

  it("migrates active and failed legacy APPROVED rows", () => {
    const path = databasePath();
    const legacy = new BetterSqlite3(path);
    legacy.exec(runtimeSchema);
    legacy.prepare(
      `INSERT INTO projects (id, project_key, revision, next_issue_sequence, data_json)
       VALUES (?, ?, 1, 3, ?)`,
    ).run(project.id, project.key, JSON.stringify(project));
    const insert = legacy.prepare(
      `INSERT INTO issues
        (id, project_id, identifier, status, revision, pending_operation, data_json)
       VALUES (?, ?, ?, 'APPROVED', 7, ?, ?)`,
    );
    insert.run(
      "legacy-active",
      project.id,
      "OMB-1",
      "FINALIZE",
      JSON.stringify({
        ...issue,
        id: "legacy-active",
        status: "APPROVED",
        revision: 7,
      }),
    );
    insert.run(
      "legacy-failed",
      project.id,
      "OMB-2",
      null,
      JSON.stringify({
        ...issue,
        id: "legacy-failed",
        identifier: "OMB-2",
        status: "APPROVED",
        revision: 7,
      }),
    );
    legacy.close();

    const database = openRuntimeDatabase(path);
    const store = new SqliteRuntimeStore(database);
    expect(store.getIssue("legacy-active")?.status).toBe("FINALIZING");
    expect(store.getIssue("legacy-failed")?.status).toBe("FINALIZATION_FAILED");
    expect(store.listPendingOperations()).toEqual([{
      issue: expect.objectContaining({ id: "legacy-active", revision: 7 }),
      operation: "FINALIZE",
    }]);
    store.close();
  });

  it("idempotently adds a recovery budget only to legacy active and failed finalizations", () => {
    const path = databasePath();
    const legacy = new BetterSqlite3(path);
    legacy.exec(runtimeSchema);
    legacy.prepare(
      `INSERT INTO projects (id, project_key, revision, next_issue_sequence, data_json)
       VALUES (?, ?, 1, 6, ?)`,
    ).run(project.id, project.key, JSON.stringify(project));
    const insert = legacy.prepare(
      `INSERT INTO issues
        (id, project_id, identifier, status, revision, pending_operation, data_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const seeded = [
      {
        id: "legacy-finalizing",
        identifier: "OMB-11",
        status: "FINALIZING",
        revision: 11,
        pending: "FINALIZE",
      },
      {
        id: "legacy-finalization-failed",
        identifier: "OMB-12",
        status: "FINALIZATION_FAILED",
        revision: 12,
        pending: null,
      },
      {
        id: "legacy-completed",
        identifier: "OMB-13",
        status: "COMPLETED",
        revision: 13,
        pending: null,
      },
      {
        id: "existing-recovery",
        identifier: "OMB-14",
        status: "FINALIZATION_FAILED",
        revision: 14,
        pending: null,
        finalizationRecovery: {
          automaticAttempts: 1,
          attemptId: "attempt-existing",
          fingerprintRef: "fingerprint-existing",
          summary: "Existing recovery summary",
        },
      },
    ] as const;
    for (const row of seeded) {
      insert.run(
        row.id,
        project.id,
        row.identifier,
        row.status,
        row.revision,
        row.pending,
        JSON.stringify({
          ...issue,
          id: row.id,
          identifier: row.identifier,
          status: row.status,
          revision: row.revision,
          updatedAt: `2026-08-20T15:${row.revision}:00.000Z`,
          repair: {
            iteration: 1,
            delivery: {
              summary: "Approved",
              evidence: [{
                type: "screenshot",
                label: "Approved evidence",
                evidenceId: `sha256-${"a".repeat(64)}`,
              }],
            },
          },
          ...(row.id === "existing-recovery"
            ? { finalizationRecovery: row.finalizationRecovery }
            : {}),
        }),
      );
    }
    legacy.prepare(
      `INSERT INTO issue_events
        (id, issue_id, event_sequence, event_type, actor, occurred_at, data_json)
       VALUES ('event-before-migration', 'legacy-finalizing', 1, 'DELIVERY_APPROVED',
         'USER', ?, '{"preserved":true}')`,
    ).run(now);
    legacy.close();

    for (let open = 0; open < 2; open += 1) {
      const store = new SqliteRuntimeStore(openRuntimeDatabase(path));
      expect(store.getIssue("legacy-finalizing")).toMatchObject({
        revision: 11,
        updatedAt: "2026-08-20T15:11:00.000Z",
        finalizationRecovery: { automaticAttempts: 0 },
        repair: { delivery: { summary: "Approved" } },
      });
      expect(store.getIssue("legacy-finalization-failed")).toMatchObject({
        revision: 12,
        finalizationRecovery: { automaticAttempts: 0 },
      });
      expect(store.getIssue("legacy-completed")?.finalizationRecovery).toBeUndefined();
      expect(store.getIssue("existing-recovery")?.finalizationRecovery).toEqual({
        automaticAttempts: 1,
        attemptId: "attempt-existing",
        fingerprintRef: "fingerprint-existing",
        summary: "Existing recovery summary",
      });
      expect(store.listPendingOperations()).toEqual([{
        issue: expect.objectContaining({ id: "legacy-finalizing", revision: 11 }),
        operation: "FINALIZE",
      }]);
      expect(store.readEvents("legacy-finalizing")).toEqual([
        expect.objectContaining({
          id: "event-before-migration",
          type: "DELIVERY_APPROVED",
          data: { preserved: true },
        }),
      ]);
      store.close();
    }
  });
});
