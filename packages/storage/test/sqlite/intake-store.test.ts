import { describe, expect, it } from "vitest";

import { databasePath, createStore, input, issue, project } from "../helpers.js";

describe("SQLite intake persistence", () => {
  it("persists exact input identity across reopen", () => {
    const path = databasePath();
    const store = createStore(path);
    store.registerProject(project);
    store.transaction((transaction) => transaction.insertIssue(issue, "ASSESS"));
    store.close();

    const reopened = createStore(path);
    expect(reopened.transaction((transaction) =>
      transaction.findIssueByInput("sentry", "event-1"),
    )).toEqual(issue);
    reopened.close();
  });

  it("finds active groups and ignores terminal Issues", () => {
    const store = createStore();
    store.registerProject(project);
    store.transaction((transaction) => transaction.insertIssue(issue, "ASSESS"));
    expect(store.transaction((transaction) =>
      transaction.findActiveIssueByGroup(project.id, "sentry", "payment-route"),
    )).toEqual(issue);

    const completed = { ...issue, status: "COMPLETED" as const, resolution: "FIXED" as const, revision: 2 };
    store.transaction((transaction) => transaction.updateIssue(completed, issue.revision, null));
    expect(store.transaction((transaction) =>
      transaction.findActiveIssueByGroup(project.id, "sentry", "payment-route"),
    )).toBeUndefined();
    store.close();
  });

  it("also ignores non-bug closures when finding active groups", () => {
    const store = createStore();
    store.registerProject(project);
    store.transaction((transaction) => transaction.insertIssue(issue, "ASSESS"));
    const closed = { ...issue, status: "CLOSED" as const, resolution: "NOT_A_BUG" as const, revision: 2 };
    store.transaction((transaction) => transaction.updateIssue(closed, issue.revision, null));

    expect(store.transaction((transaction) =>
      transaction.findActiveIssueByGroup(project.id, "sentry", "payment-route"),
    )).toBeUndefined();
    store.close();
  });

  it("appends a distinct input with compare-and-swap", () => {
    const store = createStore();
    store.registerProject(project);
    store.transaction((transaction) => transaction.insertIssue(issue, "ASSESS"));
    const nextInput = { ...input, id: "input-2", inputKey: "event-2" };
    const updated = store.transaction((transaction) =>
      transaction.appendInput(issue.id, issue.revision, nextInput),
    );
    expect(updated).toMatchObject({ revision: 2, inputs: [input, nextInput] });
    expect(() => store.transaction((transaction) =>
      transaction.appendInput(issue.id, issue.revision, { ...nextInput, id: "input-3", inputKey: "event-3" }),
    )).toThrow("CONCURRENT_UPDATE");
    store.close();
  });
});
