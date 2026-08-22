import type { Assessment } from "@oh-my-bug/core";
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

  it("waits for an in-flight Agent result to reach durable storage", async () => {
    const agent = new FakeAgent();
    let releaseAssessment!: (result: Assessment) => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const deferred = new Promise<Assessment>((resolve) => { releaseAssessment = resolve; });
    agent.assess = async (session) => {
      agent.assessSessions.push(session.sessionId);
      markStarted();
      return deferred;
    };
    const { commands, store, agents, evidence, workspaces } = createHarness(agent);
    const created = await commands.submitManual(project.id, {
      commandId: "in-flight",
      content: "Bug",
    });
    if (created.kind !== "CREATED") throw new Error("CREATED_REQUIRED");
    const runtime = new OhMyBugRuntime({
      commands,
      store,
      agents,
      evidence,
      workspaces,
      id: eventIds("shutdown-event"),
      now: () => now,
    });
    await runtime.start();
    await started;

    let stopped = false;
    const stopping = runtime.stop().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    releaseAssessment(agent.nextAssessment);
    await stopping;
    expect(stopped).toBe(true);
  });
});
