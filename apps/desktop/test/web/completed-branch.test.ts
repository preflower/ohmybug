import { describe, expect, it } from "vitest";

import type { AgentEventDto } from "../../src/web/api/types.js";
import { completedBranchFromEvents } from "../../src/web/issues/completed-branch.js";

const event = (sequence: number, data: Record<string, unknown>): AgentEventDto => ({
  id: `event-${sequence}`,
  issueId: "issue-1",
  sequence,
  type: "ISSUE_COMPLETED",
  actor: "SYSTEM",
  data,
  occurredAt: "2026-08-24T10:00:00.000Z",
});

describe("completedBranchFromEvents", () => {
  it("returns the latest valid completed branch", () => {
    expect(completedBranchFromEvents([
      event(1, { branch: { name: "old", commit: "111" } }),
      event(2, {
        branch: {
          name: "ohmybug/omb-1",
          commit: "abc123",
          remote: "origin",
        },
      }),
    ])).toEqual({
      name: "ohmybug/omb-1",
      commit: "abc123",
      remote: "origin",
    });
  });

  it("ignores malformed and unrelated events", () => {
    expect(completedBranchFromEvents([
      { ...event(1, {}), type: "WORKSPACE_PUBLISH_FAILED" },
      event(2, { branch: { name: "", commit: "abc123" } }),
      event(3, { branch: "not-an-object" }),
    ])).toBeUndefined();
  });
});
