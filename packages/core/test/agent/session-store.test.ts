import { describe, expect, it } from "vitest";

import {
  agentSessionRecordSchema,
  type AgentSessionRecord,
  type AgentSessionStore,
} from "../../src/index.js";

describe("AgentSessionStore", () => {
  it("round-trips a provider-neutral active session record", async () => {
    const records = new Map<string, AgentSessionRecord>();
    const store: AgentSessionStore = {
      async get(logicalSessionId) { return records.get(logicalSessionId); },
      async save(record) { records.set(record.logicalSessionId, agentSessionRecordSchema.parse(record)); },
    };
    const record: AgentSessionRecord = {
      agent: "codex",
      logicalSessionId: "logical-1",
      issueId: "issue-1",
      projectId: "project-1",
      providerSessionId: "thread-1",
      lifecycle: "ACTIVE",
      updatedAt: "2026-08-21T03:00:00.000Z",
    };

    await store.save(record);

    await expect(store.get("logical-1")).resolves.toEqual(record);
  });

  it("rejects provider records with invalid lifecycle or timestamp", () => {
    const record = {
      agent: "codex",
      logicalSessionId: "logical-1",
      issueId: "issue-1",
      projectId: "project-1",
      lifecycle: "MISSING",
      updatedAt: "not-a-date",
    };

    expect(() => agentSessionRecordSchema.parse(record)).toThrow();
  });
});
