import { describe, expect, it } from "vitest";

import {
  acceptIntegrationInput,
  type AgentSessionRecord,
  type IntegrationInput,
  type Issue,
  type NewIssueEvent,
  type PendingOperation,
  type RuntimeTransaction,
} from "../../src/index.js";

const now = "2026-08-20T12:00:00.000Z";
const input: IntegrationInput = {
  id: "input-1",
  integration: "sentry",
  inputKey: "event-1",
  groupKey: "payment-route",
  rawData: { id: "event-1" },
  data: { content: "Payment route fails" },
  receivedAt: now,
};
const existingInput: IntegrationInput = {
  ...input,
  id: "input-0",
  inputKey: "event-0",
};
const existingIssue: Issue = {
  id: "issue-1",
  projectId: "project-1",
  identifier: "OMB-1",
  title: "Payment route fails",
  titleSource: "integration",
  status: "ASSESSING",
  inputs: [existingInput],
  revision: 2,
  createdAt: now,
  updatedAt: now,
};

class MemoryTransaction implements RuntimeTransaction {
  sessions = new Map<string, AgentSessionRecord>();
  exactIssue?: Issue;
  activeGroupIssue?: Issue;
  exactLookup?: [projectId: string, integration: string, inputKey: string];
  inserted?: { issue: Issue; pendingOperation: PendingOperation };
  appended?: Issue;
  events: NewIssueEvent[] = [];

  getAgentSession(logicalSessionId: string): AgentSessionRecord | undefined {
    return this.sessions.get(logicalSessionId);
  }
  insertAgentSession(record: AgentSessionRecord): void {
    this.sessions.set(record.logicalSessionId, record);
  }
  retireAgentSession(logicalSessionId: string, updatedAt: string): void {
    const current = this.sessions.get(logicalSessionId);
    if (!current) throw new Error("AGENT_SESSION_NOT_FOUND");
    this.sessions.set(logicalSessionId, { ...current, lifecycle: "RETIRED", updatedAt });
  }
  findIssueByInput(
    projectId: string,
    integration: string,
    inputKey: string,
  ): Issue | undefined {
    this.exactLookup = [projectId, integration, inputKey];
    return this.exactIssue;
  }
  findActiveIssueByGroup(): Issue | undefined { return this.activeGroupIssue; }
  allocateIssueIdentity() { return { id: "issue-2", identifier: "OMB-2" }; }
  insertIssue(issue: Issue, pendingOperation: PendingOperation): void {
    this.inserted = { issue, pendingOperation };
  }
  appendInput(_issueId: string, expectedRevision: number, nextInput: IntegrationInput): Issue {
    if (!this.activeGroupIssue || this.activeGroupIssue.revision !== expectedRevision) {
      throw new Error("CONCURRENT_UPDATE");
    }
    this.appended = {
      ...this.activeGroupIssue,
      inputs: [...this.activeGroupIssue.inputs, nextInput],
      revision: expectedRevision + 1,
      updatedAt: now,
    };
    return this.appended;
  }
  updateIssue(): void { throw new Error("NOT_USED"); }
  appendEvent(event: NewIssueEvent) {
    this.events.push(event);
    return { ...event, sequence: this.events.length };
  }
}

describe("atomic Integration intake", () => {
  it("returns the original Issue without writing an exact redelivery", () => {
    const transaction = new MemoryTransaction();
    transaction.exactIssue = existingIssue;

    expect(acceptIntegrationInput({
      projectId: "project-1",
      input,
      transaction,
      id: () => "event-1",
      now,
    })).toEqual({ kind: "IGNORED_DUPLICATE", issueId: "issue-1" });
    expect(transaction.exactLookup).toEqual(["project-1", "sentry", "event-1"]);
    expect(transaction.inserted).toBeUndefined();
    expect(transaction.appended).toBeUndefined();
    expect(transaction.events).toEqual([]);
  });

  it("appends a distinct grouped input to the active Issue", () => {
    const transaction = new MemoryTransaction();
    transaction.activeGroupIssue = existingIssue;

    expect(acceptIntegrationInput({
      projectId: "project-1",
      input,
      transaction,
      id: () => "event-2",
      now,
    })).toMatchObject({
      kind: "APPENDED",
      issue: { id: "issue-1", revision: 3, inputs: [existingInput, input] },
    });
    expect(transaction.events).toEqual([{
      id: "event-2",
      issueId: "issue-1",
      type: "INPUT_APPENDED",
      actor: "SYSTEM",
      data: { inputId: "input-1" },
      occurredAt: now,
    }]);
  });

  it("runs beforeCreate and schedules preparation when no match exists", () => {
    const transaction = new MemoryTransaction();
    const beforeCreate: Issue[] = [];

    expect(acceptIntegrationInput({
      projectId: "project-1",
      input: { ...input, groupKey: undefined },
      transaction,
      id: () => "event-3",
      now,
      beforeCreate: (issue) => {
        expect(transaction.inserted).toBeUndefined();
        beforeCreate.push(issue);
      },
    })).toMatchObject({
      kind: "CREATED",
      issue: { id: "issue-2", identifier: "OMB-2", status: "RECEIVED" },
    });
    expect(transaction.inserted).toMatchObject({
      pendingOperation: "PREPARE",
      issue: { inputs: [{ id: "input-1" }] },
    });
    expect(beforeCreate).toEqual([transaction.inserted?.issue]);
    expect(transaction.events[0]).toEqual({
      id: "event-3",
      issueId: "issue-2",
      type: "ISSUE_CREATED",
      actor: "SYSTEM",
      data: { inputId: "input-1" },
      occurredAt: now,
    });
  });
});
