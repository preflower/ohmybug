import {
  AgentCapabilityRequiredError,
  AgentTurnInterruptedError,
  type RepairResult,
} from "@oh-my-bug/core";
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
  it("pauses Repair for a capability request without consuming context", async () => {
    const agent = new FakeAgent();
    agent.repairError = new AgentCapabilityRequiredError({
      capabilities: ["NETWORK_ACCESS"],
      reason: "Download acceptance dependency",
      blockedCommand: "pnpm install",
    });
    const { store, agents, evidence, workspaces } = createHarness(agent);
    const issue = repairingIssue("repair-permission");
    store.transaction((transaction) => transaction.insertIssue(issue, "REPAIR"));

    await new RuntimeWorker({
      store,
      agents,
      evidence,
      workspaces,
      id: eventIds("repair-permission"),
      now: () => now,
    }).drainOne();

    expect(store.getIssue(issue.id)).toMatchObject({
      status: "PERMISSION_REQUIRED",
      repair: { iteration: 1 },
      pendingCapabilityRequest: {
        operation: "REPAIR",
        stage: "REPAIR",
        resumeStatus: "REPAIRING",
        capabilities: ["NETWORK_ACCESS"],
      },
    });
    expect(store.getIssue(issue.id)).not.toHaveProperty("lastFailure");
    expect(store.listPendingOperations()).toEqual([]);
  });

  it("passes the capability grant marker into resumed Repair", async () => {
    const agent = new FakeAgent();
    agent.nextRepairResult = {
      kind: "DELIVERY_READY",
      summary: "Implemented",
      evidence: [],
      verification: [],
    };
    const { store, agents, evidence, workspaces } = createHarness(agent);
    const issue = {
      ...repairingIssue("repair-grant-continuation"),
      revision: 6,
      capabilityGrants: [{
        capability: "HOST_EXECUTION" as const,
        requestId: "request-1",
        grantedAt: now,
      }],
    };
    store.transaction((transaction) => {
      transaction.insertIssue(issue, "REPAIR");
      transaction.appendEvent({
        id: "grant-event",
        issueId: issue.id,
        type: "CAPABILITY_GRANTED",
        actor: "USER",
        data: {
          requestId: "request-1",
          operation: "REPAIR",
          capabilities: ["HOST_EXECUTION"],
          revision: issue.revision,
        },
        occurredAt: now,
      });
    });

    await new RuntimeWorker({
      store,
      agents,
      evidence,
      workspaces,
      id: eventIds("repair-grant"),
      now: () => now,
    }).drainOne();

    expect(agent.repairInputs[0]?.continuation).toEqual({
      reason: "CAPABILITY_GRANTED",
      requestId: "request-1",
      capabilities: ["HOST_EXECUTION"],
    });
  });

  it("persists a draft and queues evidence when Repair returns none", async () => {
    const agent = new FakeAgent();
    agent.nextRepairResult = {
      kind: "DELIVERY_READY",
      summary: "Implemented",
      evidence: [],
      verification: [],
    };
    const { store, agents, evidence, workspaces } = createHarness(agent);
    const issue = repairingIssue("repair-draft");
    store.transaction((transaction) => transaction.insertIssue(issue, "REPAIR"));

    await new RuntimeWorker({
      store,
      agents,
      evidence,
      workspaces,
      id: eventIds("repair-draft"),
      now: () => now,
    }).drainOne();

    expect(store.getIssue(issue.id)).toMatchObject({
      status: "EVIDENCE_CAPTURE",
      repair: {
        iteration: 1,
        evidenceRetries: 0,
        deliveryDraft: {
          summary: "Implemented",
          repairIteration: 1,
          implementationCompletedAt: now,
        },
      },
    });
    expect(store.listPendingOperations()[0]?.operation).toBe("CAPTURE_EVIDENCE");
  });

  it("passes the observed base to Repair and persists the validated integration snapshot", async () => {
    const agent = new FakeAgent();
    agent.nextRepairResult = {
      kind: "DELIVERY_READY",
      summary: "Merged latest main",
      evidence: repairResult.evidence,
      integration: {
        baseCommit: "base-2",
        issueCommit: "issue-2",
        conflicts: [{
          path: "src/payment.ts",
          classification: "COMPATIBLE_BUSINESS",
          resolution: "Preserved validation and the new retry behavior.",
        }],
      },
      verification: repairResult.verification,
    };
    const { store, agents, evidence, workspaces } = createHarness(agent);
    const observation = {
      required: true,
      baseBranch: "main",
      baseCommit: "base-2",
      issueBranch: "issue/OMB-9",
    } as const;
    workspaces.observeRepair = async () => observation;
    workspaces.validateRepair = async (_issue, observed, result) => {
      expect(observed).toEqual(observation);
      expect(result).toEqual(agent.nextRepairResult);
      expect(evidence.imported).toEqual([]);
      return {
        kind: "DELIVERY_READY",
        branch: { name: "issue/OMB-9", commit: "issue-2" },
      };
    };
    const issue = repairingIssue("repair-integrated");
    store.transaction((transaction) => transaction.insertIssue(issue, "REPAIR"));

    await new RuntimeWorker({
      store,
      agents,
      evidence,
      workspaces,
      id: eventIds("repair-integrated"),
      now: () => now,
    }).drainOne();

    expect(agent.repairInputs[0]?.integration).toEqual({
      baseBranch: "main",
      observedBaseCommit: "base-2",
      issueBranch: "issue/OMB-9",
    });
    expect(store.getIssue(issue.id)?.repair?.deliveryDraft?.integration).toEqual({
      baseBranch: "main",
      baseCommit: "base-2",
      issueBranch: "issue/OMB-9",
      issueCommit: "issue-2",
      conflicts: agent.nextRepairResult.kind === "DELIVERY_READY"
        ? agent.nextRepairResult.integration?.conflicts
        : undefined,
      verification: repairResult.verification,
    });
  });

  it("fails Repair with the workspace validation code before importing evidence", async () => {
    const agent = new FakeAgent();
    const { store, agents, evidence, workspaces } = createHarness(agent);
    workspaces.observeRepair = async () => ({
      required: true,
      baseBranch: "main",
      baseCommit: "base-2",
      issueBranch: "issue/OMB-9",
    });
    workspaces.validateRepair = async () => {
      throw new Error("GIT_REPAIR_HEAD_MISMATCH");
    };
    const issue = repairingIssue("repair-invalid-integration");
    store.transaction((transaction) => transaction.insertIssue(issue, "REPAIR"));

    await new RuntimeWorker({
      store,
      agents,
      evidence,
      workspaces,
      id: eventIds("repair-invalid-integration"),
      now: () => now,
    }).drainOne();

    expect(store.getIssue(issue.id)).toMatchObject({
      status: "REPAIR_FAILED",
      lastFailure: { stage: "REPAIR", code: "GIT_REPAIR_HEAD_MISMATCH" },
    });
    expect(evidence.imported).toEqual([]);
    expect(store.getIssue(issue.id)?.repair).not.toHaveProperty("deliveryDraft");
  });

  it("pauses only business-incompatible merges for review and resumes the same Repair context", async () => {
    const agent = new FakeAgent();
    const businessDecision: RepairResult = {
      kind: "BUSINESS_DECISION_REQUIRED",
      summary: "Both branches changed payment cancellation semantics.",
      decision: {
        baseCommit: "base-2",
        issueCommit: "issue-1",
        conflictPaths: ["src/payment.ts"],
        baseIntent: "Cancel immediately.",
        issueIntent: "Wait for settlement.",
        incompatibility: "Only one cancellation contract can be exposed.",
        recommendation: "keep-base",
        rationale: "The current API contract promises immediate cancellation.",
        choices: [{
          id: "keep-base",
          label: "保留基线行为",
          description: "Keep immediate cancellation and adapt the feature.",
        }, {
          id: "keep-issue",
          label: "采用功能行为",
          description: "Change cancellation to wait for settlement.",
        }],
      },
    };
    agent.nextRepairResult = businessDecision;
    const { commands, store, agents, evidence, workspaces } = createHarness(agent);
    workspaces.observeRepair = async () => ({
      required: true,
      baseBranch: "main",
      baseCommit: "base-2",
      issueBranch: "issue/OMB-9",
    });
    workspaces.validateRepair = async (_issue, _observation, result) =>
      result.kind === "BUSINESS_DECISION_REQUIRED"
        ? { kind: "BUSINESS_DECISION_REQUIRED" }
        : { kind: "DELIVERY_READY", branch: { name: "issue/OMB-9", commit: "issue-2" } };
    const issue = repairingIssue("repair-business-review");
    store.transaction((transaction) => transaction.insertIssue(issue, "REPAIR"));
    const worker = new RuntimeWorker({
      store,
      agents,
      evidence,
      workspaces,
      id: eventIds("repair-business-review"),
      now: () => now,
    });

    await worker.drainOne();

    const paused = store.getIssue(issue.id)!;
    expect(paused).toMatchObject({
      status: "REVIEW_REQUIRED",
      agentSession: issue.agentSession,
      repair: { iteration: 1 },
      review: {
        kind: "business-merge-conflict",
        choices: [{ id: "keep-base" }, { id: "keep-issue" }],
      },
    });
    expect(paused.repair).not.toHaveProperty("deliveryDraft");
    expect(evidence.imported).toEqual([]);

    const resumed = commands.submitReview(issue.id, {
      expectedRevision: paused.revision,
      requestId: paused.review!.id,
      choiceId: "keep-base",
    });
    expect(resumed).toMatchObject({
      status: "REPAIRING",
      agentSession: issue.agentSession,
      repair: { iteration: 1 },
    });
    agent.nextRepairResult = {
      kind: "DELIVERY_READY",
      summary: "Applied the selected cancellation contract.",
      evidence: [],
      integration: { baseCommit: "base-2", issueCommit: "issue-2", conflicts: [] },
      verification: repairResult.verification,
    };

    await worker.drainOne();

    expect(agent.repairInputs[1]?.continuation).toEqual({
      reason: "REVIEW_SUBMITTED",
      requestId: paused.review!.id,
      kind: "business-merge-conflict",
      choiceId: "keep-base",
    });
    expect(store.getIssue(issue.id)).toMatchObject({
      status: "EVIDENCE_CAPTURE",
      agentSession: issue.agentSession,
      repair: { iteration: 1 },
    });
  });

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
      status: "REVIEW_REQUIRED",
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

  it("returns unusable evidence to evidence capture with safe feedback", async () => {
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
      status: "EVIDENCE_CAPTURE",
      agentSession: issue.agentSession,
      repair: {
        iteration: 1,
        evidenceRetries: 1,
        feedback: expect.stringContaining("does not exist"),
      },
    });
    expect(store.listPendingOperations()[0]?.operation).toBe("CAPTURE_EVIDENCE");
    expect(evidence.cleaned).toBe(1);
  });

  it("redacts evidence import failures and requeues evidence capture", async () => {
    const agent = new FakeAgent();
    const { store, agents, evidence, workspaces } = createHarness(agent);
    evidence.importError = new Error("/private/secret/token.png");
    const issue = repairingIssue("repair-import-failure");
    store.transaction((transaction) => transaction.insertIssue(issue, "REPAIR"));

    await new RuntimeWorker({ store, agents, evidence, workspaces, id: eventIds("import-failed"), now: () => now })
      .drainOne();

    const repaired = store.getIssue(issue.id);
    expect(repaired).toMatchObject({
      status: "EVIDENCE_CAPTURE",
      repair: {
        iteration: 1,
        evidenceRetries: 1,
        feedback: "Evidence could not be imported or verified. Produce new screenshot or recording evidence.",
      },
    });
    expect(JSON.stringify(repaired)).not.toContain("private/secret");
    expect(store.listPendingOperations()[0]?.operation).toBe("CAPTURE_EVIDENCE");
    expect(evidence.cleaned).toBe(1);
  });

  it("does not rerun implementation for invalid Repair output metadata", async () => {
    const agent = new FakeAgent();
    agent.repairError = new Error("EVIDENCE_LABEL_REQUIRED");
    const { store, agents, evidence, workspaces } = createHarness(agent);
    const issue = repairingIssue("repair-invalid-label");
    store.transaction((transaction) => transaction.insertIssue(issue, "REPAIR"));

    await new RuntimeWorker({ store, agents, evidence, workspaces, id: eventIds("invalid-label"), now: () => now })
      .drainOne();

    expect(store.getIssue(issue.id)).toMatchObject({
      status: "REPAIR_FAILED",
      repair: { iteration: 1 },
      lastFailure: { stage: "REPAIR", code: "EVIDENCE_LABEL_REQUIRED" },
    });
    expect(store.listPendingOperations()).toEqual([]);
    expect(agent.repairSessions).toEqual(["session-1"]);
    expect(evidence.cleaned).toBe(1);
  });

  it("preserves a concrete output failure code from legacy retry state", async () => {
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
