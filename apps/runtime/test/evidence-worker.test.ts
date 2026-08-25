import {
  AgentCapabilityRequiredError,
  AgentTurnInterruptedError,
  type Issue,
} from "@oh-my-bug/core";
import { describe, expect, it } from "vitest";

import { EvidenceCaptureError } from "../src/evidence/capture-provider.js";
import { IssueOperationCoordinator } from "../src/orchestration/issue-operation-coordinator.js";
import { RuntimeWorker } from "../src/orchestration/worker.js";
import { FakeAgent } from "./helpers/fakes.js";
import { assessment, createHarness, eventIds, now, project } from "./helpers/runtime.js";

function evidenceIssue(id: string): Issue {
  return {
    id,
    projectId: project.id,
    projectPath: `/tmp/worktrees/${id}`,
    identifier: "OMB-9",
    title: "Bug",
    titleSource: "user",
    status: "EVIDENCE_CAPTURE",
    inputs: [],
    agentSession: { agent: "fake", sessionId: "session-1" },
    assessment,
    repair: {
      iteration: 1,
      evidenceRetries: 0,
      deliveryDraft: {
        summary: "Implemented",
        repairIteration: 1,
        implementationCompletedAt: now,
      },
    },
    revision: 5,
    createdAt: now,
    updatedAt: now,
  };
}

