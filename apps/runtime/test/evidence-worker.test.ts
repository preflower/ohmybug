import {
  AgentCapabilityRequiredError,
  AgentTurnInterruptedError,
  type Issue,
} from "@oh-my-bug/core";
import { describe, expect, it } from "vitest";

import { EvidenceCaptureError } from "../src/evidence/capture-provider.js";
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
  const harness = createHarness(agent);
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
      id: eventIds(`evidence-${mode}`),
      now: () => now,
    }),
  };
}
