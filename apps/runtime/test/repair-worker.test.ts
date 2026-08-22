import { AgentTurnInterruptedError, type RepairResult } from "@oh-my-bug/core";
import { describe, expect, it } from "vitest";

import { RuntimeWorker } from "../src/orchestration/worker.js";
import { delivery, FakeAgent, repairResult } from "./helpers/fakes.js";
import { assessment, createHarness, eventIds, now, project } from "./helpers/runtime.js";

function repairingIssue(id: string) {
  return {
    id,
    projectId: project.id,
    projectPath: `/tmp/worktrees/${id}`,
    identifier: "OMB-9",
    title: "Bug",
    titleSource: "user" as const,
    status: "REPAIRING" as const,
    inputs: [],
    agentSession: { agent: "fake", sessionId: "session-1" },
    assessment,
    repair: { iteration: 1 },
    revision: 4,
    createdAt: now,
    updatedAt: now,
  };
}

describe("Runtime repair worker", () => {
  it("imports scoped Agent evidence and reaches human acceptance", async () => {
    const agent = new FakeAgent();
    const { store, agents, evidence, workspaces } = createHarness(agent);
    const issue = repairingIssue("repair-1");
    store.transaction((transaction) => transaction.insertIssue(issue, "REPAIR"));

    const worker = new RuntimeWorker({
      store,
      agents,
      evidence,
      workspaces,
      id: eventIds("repair-event"),
      now: () => now,
    });

    await worker.drainOne();

    expect(store.getIssue(issue.id)).toMatchObject({
      status: "EVIDENCE_CHECK",
      repair: { delivery },
    });
    expect(store.listPendingOperations()).toEqual([{
      issue: expect.objectContaining({ id: issue.id }),
      operation: "EVIDENCE",
    }]);

    await worker.drainOne();

    expect(store.getIssue(issue.id)).toMatchObject({
      status: "ACCEPTANCE_REVIEW",
      repair: { delivery },
    });
    expect(agent.repairSessions).toEqual(["session-1"]);
    expect(agent.repairInputs[0]?.evidenceDirectory).toBe("/tmp/evidence/repair-1/1");
    expect(evidence.prepared).toEqual([{
      issueId: "repair-1",
      repairIteration: 1,
      workspaceDirectory: issue.projectPath,
    }]);
    expect(evidence.imported).toEqual([expect.objectContaining({
      issueId: "repair-1",
      workspaceDirectory: issue.projectPath,
      intakeDirectory: "/tmp/evidence/repair-1/1",
      relativePath: "proof.png",
    })]);
    expect(evidence.cleaned).toBe(1);
  });

  it("returns unusable evidence to the same session with safe feedback", async () => {
    const agent = new FakeAgent();
    const { store, agents, evidence, workspaces } = createHarness(agent);
    evidence.nextInspection = { ...evidence.nextInspection, exists: false, byteLength: 0 };
    const issue = repairingIssue("repair-invalid-evidence");
    store.transaction((transaction) => transaction.insertIssue(issue, "REPAIR"));

    const worker = new RuntimeWorker({
      store,
      agents,
      evidence,
      workspaces,
      id: eventIds("invalid"),
      now: () => now,
    });
    await worker.drainOne();
    await worker.drainOne();

    expect(store.getIssue(issue.id)).toMatchObject({
      status: "REPAIRING",
      agentSession: issue.agentSession,
      repair: { iteration: 2, feedback: expect.stringContaining("does not exist") },
    });
    expect(store.listPendingOperations()[0]?.operation).toBe("REPAIR");
    expect(evidence.cleaned).toBe(1);
  });

  it("redacts evidence import failures and requeues Repair", async () => {
    const agent = new FakeAgent();
    const { store, agents, evidence, workspaces } = createHarness(agent);
    evidence.importError = new Error("/private/secret/token.png");
    const issue = repairingIssue("repair-import-failure");
    store.transaction((transaction) => transaction.insertIssue(issue, "REPAIR"));

    await new RuntimeWorker({ store, agents, evidence, workspaces, id: eventIds("import-failed"), now: () => now })
      .drainOne();

    const repaired = store.getIssue(issue.id);
    expect(repaired).toMatchObject({
      status: "REPAIRING",
      repair: {
        iteration: 2,
        feedback: "Evidence could not be imported or verified. Produce new screenshot or recording evidence.",
      },
    });
    expect(JSON.stringify(repaired)).not.toContain("private/secret");
    expect(evidence.cleaned).toBe(1);
  });

  it("automatically requeues invalid Agent evidence metadata with actionable feedback", async () => {
    const agent = new FakeAgent();
    agent.repairError = new Error("EVIDENCE_LABEL_REQUIRED");
    const { store, agents, evidence, workspaces } = createHarness(agent);
    const issue = repairingIssue("repair-invalid-label");
    store.transaction((transaction) => transaction.insertIssue(issue, "REPAIR"));

    await new RuntimeWorker({ store, agents, evidence, workspaces, id: eventIds("invalid-label"), now: () => now })
      .drainOne();

    expect(store.getIssue(issue.id)).toMatchObject({
      status: "REPAIRING",
      repair: {
        iteration: 2,
        automaticEvidenceRetries: 1,
        feedback: expect.stringContaining("non-empty label"),
      },
    });
    expect(store.getIssue(issue.id)).not.toHaveProperty("lastFailure");
    expect(store.listPendingOperations()[0]?.operation).toBe("REPAIR");
    expect(store.readEvents(issue.id).map((event) => event.type)).toContain("EVIDENCE_REJECTED");
    expect(evidence.cleaned).toBe(1);
  });

  it("stops after two automatic evidence retries and preserves the concrete failure code", async () => {
    const agent = new FakeAgent();
    agent.repairError = new Error("EVIDENCE_LABEL_REQUIRED");
    const { store, agents, evidence, workspaces } = createHarness(agent);
    const issue = {
      ...repairingIssue("repair-invalid-label-limit"),
      repair: { iteration: 3, automaticEvidenceRetries: 2 },
    };
    store.transaction((transaction) => transaction.insertIssue(issue, "REPAIR"));

    await new RuntimeWorker({ store, agents, evidence, workspaces, id: eventIds("invalid-label-limit"), now: () => now })
      .drain();

    expect(store.getIssue(issue.id)).toMatchObject({
      status: "REPAIR_FAILED",
      lastFailure: { stage: "REPAIR", code: "EVIDENCE_LABEL_REQUIRED" },
    });
    expect(store.listPendingOperations()).toEqual([]);
    expect(evidence.cleaned).toBe(1);
  });

  it("records a stable Repair failure when the session Agent plugin is not installed", async () => {
    const { store, agents, evidence, workspaces } = createHarness(new FakeAgent());
    const issue = {
      ...repairingIssue("repair-missing-agent"),
      agentSession: { agent: "missing", sessionId: "session-missing" },
    };
    store.transaction((transaction) => transaction.insertIssue(issue, "REPAIR"));
    const worker = new RuntimeWorker({
      store,
      agents,
      evidence,
      workspaces,
      id: eventIds("repair-missing-agent"),
      now: () => now,
    });

    await expect(worker.drain()).resolves.toBeUndefined();
    expect(store.getIssue(issue.id)).toMatchObject({
      status: "REPAIR_FAILED",
      lastFailure: { stage: "REPAIR", code: "AGENT_PLUGIN_NOT_INSTALLED" },
    });
    expect(store.listPendingOperations()).toEqual([]);
    expect(evidence.prepared).toEqual([]);
  });

  it("records a safe Repair failure when Storage cannot prepare the evidence intake", async () => {
    const { store, agents, evidence, workspaces } = createHarness(new FakeAgent());
    evidence.prepareError = new Error("/private/secret/intake");
    const issue = repairingIssue("repair-intake-failure");
    store.transaction((transaction) => transaction.insertIssue(issue, "REPAIR"));
    const worker = new RuntimeWorker({
      store,
      agents,
      evidence,
      workspaces,
      id: eventIds("repair-intake-failure"),
      now: () => now,
    });

    await expect(worker.drain()).resolves.toBeUndefined();
    const failed = store.getIssue(issue.id);
    expect(failed).toMatchObject({
      status: "REPAIR_FAILED",
      lastFailure: { stage: "REPAIR", code: "EVIDENCE_INTAKE_FAILED" },
    });
    expect(JSON.stringify(failed)).not.toContain("private/secret");
    expect(store.listPendingOperations()).toEqual([]);
  });

  it("does not persist a stale Delivery after human cancellation", async () => {
    const agent = new FakeAgent();
    let releaseRepair!: (result: RepairResult) => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const deferred = new Promise<RepairResult>((resolve) => { releaseRepair = resolve; });
    agent.repair = async (session, input) => {
      agent.repairSessions.push(session.sessionId);
      agent.repairInputs.push(input);
      markStarted();
      return deferred;
    };
    const { commands, store, agents, evidence, workspaces } = createHarness(agent);
    const issue = repairingIssue("repair-canceled");
    store.transaction((transaction) => transaction.insertIssue(issue, "REPAIR"));
    const worker = new RuntimeWorker({
      store,
      agents,
      evidence,
      workspaces,
      id: eventIds("cancel-repair"),
      now: () => now,
    });
    const draining = worker.drain();
    await started;
    await commands.cancelIssue(issue.id);
    releaseRepair(repairResult);
    await draining;

    expect(store.getIssue(issue.id)).toMatchObject({ status: "CANCELED", resolution: "CANCELED" });
    expect(store.getIssue(issue.id)?.repair).not.toHaveProperty("delivery");
    expect(store.readEvents(issue.id).map((event) => event.type)).not.toContain("DELIVERY_READY");
    expect(evidence.cleaned).toBe(1);
  });

  it("requeues Runtime-interrupted Repair without incrementing its iteration", async () => {
    const agent = new FakeAgent();
    agent.repairError = new AgentTurnInterruptedError("RUNTIME_STOPPING");
    const { store, agents, evidence, workspaces } = createHarness(agent);
    const issue = repairingIssue("repair-interrupted");
    store.transaction((transaction) => transaction.insertIssue(issue, "REPAIR"));

    await new RuntimeWorker({
      store,
      agents,
      evidence,
      workspaces,
      id: eventIds("repair-interrupted"),
      now: () => now,
    }).drainOne();

    const interrupted = store.getIssue(issue.id);
    expect(interrupted).toMatchObject({
      status: "REPAIRING",
      repair: { iteration: 1 },
      revision: issue.revision + 1,
    });
    expect(interrupted).not.toHaveProperty("lastFailure");
    expect(store.listPendingOperations()[0]?.operation).toBe("REPAIR");
    expect(store.readEvents(issue.id)).toContainEqual(expect.objectContaining({
      type: "RUNTIME_INTERRUPTED",
      data: expect.objectContaining({
        stage: "REPAIR",
        reason: "RUNTIME_STOPPING",
        iteration: 1,
        sessionId: "session-1",
        attemptId: expect.any(String),
        revision: issue.revision + 1,
      }),
    }));
  });

  it("passes the durable interruption marker into resumed Repair", async () => {
    const agent = new FakeAgent();
    const { store, agents, evidence, workspaces } = createHarness(agent);
    const issue = repairingIssue("repair-continuation");
    store.transaction((transaction) => {
      transaction.insertIssue(issue, "REPAIR");
      transaction.appendEvent({
        id: "interrupted-event",
        issueId: issue.id,
        type: "RUNTIME_INTERRUPTED",
        actor: "SYSTEM",
        data: {
          operation: "REPAIR",
          revision: issue.revision,
          attemptId: "attempt-before-restart",
        },
        occurredAt: now,
      });
    });

    await new RuntimeWorker({
      store,
      agents,
      evidence,
      workspaces,
      id: eventIds("repair-continuation"),
      now: () => now,
    }).drainOne();

    expect(agent.repairInputs[0]?.continuation).toEqual({
      reason: "RUNTIME_INTERRUPTED",
      previousAttemptId: "attempt-before-restart",
    });
  });
});
