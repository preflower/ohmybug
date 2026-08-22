import { AgentTurnInterruptedError, type Assessment } from "@oh-my-bug/core";
import { describe, expect, it } from "vitest";

import { OhMyBugRuntime } from "../src/runtime.js";
import { FakeAgent } from "./helpers/fakes.js";
import { createHarness, eventIds, now, project } from "./helpers/runtime.js";

describe("Runtime shutdown", () => {
  it("rejects new commands after idempotent shutdown", async () => {
    const agent = new FakeAgent();
    const { commands, store, agents, evidence, workspaces } = createHarness(agent);
    const runtime = new OhMyBugRuntime({
      commands,
      store,
      agents,
      evidence,
      workspaces,
      id: eventIds("shutdown-event"),
      now: () => now,
    });

    await runtime.stop();
    await runtime.stop();

    await expect(runtime.submitManual(project.id, { commandId: "late", content: "Bug" }))
      .rejects.toThrow("RUNTIME_STOPPED");
  });

  it("requeues an in-flight Agent turn without redispatching during shutdown", async () => {
    const agent = new FakeAgent();
    let rejectAssessment!: (error: Error) => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const deferred = new Promise<Assessment>((_resolve, reject) => { rejectAssessment = reject; });
    let attempts = 0;
    agent.assess = async (session) => {
      agent.assessSessions.push(session.sessionId);
      attempts += 1;
      markStarted();
      return attempts === 1 ? deferred : agent.nextAssessment;
    };
    const { commands, store, agents, evidence, workspaces } = createHarness(agent);
    const created = await commands.submitManual(project.id, {
      commandId: "in-flight",
      content: "Bug",
    });
    if (created.kind !== "CREATED") throw new Error("CREATED_REQUIRED");
    let stoppedIssue: ReturnType<typeof store.getIssue>;
    let stoppedPending: ReturnType<typeof store.listPendingOperations> = [];
    const runtime = new OhMyBugRuntime({
      commands,
      store,
      agents,
      evidence,
      workspaces,
      id: eventIds("shutdown-event"),
      now: () => now,
      modules: {
        start: async () => undefined,
        stop: async () => {
          stoppedIssue = store.getIssue(created.issue.id);
          stoppedPending = store.listPendingOperations();
        },
      },
    });
    await runtime.start();
    await started;

    const originalCancel = agent.cancel.bind(agent);
    agent.cancel = async (session, reason) => {
      await originalCancel(session, reason);
      rejectAssessment(new AgentTurnInterruptedError(reason));
    };

    await runtime.stop();

    expect(agent.cancellations).toContainEqual({
      sessionId: "session-1",
      reason: "RUNTIME_STOPPING",
    });
    expect(stoppedIssue?.status).toBe("ASSESSING");
    expect(stoppedPending[0]?.operation).toBe("ASSESS");
    expect(agent.assessSessions).toEqual(["session-1"]);
  });
});