describe("Runtime evidence worker", () => {
  it("pauses Agent Evidence without consuming an evidence retry", async () => {
    const harness = setup("agent");
    harness.agent.evidenceError = new AgentCapabilityRequiredError({
      capabilities: ["HOST_EXECUTION"],
      reason: "Run project Skill",
    });

    await harness.worker.drainOne();

    expect(harness.store.getIssue(harness.issue.id)).toMatchObject({
      status: "PERMISSION_REQUIRED",
      repair: { iteration: 1, evidenceRetries: 0 },
      pendingCapabilityRequest: {
        operation: "CAPTURE_EVIDENCE",
        stage: "EVIDENCE",
        resumeStatus: "EVIDENCE_CAPTURE",
      },
    });
    expect(harness.store.getIssue(harness.issue.id)).not.toHaveProperty("lastFailure");
    expect(harness.store.listPendingOperations()).toEqual([]);
  });

  it("uses the configured host provider without re-entering Repair", async () => {
    const harness = setup("host");

    await harness.worker.drain();

    expect(harness.store.getIssue(harness.issue.id)).toMatchObject({
      status: "REVIEW_REQUIRED",
      review: { kind: "delivery", requestedFrom: "EVIDENCE_CHECK" },
    });
    expect(harness.store.getIssue(harness.issue.id)?.review?.id).not.toMatch(/^legacy:/);
    expect(harness.store.readEvents(harness.issue.id).map((event) => event.type))
      .toContain("REVIEW_REQUESTED");
    expect(harness.capture.inputs).toHaveLength(1);
    expect(harness.agent.evidenceSessions).toEqual([]);
    expect(harness.agent.repairSessions).toEqual([]);
  });

  it("falls back to an evidence-only Agent turn", async () => {
    const harness = setup("agent");

    await harness.worker.drain();

    expect(harness.store.getIssue(harness.issue.id)).toMatchObject({
      status: "REVIEW_REQUIRED",
      review: { kind: "delivery", requestedFrom: "EVIDENCE_CHECK" },
    });
    expect(harness.agent.evidenceSessions).toEqual(["session-1"]);
    expect(harness.agent.repairSessions).toEqual([]);
  });

  it("does not persist stale evidence after a user pause", async () => {
    const harness = setup("agent");
    let releaseEvidence!: (result: typeof harness.agent.nextEvidenceResult) => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const deferred = new Promise<typeof harness.agent.nextEvidenceResult>((resolve) => {
      releaseEvidence = resolve;
    });
    harness.agent.captureEvidence = async (session, input) => {
      harness.agent.evidenceSessions.push(session.sessionId);
      harness.agent.evidenceInputs.push(input);
      markStarted();
      return deferred;
    };
    const draining = harness.worker.drainOne();
    await started;
    const pausing = harness.commands.pauseIssue(harness.issue.id);
    releaseEvidence(harness.agent.nextEvidenceResult);
    await pausing;
    await draining;

    expect(harness.store.getIssue(harness.issue.id)).toMatchObject({
      status: "PAUSED",
      repair: { deliveryDraft: { summary: "Implemented" } },
      pauseContext: { operation: "CAPTURE_EVIDENCE", resumeStatus: "EVIDENCE_CAPTURE" },
    });
    expect(harness.store.getIssue(harness.issue.id)?.repair).not.toHaveProperty("delivery");
    expect(harness.store.readEvents(harness.issue.id).map((event) => event.type))
      .not.toContain("DELIVERY_READY");
  });

  it("aborts and settles configured host capture before pause completes", async () => {
    const harness = setup("host");
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    let aborted = false;
    harness.capture.capture = async (input) => {
      harness.capture.inputs.push(input);
      markStarted();
      await new Promise<void>((resolve) => {
        input.signal?.addEventListener("abort", () => {
          aborted = true;
          resolve();
        }, { once: true });
      });
      throw input.signal?.reason;
    };
    const draining = harness.worker.drainOne();
    await started;

    await harness.commands.pauseIssue(harness.issue.id);

    expect(aborted).toBe(true);
    await expect(draining).resolves.toBeUndefined();
    expect(harness.store.getIssue(harness.issue.id)).toMatchObject({
      status: "PAUSED",
      pauseContext: { operation: "CAPTURE_EVIDENCE", resumeStatus: "EVIDENCE_CAPTURE" },
    });
    expect(harness.store.readEvents(harness.issue.id).map((event) => event.type))
      .not.toContain("EVIDENCE_CAPTURE_FAILED");
  });

  it("keeps resume locked when configured host capture cleanup fails", async () => {
    const harness = setup("host");
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    harness.capture.capture = async (input) => {
      markStarted();
      await new Promise<void>((resolve) => {
        input.signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      throw new Error("EVIDENCE_PROCESS_TREE_STOP_FAILED");
    };
    const draining = harness.worker.drainOne();
    await started;

    const paused = await harness.commands.pauseIssue(harness.issue.id);

    expect(paused).toMatchObject({ status: "PAUSED", pauseContext: { ready: false } });
    await expect(draining).rejects.toThrow("EVIDENCE_PROCESS_TREE_STOP_FAILED");
    expect(() => harness.commands.resumeIssue(harness.issue.id))
      .toThrow("ISSUE_PAUSE_IN_PROGRESS");
    expect(harness.store.readEvents(harness.issue.id)).toContainEqual(expect.objectContaining({
      type: "AGENT_PAUSE_FAILED",
      actor: "SYSTEM",
    }));
  });

  it("requeues an interrupted evidence turn without consuming a retry", async () => {
    const harness = setup("agent");
    harness.agent.evidenceError = new AgentTurnInterruptedError("RUNTIME_STOPPING");

    await harness.worker.drainOne();

    expect(harness.store.getIssue(harness.issue.id)).toMatchObject({
      status: "EVIDENCE_CAPTURE",
      repair: { iteration: 1, evidenceRetries: 0 },
    });
    expect(harness.store.listPendingOperations()[0]?.operation).toBe("CAPTURE_EVIDENCE");
    expect(harness.agent.repairSessions).toEqual([]);
  });

  it("retries host failures as evidence work", async () => {
    const harness = setup("host");
    harness.capture.error = new EvidenceCaptureError(
      "EVIDENCE_TARGET_UNREACHABLE",
      "browser",
      "127.0.0.1:9",
    );

    await harness.worker.drainOne();

    expect(harness.store.getIssue(harness.issue.id)).toMatchObject({
      status: "EVIDENCE_CAPTURE",
      repair: { iteration: 1, evidenceRetries: 1 },
    });
    expect(harness.agent.repairSessions).toEqual([]);
  });

  it("stops evidence retries without losing the implementation draft", async () => {
    const harness = setup("agent");
    harness.evidence.importError = new Error("private path");

    await harness.worker.drain();

    expect(harness.store.getIssue(harness.issue.id)).toMatchObject({
      status: "EVIDENCE_FAILED",
      repair: {
        iteration: 1,
        evidenceRetries: 2,
        deliveryDraft: { summary: "Implemented" },
      },
      lastFailure: { stage: "EVIDENCE", code: "EVIDENCE_RETRY_LIMIT_REACHED" },
    });
    expect(harness.agent.evidenceSessions).toHaveLength(3);
    expect(harness.agent.repairSessions).toEqual([]);
  });

  it("retries rejected inspections without incrementing Repair", async () => {
    const harness = setup("agent");
    harness.evidence.nextInspection = {
      ...harness.evidence.nextInspection,
      exists: false,
      byteLength: 0,
    };

    await harness.worker.drain();

    expect(harness.store.getIssue(harness.issue.id)).toMatchObject({
      status: "EVIDENCE_FAILED",
      repair: { iteration: 1, evidenceRetries: 2 },
    });
    expect(harness.agent.evidenceSessions).toHaveLength(3);
    expect(harness.agent.repairSessions).toEqual([]);
  });
});

function setup(mode: "host" | "agent") {
  const agent = new FakeAgent();
  const operations = new IssueOperationCoordinator();
  const harness = createHarness(agent, { operations });
  if (mode === "host") {
    const currentProject = harness.store.getProject(project.id)!;
    harness.store.updateProject({
      ...currentProject,
      commands: {
        start: "pnpm dev",
        acceptanceUrl: "http://127.0.0.1:4173",
        evidenceCapture: { mode: "browser", label: "Host proof" },
      },
    }, currentProject.revision!);
  }
  const issue = evidenceIssue(`evidence-${mode}`);
  harness.store.transaction((transaction) => {
    transaction.insertIssue(issue, "CAPTURE_EVIDENCE");
  });
  return {
    ...harness,
    agent,
    issue,
    worker: new RuntimeWorker({
      store: harness.store,
      agents: harness.agents,
      evidence: harness.evidence,
      capture: harness.capture,
      workspaces: harness.workspaces,
      operations,
      id: eventIds(`evidence-${mode}`),
      now: () => now,
    }),
  };
}
