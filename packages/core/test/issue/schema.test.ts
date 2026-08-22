import { describe, expect, it } from "vitest";

import { issueSchema, type Issue } from "../../src/index.js";

const issue: Issue = {
  id: "issue-1",
  projectId: "project-1",
  identifier: "OMB-1",
  title: "支付页无法打开",
  titleSource: "assessment",
  status: "REPAIR_FAILED",
  inputs: [{
    id: "input-1",
    integration: "manual",
    inputKey: "command-1",
    rawData: { content: "支付页打不开" },
    data: { content: "支付页打不开" },
    receivedAt: "2026-08-20T11:00:00.000Z",
  }],
  agentSession: { agent: "fake", sessionId: "session-1" },
  repair: {
    iteration: 2,
    feedback: "Show the full response",
    delivery: {
      summary: "支付页已恢复",
      evidence: [{
        type: "screenshot",
        label: "支付页",
        evidenceId: `sha256-${"a".repeat(64)}`,
      }],
    },
  },
  lastFailure: { stage: "REPAIR", code: "AGENT_FAILURE" },
  revision: 7,
  createdAt: "2026-08-20T11:00:00.000Z",
  updatedAt: "2026-08-20T11:10:00.000Z",
};

describe("Issue persistence schema", () => {
  it("round-trips the complete durable Issue aggregate", () => {
    expect(issueSchema.parse(issue)).toEqual(issue);
  });

  it("rejects unknown top-level persistence fields", () => {
    expect(() => issueSchema.parse({ ...issue, unexpectedField: true })).toThrow();
  });
});
