import { describe, expect, it } from "vitest";

import {
  decideIntegrationInput,
  type IntegrationInput,
} from "../../src/index.js";

function input(groupKey?: string): IntegrationInput {
  return {
    id: "input-1",
    integration: "sentry",
    inputKey: "event-1",
    ...(groupKey ? { groupKey } : {}),
    rawData: { eventId: "event-1" },
    data: { content: "TypeError on checkout" },
    receivedAt: "2026-08-20T05:00:00.000Z",
  };
}

describe("Integration intake decision", () => {
  it("ignores an exact redelivery before considering grouping", () => {
    expect(
      decideIntegrationInput(input("sentry-group-1"), {
        exactInputExists: true,
        activeGroupIssueId: "issue-1",
      }),
    ).toEqual({ kind: "IGNORE_DUPLICATE" });
  });

  it("appends a deterministic group match only to an active Issue", () => {
    expect(
      decideIntegrationInput(input("sentry-group-1"), {
        exactInputExists: false,
        activeGroupIssueId: "issue-1",
      }),
    ).toEqual({ kind: "APPEND_TO_ISSUE", issueId: "issue-1" });
  });

  it.each([
    input(),
    input("new-group"),
  ])("creates a new Issue when no active deterministic match exists", (value) => {
    expect(
      decideIntegrationInput(value, {
        exactInputExists: false,
      }),
    ).toEqual({ kind: "CREATE_ISSUE" });
  });

  it("does not reopen a terminal group or merge by similar content", () => {
    expect(
      decideIntegrationInput(input("previously-closed-group"), {
        exactInputExists: false,
      }),
    ).toEqual({ kind: "CREATE_ISSUE" });
  });
});
