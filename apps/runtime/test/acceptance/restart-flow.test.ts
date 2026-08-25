import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  AgentCapabilityRequiredError,
  acceptIntegrationInput,
  transitionIssue,
  type Assessment,
  type IntegrationInput,
} from "@oh-my-bug/core";
import { openRuntimeDatabase, SqliteRuntimeStore } from "@oh-my-bug/storage";
import { afterEach, describe, expect, it } from "vitest";

import { createRuntime } from "../../src/composition.js";
import { FakeAgent } from "../helpers/fakes.js";
import { assessment, project } from "../helpers/runtime.js";

const timestamp = "2026-08-20T16:00:00.000Z";
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryDatabase(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return join(directory, "runtime.sqlite");
}

function runtimeOptions(databasePath: string, agent = new FakeAgent()) {
  let sequence = 0;
  return {
    databasePath,
    agent,
    id: () => `restart-${++sequence}`,
    now: () => timestamp,
  };
}

function assessmentReference(result: Assessment) {
  return {
    assessmentRevision: result.revision,
    assessmentContentHash: result.contentHash,
  };
}

async function submitAssessed(
  runtime: ReturnType<typeof createRuntime>,
  commandId: string,
) {
  const created = await runtime.submitManual(project.id, { commandId, content: commandId });
  if (created.kind !== "CREATED") throw new Error("CREATED_REQUIRED");
  await runtime.drain();
  return runtime.getIssue(created.issue.id);
}

class CapabilityRequestAgent extends FakeAgent {
  private assessmentRequests = 0;
  private repairRequests = 0;

  async assess(
    session: Parameters<FakeAgent["assess"]>[0],
    input: Parameters<FakeAgent["assess"]>[1],
  ) {
    this.assessmentRequests += 1;
    if (this.assessmentRequests === 1) {
      this.assessSessions.push(session.sessionId);
      this.assessInputs.push(input);
      throw new AgentCapabilityRequiredError({
        capabilities: ["NETWORK_ACCESS"],
        reason: "Read the upstream API contract",
        requestedBy: { type: "AGENT" },
      });
    }
    return super.assess(session, input);
  }

  async repair(
    session: Parameters<FakeAgent["repair"]>[0],
    input: Parameters<FakeAgent["repair"]>[1],
  ) {
    this.repairRequests += 1;
    if (this.repairRequests === 1) {
      this.repairSessions.push(session.sessionId);
      this.repairInputs.push(input);
      throw new AgentCapabilityRequiredError({
        capabilities: ["HOST_EXECUTION"],
        reason: "Launch Electron acceptance",
        blockedCommand: "pnpm test:e2e:electron",
        requestedBy: { type: "SKILL", id: "implement-ui-design" },
      });
    }
    return super.repair(session, input);
  }
}

