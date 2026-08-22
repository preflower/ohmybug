import { describe, expect, it } from "vitest";

import type { NewIssueEvent } from "@oh-my-bug/core";
import { createStore, issue, now, project } from "../helpers.js";

function event(id: string, type: string): NewIssueEvent {
  return { id, issueId: issue.id, type, actor: "SYSTEM", data: { id }, occurredAt: now };
}

describe("SQLite Issue events", () => {
  it("assigns monotonic per-Issue sequences and reads after a cursor", () => {
    const store = createStore();
    store.registerProject(project);
    store.transaction((transaction) => transaction.insertIssue(issue, "ASSESS"));
    const first = store.transaction((transaction) => transaction.appendEvent(event("event-1", "ISSUE_CREATED")));
    const second = store.transaction((transaction) => transaction.appendEvent(event("event-2", "ASSESSMENT_STARTED")));
    expect([first.sequence, second.sequence]).toEqual([1, 2]);
    expect(store.readEvents(issue.id, 1)).toEqual([second]);
    store.close();
  });

  it("rolls back an event appended by a failed transaction", () => {
    const store = createStore();
    store.registerProject(project);
    store.transaction((transaction) => transaction.insertIssue(issue, "ASSESS"));
    expect(() => store.transaction((transaction) => {
      transaction.appendEvent(event("event-1", "ISSUE_CREATED"));
      throw new Error("ROLLBACK_EVENT");
    })).toThrow("ROLLBACK_EVENT");
    expect(store.readEvents(issue.id)).toEqual([]);
    store.close();
  });
});
