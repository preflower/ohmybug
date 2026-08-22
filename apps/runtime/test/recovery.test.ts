import { describe, expect, it } from "vitest";

import { OhMyBugRuntime } from "../src/runtime.js";
import { FakeAgent } from "./helpers/fakes.js";
import { assessment, createHarness, eventIds, now, project } from "./helpers/runtime.js";

describe("Runtime recovery", () => {
  it.each([
    ["ASSESSING", "ASSESSMENT_FAILED", "ASSESSMENT"],
    ["REPAIRING", "REPAIR_FAILED", "REPAIR"],
    ["EVIDENCE_CHECK", "REPAIR_FAILED", "REPAIR"],
  ] as const)("reconciles interrupted %s to %s once", async (status, expected, stage) => {
    const agent = new FakeAgent();
    const { commands, store, agents, evidence, workspaces } = createHarness(agent);
    const issue = {
      id: `interrupted-${status}`,
      projectId: project.id,
      identifier: `OMB-${status}`,
      title: "Interrupted",
      titleSource: "user" as const,
      status,
      inputs: [],
      ...(status === "EVIDENCE_CHECK"
        ? {
            assessment,
            agentSession: { agent: "fake", sessionId: "session-1" },
            repair: {
              iteration: 1,
              delivery: {
                summary: "x",
                evidence: [{
                  type: "screenshot" as const,
                  label: "x",
                  evidenceId: `sha256-${"a".repeat(64)}`,
                }],
              },
            },
          }
        : {}),
      revision: 3,
      createdAt: now,
      updatedAt: now,
    };
    store.transaction((transaction) => transaction.insertIssue(issue, "ASSESS"));
    store.transaction((transaction) => transaction.updateIssue(issue, issue.revision, null));
    let sequence = 0;
    const runtime = new OhMyBugRuntime({
      commands,
      store,
      agents,
      evidence,
      workspaces,
      id: () => `recovery-${++sequence}`,
      now: () => now,
    });

    await runtime.start();
    await runtime.start();

    expect(store.getIssue(issue.id)).toMatchObject({
      status: expected,
      lastFailure: { stage, code: "RUNTIME_INTERRUPTED" },
    });
    expect(store.readEvents(issue.id).filter((event) => event.type === "RUNTIME_INTERRUPTED"))
      .toHaveLength(1);
  });

  it.each(["ASSESSMENT_REVIEW", "ACCEPTANCE_REVIEW", "COMPLETED", "CLOSED"] as const)(
    "leaves durable %s work unchanged",
    async (status) => {
      const agent = new FakeAgent();
      const { commands, store, agents, evidence, workspaces } = createHarness(agent);
      const issue = {
        id: `stable-${status}`,
        projectId: project.id,
        identifier: `OMB-${status}`,
        title: "Stable",
        titleSource: "user" as const,
        status,
        inputs: [],
        ...(status === "COMPLETED"
          ? { resolution: "FIXED" as const }
          : status === "CLOSED"
            ? { resolution: "NOT_A_BUG" as const }
            : {}),
        revision: 3,
        createdAt: now,
        updatedAt: now,
      };
      store.transaction((transaction) => transaction.insertIssue(issue, "ASSESS"));
      store.transaction((transaction) => transaction.updateIssue(issue, issue.revision, null));
      const runtime = new OhMyBugRuntime({
        commands,
        store,
        agents,
        evidence,
        workspaces,
        id: eventIds("stable-event"),
        now: () => now,
      });

      await runtime.start();

      expect(store.getIssue(issue.id)).toEqual(issue);
      expect(store.readEvents(issue.id)).toEqual([]);
    },
  );

  it("becomes ready before recovered Agent work finishes", async () => {
    const agent = new FakeAgent();
    let releaseAssessment!: () => void;
    const blocked = new Promise<void>((resolve) => { releaseAssessment = resolve; });
    const originalAssess = agent.assess.bind(agent);
    agent.assess = async (...args) => {
      await blocked;
      return originalAssess(...args);
    };
    const { commands, store, agents, evidence, workspaces } = createHarness(agent);
    store.transaction((transaction) => transaction.insertIssue({
      id: "slow-pending-assess",
      projectId: project.id,
      projectPath: project.path,
      identifier: "OMB-23",
      title: "Slow assess",
      titleSource: "user",
      status: "RECEIVED",
      inputs: [],
      revision: 1,
      createdAt: now,
      updatedAt: now,
    }, "ASSESS"));
    const runtime = new OhMyBugRuntime({
      commands,
      store,
      agents,
      evidence,
      workspaces,
      id: eventIds("slow-start-event"),
      now: () => now,
    });

    await runtime.start();
    expect(runtime.health()).toEqual({ state: "ready" });
    releaseAssessment();
    await runtime.drain();
    expect(store.getIssue("slow-pending-assess")?.status).toBe("ASSESSMENT_REVIEW");
  });
});
