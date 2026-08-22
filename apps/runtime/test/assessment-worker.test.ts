import { describe, expect, it } from "vitest";

import { RuntimeWorker } from "../src/orchestration/worker.js";
import { FakeAgent } from "./helpers/fakes.js";
import { createHarness, eventIds, project } from "./helpers/runtime.js";

describe("Runtime assessment worker", () => {
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
      status: "ASSESSMENT_REVIEW",
      agentSession: { agent: "fake", sessionId: "session-1" },
      assessment: agent.nextAssessment,
    });
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
});
