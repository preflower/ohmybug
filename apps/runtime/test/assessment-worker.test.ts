import {
  AgentCapabilityRequiredError,
  AgentTurnInterruptedError,
} from "@oh-my-bug/core";
import { describe, expect, it } from "vitest";

import { RuntimeWorker } from "../src/orchestration/worker.js";
import { FakeAgent } from "./helpers/fakes.js";
import { createHarness, eventIds, project } from "./helpers/runtime.js";

describe("Runtime assessment worker", () => {
  it("pauses Assessment for a capability request without recording failure", async () => {
    const agent = new FakeAgent();
    agent.assessError = capabilityError();
    const { commands, store, agents, evidence, workspaces } = createHarness(agent);
    const created = await commands.submitManual(project.id, {
      commandId: "assessment-permission",
      content: "Launch acceptance",
    });
    if (created.kind !== "CREATED") throw new Error("CREATED_REQUIRED");
    const worker = new RuntimeWorker({
      store,
      agents,
      evidence,
      workspaces,
      id: eventIds("assessment-permission"),
      now: () => "2026-08-24T08:00:00.000Z",
    });

    await worker.drainOne();
    await worker.drainOne();

    const paused = store.getIssue(created.issue.id);
    expect(paused).toMatchObject({
      status: "PERMISSION_REQUIRED",
      pendingCapabilityRequest: {
        operation: "ASSESS",
        stage: "ASSESSMENT",
        resumeStatus: "ASSESSING",
        capabilities: ["HOST_EXECUTION"],
      },
    });
    expect(paused).not.toHaveProperty("lastFailure");
    expect(store.listPendingOperations()).toEqual([]);
    expect(JSON.stringify(paused)).not.toContain("secret-value");
    expect(JSON.stringify(store.readEvents(created.issue.id))).not.toContain("secret-value");
  });

  it("queues Workspace preparation before Assessment", async () => {
    const agent = new FakeAgent();
    const { commands, store, agents, evidence, workspaces } = createHarness(agent);
    const created = await commands.submitManual(project.id, {
      commandId: "prepare-1",
      content: "Checkout fails",
    });
    if (created.kind !== "CREATED") throw new Error("CREATED_REQUIRED");

    expect(store.listPendingOperations()).toEqual([
      { issue: created.issue, operation: "PREPARE" },
    ]);
    expect(agent.assessSessions).toHaveLength(0);

    await new RuntimeWorker({
      store,
      agents,
      evidence,
      workspaces,
      id: eventIds("prepare"),
      now: () => "2026-08-20T15:01:00.000Z",
    }).drainOne();

    expect(store.getIssue(created.issue.id)).toMatchObject({ projectPath: project.path });
    expect(store.listPendingOperations()[0]?.operation).toBe("ASSESS");
    expect(agent.assessSessions).toHaveLength(0);
  });

  it("records Workspace preparation failure without starting Assessment", async () => {
    const agent = new FakeAgent();
    const {
      commands,
      store,
      agents,
      evidence,
      workspacePersistence,
      workspaces,
    } = createHarness(agent);
    workspacePersistence.setProjectConfiguration(project.id, {
      provider: "missing",
      config: {},
    });
    const created = await commands.submitManual(project.id, {
      commandId: "prepare-failure",
      content: "Checkout fails",
    });
    if (created.kind !== "CREATED") throw new Error("CREATED_REQUIRED");

    await new RuntimeWorker({
      store,
      agents,
      evidence,
      workspaces,
      id: eventIds("prepare-failure"),
      now: () => "2026-08-20T15:01:00.000Z",
    }).drainOne();

    expect(store.getIssue(created.issue.id)).toEqual(created.issue);
    expect(store.listPendingOperations()).toEqual([]);
    expect(workspacePersistence.getBinding(created.issue.id)).toMatchObject({
      providerId: "missing",
      status: "FAILED",
      lastError: "WORKSPACE_PROVIDER_NOT_AVAILABLE:missing",
    });
    expect(store.readEvents(created.issue.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "WORKSPACE_PREPARATION_FAILED" }),
    ]));
    expect(agent.assessSessions).toHaveLength(0);
  });

  it("rejects Assessment work without a prepared projectPath", async () => {
    const agent = new FakeAgent();
    const { store, agents, evidence, workspaces } = createHarness(agent);
    const unprepared = {
      id: "unprepared-assessment",
      projectId: project.id,
      identifier: "OMB-UNPREPARED",
      title: "Unprepared",
      titleSource: "user" as const,
      status: "RECEIVED" as const,
      inputs: [],
      revision: 1,
      createdAt: "2026-08-20T15:00:00.000Z",
      updatedAt: "2026-08-20T15:00:00.000Z",
    };
    store.transaction((transaction) => transaction.insertIssue(unprepared, "ASSESS"));

    await expect(new RuntimeWorker({
      store,
      agents,
      evidence,
      workspaces,
      id: eventIds("unprepared"),
      now: () => "2026-08-20T15:01:00.000Z",
    }).drainOne()).rejects.toThrow("ISSUE_PROJECT_PATH_REQUIRED");
    expect(agent.createdSessions).toHaveLength(0);
  });

  it("creates, persists, and reuses one logical Agent session", async () => {
    const agent = new FakeAgent();
    const { commands, store, agents, evidence, workspaces } = createHarness(agent);
    const created = await commands.submitManual(project.id, {
      commandId: "command-1",
      content: "支付页打不开",
    });
    if (created.kind !== "CREATED") throw new Error("CREATED_REQUIRED");
    let sequence = 0;
    const worker = new RuntimeWorker({
      store,
      agents,
      evidence,
      workspaces,
      id: () => `worker-event-${++sequence}`,
      now: () => "2026-08-20T15:01:00.000Z",
    });

    await worker.drain();

    const issue = store.getIssue(created.issue.id);
    expect(issue).toMatchObject({
      status: "REVIEW_REQUIRED",
      review: { kind: "assessment", requestedFrom: "ASSESSING" },
      agentSession: { agent: "fake", sessionId: "session-1" },
      assessment: agent.nextAssessment,
    });
    expect(issue?.review?.id).not.toMatch(/^legacy:/);
    expect(store.readEvents(created.issue.id).map((event) => event.type))
      .toContain("REVIEW_REQUESTED");
    expect(store.getAgentSession("session-1")).toMatchObject({
      issueId: created.issue.id,
      projectId: project.id,
      lifecycle: "ACTIVE",
    });
    expect(agent.assessSessions).toEqual(["session-1"]);
    await worker.drain();
    expect(agent.assessSessions).toEqual(["session-1"]);
  });

  it("records an unavailable provider session without auto-replacement", async () => {
    const agent = new FakeAgent();
    agent.assessError = new Error("AGENT_SESSION_UNAVAILABLE");
    const { commands, store, agents, evidence, workspaces } = createHarness(agent);
    const created = await commands.submitManual(project.id, {
      commandId: "command-2",
      content: "Bug",
    });
    if (created.kind !== "CREATED") throw new Error("CREATED_REQUIRED");

    await new RuntimeWorker({
      store,
      agents,
      evidence,
      workspaces,
      id: eventIds("assessment-failed"),
      now: () => "2026-08-20T15:01:00.000Z",
    }).drain();

    expect(store.getIssue(created.issue.id)).toMatchObject({
      status: "ASSESSMENT_FAILED",
      lastFailure: { stage: "ASSESSMENT", code: "AGENT_SESSION_UNAVAILABLE" },
      agentSession: { sessionId: "session-1" },
    });
    expect(agent.createdSessions).toHaveLength(1);
  });

  it("records a stable Assessment failure when the configured Agent plugin is not installed", async () => {
    const { commands, store, agents, evidence, workspaces } = createHarness(new FakeAgent());
    const missingProject = {
      ...project,
      id: "project-missing-agent",
      key: "MISSING",
      agent: { plugin: "missing" },
    };
    commands.registerProject(missingProject);
    const created = await commands.submitManual(missingProject.id, {
      commandId: "missing-agent",
      content: "Bug",
    });
    if (created.kind !== "CREATED") throw new Error("CREATED_REQUIRED");
    const worker = new RuntimeWorker({
      store,
      agents,
      evidence,
      workspaces,
      id: eventIds("missing-agent"),
      now: () => "2026-08-20T15:01:00.000Z",
    });

    await expect(worker.drain()).resolves.toBeUndefined();
    expect(store.getIssue(created.issue.id)).toMatchObject({
      status: "ASSESSMENT_FAILED",
      lastFailure: { stage: "ASSESSMENT", code: "AGENT_PLUGIN_NOT_INSTALLED" },
    });
    expect(store.listPendingOperations()).toEqual([]);
  });

  it("does not start Assessment when cancellation wins session creation", async () => {
    const agent = new FakeAgent();
    let sessionStarted!: () => void;
    let releaseSession!: () => void;
    const started = new Promise<void>((resolve) => { sessionStarted = resolve; });
    const released = new Promise<void>((resolve) => { releaseSession = resolve; });
    agent.createSession = async () => {
      sessionStarted();
      await released;
      return { agent: "fake", sessionId: "session-race" };
    };
    const { commands, store, agents, evidence, workspaces } = createHarness(agent);
    const created = await commands.submitManual(project.id, {
      commandId: "cancel-create",
      content: "Cancel",
    });
    if (created.kind !== "CREATED") throw new Error("CREATED_REQUIRED");
    const worker = new RuntimeWorker({
      store,
      agents,
      evidence,
      workspaces,
      id: eventIds("worker-cancel-create"),
      now: () => "2026-08-20T15:01:00.000Z",
    });
    const draining = worker.drain();
    await started;
    await commands.cancelIssue(created.issue.id);
    releaseSession();

    await draining;
    expect(store.getIssue(created.issue.id)).toMatchObject({
      status: "CANCELED",
      resolution: "CANCELED",
    });
    expect(agent.assessSessions).toEqual([]);
    expect(store.getAgentSession("session-race")).toBeUndefined();
  });

  it("requeues Runtime-interrupted Assessment without recording a failure", async () => {
    const agent = new FakeAgent();
    agent.assessError = new AgentTurnInterruptedError("RUNTIME_STOPPING");
    const { commands, store, agents, evidence, workspaces } = createHarness(agent);
    const created = await commands.submitManual(project.id, {
      commandId: "interrupted-assessment",
      content: "Interrupted",
    });
    if (created.kind !== "CREATED") throw new Error("CREATED_REQUIRED");
    const worker = new RuntimeWorker({
      store,
      agents,
      evidence,
      workspaces,
      id: eventIds("interrupted-assessment"),
      now: () => "2026-08-20T15:01:00.000Z",
    });

    await worker.drainOne();
    await worker.drainOne();

    const interrupted = store.getIssue(created.issue.id);
    expect(interrupted).toMatchObject({
      status: "ASSESSING",
      agentSession: { sessionId: "session-1" },
    });
    expect(interrupted).not.toHaveProperty("lastFailure");
    expect(store.listPendingOperations()[0]?.operation).toBe("ASSESS");
    expect(store.readEvents(created.issue.id)).toContainEqual(expect.objectContaining({
      type: "RUNTIME_INTERRUPTED",
      data: expect.objectContaining({
        stage: "ASSESSMENT",
        reason: "RUNTIME_STOPPING",
        sessionId: "session-1",
        attemptId: expect.any(String),
        revision: interrupted!.revision,
      }),
    }));
  });

  it("passes the durable interruption marker into resumed Assessment", async () => {
    const agent = new FakeAgent();
    const { commands, store, agents, evidence, workspaces } = createHarness(agent);
    const created = await commands.submitManual(project.id, {
      commandId: "continued-assessment",
      content: "Continue",
    });
    if (created.kind !== "CREATED") throw new Error("CREATED_REQUIRED");
    const worker = new RuntimeWorker({
      store,
      agents,
      evidence,
      workspaces,
      id: eventIds("continued-assessment"),
      now: () => "2026-08-20T15:01:00.000Z",
    });
    await worker.drainOne();
    const prepared = store.getIssue(created.issue.id)!;
    store.transaction((transaction) => transaction.appendEvent({
      id: "interrupted-event",
      issueId: prepared.id,
      type: "RUNTIME_INTERRUPTED",
      actor: "SYSTEM",
      data: {
        operation: "ASSESS",
        revision: prepared.revision,
        attemptId: "attempt-before-restart",
      },
      occurredAt: prepared.updatedAt,
    }));

    await worker.drainOne();

    expect(agent.assessInputs[0]?.continuation).toEqual({
      reason: "RUNTIME_INTERRUPTED",
      previousAttemptId: "attempt-before-restart",
    });
  });
});

function capabilityError(): AgentCapabilityRequiredError {
  return new AgentCapabilityRequiredError({
    capabilities: ["HOST_EXECUTION"],
    reason: "Launch Electron with token=secret-value",
    blockedCommand: "TOKEN=secret-value pnpm test:e2e:electron",
    requestedBy: { type: "SKILL", id: "implement-ui-design" },
  });
}