describe("SQLite-backed review and recovery acceptance", () => {
  it("persists Issue-scoped capability grants and resumes the same Agent session", async () => {
    const databasePath = temporaryDatabase("omb-runtime-capability-");
    const projectRoot = join(dirname(databasePath), "project");
    mkdirSync(projectRoot);
    const agent = new CapabilityRequestAgent();
    agent.nextRepairResult = {
      kind: "DELIVERY_READY",
      summary: "Implemented",
      evidence: [],
      verification: [],
    };
    const options = runtimeOptions(databasePath, agent);
    const runtime = createRuntime(options);
    runtime.registerProject({ ...project, path: projectRoot });
    await runtime.start();

    const created = await runtime.submitManual(project.id, {
      commandId: "capability-primary",
      content: "Requires upstream context and Electron acceptance",
    });
    if (created.kind !== "CREATED") throw new Error("CREATED_REQUIRED");
    await runtime.drain();
    const assessmentPaused = runtime.getIssue(created.issue.id);
    expect(assessmentPaused).toMatchObject({
      status: "PERMISSION_REQUIRED",
      agentSession: { sessionId: "session-1" },
      pendingCapabilityRequest: {
        operation: "ASSESS",
        capabilities: ["NETWORK_ACCESS"],
      },
    });

    const otherCreated = await runtime.submitManual(project.id, {
      commandId: "capability-other",
      content: "Independent Issue",
    });
    if (otherCreated.kind !== "CREATED") throw new Error("CREATED_REQUIRED");
    await runtime.drain();
    const otherIssue = runtime.getIssue(otherCreated.issue.id);
    expect(otherIssue.status).toBe("REVIEW_REQUIRED");
    expect(otherIssue).not.toHaveProperty("capabilityGrants");
    await runtime.stop();

    const reopened = createRuntime(options);
    await reopened.start();
    await reopened.drain();
    const stillPaused = reopened.getIssue(assessmentPaused.id);
    expect(stillPaused).toMatchObject({
      status: "PERMISSION_REQUIRED",
      pendingCapabilityRequest: {
        id: assessmentPaused.pendingCapabilityRequest!.id,
        capabilities: ["NETWORK_ACCESS"],
      },
    });
    expect(agent.assessSessions.filter((session) => session === "session-1")).toHaveLength(1);

    reopened.grantIssueCapabilities(
      stillPaused.id,
      stillPaused.revision,
      stillPaused.pendingCapabilityRequest!.id,
    );
    await reopened.drain();
    const assessed = reopened.getIssue(stillPaused.id);
    expect(assessed.status).toBe("REVIEW_REQUIRED");
    expect(agent.assessSessions.filter((session) => session === "session-1")).toHaveLength(2);
    expect(agent.assessInputs.at(-1)?.continuation).toEqual({
      reason: "CAPABILITY_GRANTED",
      requestId: stillPaused.pendingCapabilityRequest!.id,
      capabilities: ["NETWORK_ACCESS"],
    });

    reopened.approveAssessment(assessed.id, {
      ...assessmentReference(assessed.assessment!),
      title: assessed.assessment!.suggestedTitle,
    });
    await reopened.drain();
    const repairPaused = reopened.getIssue(assessed.id);
    expect(repairPaused).toMatchObject({
      status: "PERMISSION_REQUIRED",
      capabilityGrants: [{ capability: "NETWORK_ACCESS" }],
      pendingCapabilityRequest: {
        operation: "REPAIR",
        capabilities: ["HOST_EXECUTION"],
      },
    });

    reopened.grantIssueCapabilities(
      repairPaused.id,
      repairPaused.revision,
      repairPaused.pendingCapabilityRequest!.id,
    );
    await reopened.drain();
    const delivered = reopened.getIssue(repairPaused.id);
    expect(delivered).toMatchObject({
      status: "REVIEW_REQUIRED",
      capabilityGrants: [
        { capability: "NETWORK_ACCESS" },
        { capability: "HOST_EXECUTION" },
      ],
    });
    expect(agent.repairSessions).toEqual(["session-1", "session-1"]);
    expect(agent.repairInputs.at(-1)?.continuation).toEqual({
      reason: "CAPABILITY_GRANTED",
      requestId: repairPaused.pendingCapabilityRequest!.id,
      capabilities: ["HOST_EXECUTION"],
    });
    expect(agent.evidenceSessions).toEqual(["session-1"]);
    expect(agent.evidenceInputs[0]?.continuation).toBeUndefined();
    expect(reopened.getIssue(otherIssue.id)).not.toHaveProperty("capabilityGrants");
    await reopened.stop();
  });

  it("persists human NOT_A_BUG and duplicate decisions across restarts", async () => {
    const databasePath = temporaryDatabase("omb-runtime-review-");
    const agent = new FakeAgent();
    const options = runtimeOptions(databasePath, agent);
    const runtime = createRuntime(options);
    runtime.registerProject(project);
    await runtime.start();
    const target = await submitAssessed(runtime, "canonical-target");

    agent.nextAssessment = {
      ...assessment,
      verdict: "NOT_A_BUG",
      suggestedTitle: "Expected behavior",
      reasoning: "The route is intentionally disabled",
      rootCause: undefined,
      solution: undefined,
    };
    const notABug = await submitAssessed(runtime, "not-a-bug");
    agent.nextAssessment = { ...assessment, revision: 2, contentHash: "b".repeat(64) };
    const duplicate = await submitAssessed(runtime, "duplicate");
    await runtime.stop();

    const reopened = createRuntime(options);
    reopened.confirmNotABug(notABug.id, assessmentReference(notABug.assessment!));
    reopened.confirmDuplicate(duplicate.id, assessmentReference(duplicate.assessment!), target.id);
    await reopened.stop();

    const verified = createRuntime(options);
    expect(verified.getIssue(notABug.id)).toMatchObject({
      status: "CLOSED",
      resolution: "NOT_A_BUG",
    });
    expect(verified.getIssue(duplicate.id)).toMatchObject({
      status: "CLOSED",
      resolution: "DUPLICATE",
      duplicateOf: target.identifier,
    });
    await verified.stop();
  });

  it("retries invalid evidence and human rejection in the same Agent session", async () => {
    const databasePath = temporaryDatabase("omb-runtime-repair-loop-");
    const agent = new FakeAgent();
    const repair = agent.repair.bind(agent);
    let attempt = 0;
    agent.repair = async (session, input) => {
      const result = await repair(session, input);
      attempt += 1;
      return attempt === 1 && result.kind === "DELIVERY_READY"
        ? { ...result, evidence: [{ ...result.evidence[0]!, relativePath: "missing.png" }] }
        : result;
    };
    const options = runtimeOptions(databasePath, agent);
    const runtime = createRuntime(options);
    const projectRoot = join(dirname(databasePath), "project");
    mkdirSync(projectRoot);
    runtime.registerProject({ ...project, path: projectRoot });
    await runtime.start();
    const issue = await submitAssessed(runtime, "repair-loop");
    runtime.approveAssessment(issue.id, {
      ...assessmentReference(issue.assessment!),
      title: issue.assessment!.suggestedTitle,
    });

    await runtime.drain();

    expect(runtime.getIssue(issue.id)).toMatchObject({
      status: "REVIEW_REQUIRED",
      repair: { iteration: 1, evidenceRetries: 1 },
    });
    expect(agent.evidenceInputs[0]?.feedback).toContain("Evidence could not be imported or verified");
    runtime.rejectDelivery(issue.id, "Please show the restored payment route.");
    await runtime.drain();
    expect(runtime.getIssue(issue.id)).toMatchObject({
      status: "REVIEW_REQUIRED",
      repair: { iteration: 2 },
    });
    expect(agent.repairInputs[1]?.feedback).toBe("Please show the restored payment route.");
    expect(agent.repairSessions).toEqual(["session-1", "session-1"]);
    expect(agent.evidenceSessions).toEqual(["session-1"]);
    await runtime.stop();
  });

  it("rebuilds an unavailable native session only after an explicit command", async () => {
    const databasePath = temporaryDatabase("omb-runtime-session-rebuild-");
    const agent = new FakeAgent();
    agent.assessError = new Error("AGENT_SESSION_UNAVAILABLE");
    const options = runtimeOptions(databasePath, agent);
    const runtime = createRuntime(options);
    runtime.registerProject(project);
    await runtime.start();
    const created = await runtime.submitManual(project.id, {
      commandId: "missing-session",
      content: "missing session",
    });
    if (created.kind !== "CREATED") throw new Error("CREATED_REQUIRED");
    await runtime.drain();
    const failed = runtime.getIssue(created.issue.id);
    expect(failed).toMatchObject({
      status: "ASSESSMENT_FAILED",
      lastFailure: { code: "AGENT_SESSION_UNAVAILABLE" },
      agentSession: { sessionId: "session-1" },
    });
    await runtime.stop();

    agent.assessError = undefined;
    const reopened = createRuntime(options);
    const rebuilt = await reopened.rebuildAgentSession(failed.id, failed.revision);
    expect(rebuilt).toMatchObject({
      status: "ASSESSING",
      agentSession: { sessionId: "session-2" },
    });
    await reopened.start();
    await reopened.drain();
    expect(reopened.getIssue(failed.id).status).toBe("REVIEW_REQUIRED");
    expect(agent.assessSessions).toEqual(["session-1", "session-2"]);
    await reopened.stop();
  });

  it("processes durable pending work and reconciles abandoned work exactly once", async () => {
    const databasePath = temporaryDatabase("omb-runtime-restart-");
    let sequence = 0;
    const store = new SqliteRuntimeStore(openRuntimeDatabase(databasePath), {
      id: () => `seed-issue-${++sequence}`,
    });
    store.registerProject(project);
    const pendingInput: IntegrationInput = {
      id: "pending-input",
      integration: "test-channel",
      inputKey: "pending-event",
      rawData: { message: "pending" },
      data: { content: "pending" },
      receivedAt: timestamp,
    };
    const pending = store.transaction((transaction) => acceptIntegrationInput({
      projectId: project.id,
      input: pendingInput,
      transaction,
      id: () => `seed-event-${++sequence}`,
      now: timestamp,
    }));
    if (pending.kind !== "CREATED") throw new Error("CREATED_REQUIRED");
    const abandoned = transitionIssue({
      ...pending.issue,
      id: "abandoned-issue",
      identifier: "OMB-99",
      inputs: [{ ...pendingInput, id: "abandoned-input", inputKey: "abandoned-event" }],
    }, "START_ASSESSMENT", timestamp);
    store.transaction((transaction) => transaction.insertIssue(abandoned, "ASSESS"));
    store.transaction((transaction) => transaction.updateIssue(abandoned, abandoned.revision, null));
    store.close();

    const options = runtimeOptions(databasePath);
    const runtime = createRuntime(options);
    await runtime.start();
    await runtime.drain();
    const recoveredPending = runtime.getIssue(pending.issue.id);
    const recoveredAbandoned = runtime.getIssue(abandoned.id);
    expect(recoveredPending).toMatchObject({
      status: "REVIEW_REQUIRED",
      agentSession: { sessionId: expect.stringMatching(/^session-/) },
    });
    expect(recoveredAbandoned).toMatchObject({
      status: "REVIEW_REQUIRED",
      agentSession: { sessionId: expect.stringMatching(/^session-/) },
    });
    expect(recoveredAbandoned.agentSession?.sessionId)
      .not.toBe(recoveredPending.agentSession?.sessionId);
    expect(recoveredAbandoned).not.toHaveProperty("lastFailure");
    expect(runtime.readIssueEvents(abandoned.id)
      .filter((event) => event.type === "RUNTIME_INTERRUPTED")).toHaveLength(1);
    await runtime.stop();

    const reopened = createRuntime(options);
    await reopened.start();
    expect(reopened.readIssueEvents(abandoned.id)
      .filter((event) => event.type === "RUNTIME_INTERRUPTED")).toHaveLength(1);
    await reopened.stop();
  });

  it("resumes interrupted Repair in the same logical session and iteration", async () => {
    const databasePath = temporaryDatabase("omb-runtime-repair-resume-");
    const projectRoot = join(dirname(databasePath), "project");
    mkdirSync(projectRoot);
    const seededStore = new SqliteRuntimeStore(openRuntimeDatabase(databasePath));
    seededStore.registerProject({ ...project, path: projectRoot });
    const interrupted = {
      id: "interrupted-repair",
      projectId: project.id,
      projectPath: projectRoot,
      identifier: "OMB-RESTART-REPAIR",
      title: "Interrupted repair",
      titleSource: "user" as const,
      status: "REPAIRING" as const,
      inputs: [],
      agentSession: { agent: "fake", sessionId: "session-1" },
      assessment,
      repair: { iteration: 2 },
      revision: 5,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    seededStore.transaction((transaction) =>
      transaction.insertIssue(interrupted, "REPAIR"));
    seededStore.transaction((transaction) =>
      transaction.updateIssue(interrupted, interrupted.revision, null));
    seededStore.close();

    const agent = new FakeAgent();
    const runtime = createRuntime(runtimeOptions(databasePath, agent));
    await runtime.start();
    await runtime.drain();

    expect(runtime.getIssue(interrupted.id)).toMatchObject({
      status: "REVIEW_REQUIRED",
      agentSession: interrupted.agentSession,
      repair: { iteration: 2 },
    });
    expect(agent.repairSessions).toEqual(["session-1"]);
    expect(runtime.readIssueEvents(interrupted.id).filter(
      (event) => event.type === "RUNTIME_INTERRUPTED",
    )).toHaveLength(1);
    await runtime.stop();
  });
});
