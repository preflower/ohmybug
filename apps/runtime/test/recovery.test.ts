import { describe, expect, it } from "vitest";

import { OhMyBugRuntime } from "../src/runtime.js";
import { reconcileInterruptedIssues } from "../src/orchestration/recovery.js";
import { delivery, FakeAgent } from "./helpers/fakes.js";
import { assessment, createHarness, eventIds, now, project } from "./helpers/runtime.js";

describe("Runtime recovery", () => {
  it("migrates a legacy pending Issue to a Local binding without losing its operation", async () => {
    const { store, workspaces, workspacePersistence } = createHarness();
    const legacy = {
      id: "legacy-assess",
      projectId: project.id,
      identifier: "OMB-LEGACY",
      title: "Legacy",
      titleSource: "user" as const,
      status: "RECEIVED" as const,
      inputs: [],
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    store.transaction((transaction) => transaction.insertIssue(legacy, "ASSESS"));

    await workspaces.recover();

    expect(store.getIssue(legacy.id)).toMatchObject({ projectPath: project.path });
    expect(store.listPendingOperations()).toEqual([
      { issue: expect.objectContaining({ id: legacy.id }), operation: "ASSESS" },
    ]);
    expect(workspacePersistence.getBinding(legacy.id)).toMatchObject({
      providerId: "local",
      resourceId: `local:${legacy.id}`,
      status: "READY",
    });
  });

  it("queues only finalization for an approved Issue recovered after restart", async () => {
    const { store, workspaces, workspacePersistence } = createHarness();
    const approved = {
      id: "approved-restart",
      projectId: project.id,
      projectPath: project.path,
      identifier: "OMB-APPROVED",
      title: "Approved",
      titleSource: "user" as const,
      status: "APPROVED" as const,
      resolution: "FIXED" as const,
      inputs: [],
      assessment,
      repair: { iteration: 1 },
      revision: 7,
      createdAt: now,
      updatedAt: now,
    };
    store.transaction((transaction) => transaction.insertIssue(approved, "FINALIZE"));
    store.transaction((transaction) => transaction.updateIssue(approved, approved.revision, null));

    await workspaces.recover();

    expect(store.listPendingOperations()).toEqual([
      { issue: expect.objectContaining({ id: approved.id }), operation: "FINALIZE" },
    ]);
    expect(workspacePersistence.getBinding(approved.id)?.providerId).toBe("local");
  });

  it("restores a missing path from its persisted READY binding", async () => {
    const { store, workspaces, workspacePersistence } = createHarness();
    const received = {
      id: "ready-without-path",
      projectId: project.id,
      identifier: "OMB-READY",
      title: "Ready binding",
      titleSource: "user" as const,
      status: "RECEIVED" as const,
      inputs: [],
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    store.transaction((transaction) => transaction.insertIssue(received, "ASSESS"));
    workspacePersistence.recoverBinding({
      issueId: received.id,
      providerId: "local",
      resourceId: `local:${received.id}`,
      status: "READY",
      createdAt: now,
      updatedAt: now,
    });

    await workspaces.recover();

    expect(store.getIssue(received.id)).toMatchObject({ projectPath: project.path });
    expect(store.listPendingOperations()[0]?.operation).toBe("ASSESS");
  });

  it("does not fall back to Local when a persisted provider is unavailable", async () => {
    const { store, workspaces, workspacePersistence } = createHarness();
    const received = {
      id: "missing-provider",
      projectId: project.id,
      identifier: "OMB-MISSING",
      title: "Missing provider",
      titleSource: "user" as const,
      status: "RECEIVED" as const,
      inputs: [],
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    store.transaction((transaction) => transaction.insertIssue(received, "PREPARE"));
    workspacePersistence.beginAcquire({
      issueId: received.id,
      providerId: "missing",
      resourceId: `missing:${received.id}`,
      status: "PREPARING",
      createdAt: now,
      updatedAt: now,
    });

    await workspaces.recover();

    expect(store.listPendingOperations()).toEqual([]);
    expect(workspacePersistence.getBinding(received.id)?.providerId).toBe("missing");
    expect(store.readEvents(received.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "WORKSPACE_RECOVERY_FAILED",
        data: expect.objectContaining({ error: "WORKSPACE_PROVIDER_NOT_AVAILABLE:missing" }),
      }),
    ]));
  });

  it.each([
    ["ASSESSING", "ASSESS"],
    ["REPAIRING", "REPAIR"],
    ["EVIDENCE_CHECK", "EVIDENCE"],
  ] as const)("requeues interrupted %s as %s once", (status, operation) => {
    const { store } = createHarness(new FakeAgent());
    const issue = {
      id: `interrupted-${status}`,
      projectId: project.id,
      projectPath: project.path,
      identifier: `OMB-${status}`,
      title: "Interrupted",
      titleSource: "user" as const,
      status,
      inputs: [],
      agentSession: { agent: "fake", sessionId: "session-1" },
      ...(status === "ASSESSING" ? {} : {
        assessment,
        repair: {
          iteration: 2,
          ...(status === "EVIDENCE_CHECK" ? { delivery } : {}),
        },
      }),
      revision: 3,
      createdAt: now,
      updatedAt: now,
    };
    store.transaction((transaction) => transaction.insertIssue(issue, "ASSESS"));
    store.transaction((transaction) => transaction.updateIssue(issue, issue.revision, null));
    const dependencies = {
      store,
      id: eventIds(`recovery-${status}`),
      now: () => now,
    };
    reconcileInterruptedIssues(dependencies);
    reconcileInterruptedIssues(dependencies);

    expect(store.getIssue(issue.id)).toMatchObject({
      status,
      revision: issue.revision + 1,
      ...(status === "ASSESSING" ? {} : { repair: { iteration: 2 } }),
    });
    expect(store.getIssue(issue.id)).not.toHaveProperty("lastFailure");
    expect(store.listPendingOperations()[0]?.operation).toBe(operation);
    expect(store.readEvents(issue.id).filter((event) => event.type === "RUNTIME_INTERRUPTED"))
      .toHaveLength(1);
  });

  it.each(["ASSESSMENT_REVIEW", "ACCEPTANCE_REVIEW", "COMPLETED", "CLOSED"] as const)(
    "preserves durable %s state while migrating only active legacy workspaces",
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

      if (status === "ASSESSMENT_REVIEW" || status === "ACCEPTANCE_REVIEW") {
        expect(store.getIssue(issue.id)).toMatchObject({
          status,
          projectPath: project.path,
        });
        expect(store.readEvents(issue.id).map((event) => event.type))
          .toEqual(["WORKSPACE_RECOVERED"]);
      } else {
        expect(store.getIssue(issue.id)).toEqual(issue);
        expect(store.readEvents(issue.id)).toEqual([]);
      }
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
