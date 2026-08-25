import { describe, expect, it } from "vitest";

import { OhMyBugRuntime } from "../src/runtime.js";
import { reconcileInterruptedIssues } from "../src/orchestration/recovery.js";
import { delivery, FakeAgent } from "./helpers/fakes.js";
import {
  assessment,
  createHarness,
  eventIds,
  now,
  project,
  reviewedIssue,
} from "./helpers/runtime.js";

describe("Runtime recovery", () => {
  it("keeps a capability request paused across interrupted-issue recovery", () => {
    const { store } = createHarness();
    const paused = reviewedIssue({
      status: "PERMISSION_REQUIRED",
      revision: 8,
      pendingCapabilityRequest: {
        id: "request-1",
        operation: "REPAIR",
        stage: "REPAIR",
        resumeStatus: "REPAIRING",
        capabilities: ["HOST_EXECUTION"],
        reason: "Launch Electron acceptance",
        requestedAt: now,
      },
    });
    store.transaction((transaction) => {
      transaction.insertIssue(paused, "REPAIR");
      transaction.updateIssue(paused, paused.revision, null);
    });

    reconcileInterruptedIssues({ store, id: eventIds("permission"), now: () => now });

    expect(store.getIssue(paused.id)).toEqual(paused);
    expect(store.listPendingOperations()).toEqual([]);
    expect(store.readEvents(paused.id)).toEqual([]);
  });

  it("preserves a pending business review and reconstructs its submitted Repair continuation", () => {
    const { store } = createHarness();
    const reviewRequired = {
      id: "business-review-pending",
      projectId: project.id,
      projectPath: project.path,
      identifier: "OMB-BUSINESS-PENDING",
      title: "Business conflict",
      titleSource: "user" as const,
      status: "REVIEW_REQUIRED" as const,
      inputs: [],
      agentSession: { agent: "fake", sessionId: "session-business" },
      assessment,
      repair: { iteration: 3 },
      review: {
        id: "review-business",
        kind: "business-merge-conflict",
        requestedFrom: "REPAIRING" as const,
        payload: { conflictPaths: ["src/payment.ts"] },
        choices: [{
          id: "keep-base",
          label: "保留基线行为",
          continuation: { operation: "REPAIR" as const, resumeStatus: "REPAIRING" as const },
        }],
        requestedAt: now,
      },
      revision: 9,
      createdAt: now,
      updatedAt: now,
    };
    store.transaction((transaction) => {
      transaction.insertIssue(reviewRequired, "REPAIR");
      transaction.updateIssue(reviewRequired, reviewRequired.revision, null);
    });

    reconcileInterruptedIssues({ store, id: eventIds("pending-review"), now: () => now });

    expect(store.getIssue(reviewRequired.id)).toEqual(reviewRequired);
    expect(store.listPendingOperations()).toEqual([]);

    const resumed = {
      ...reviewRequired,
      id: "business-review-submitted",
      identifier: "OMB-BUSINESS-SUBMITTED",
      status: "REPAIRING" as const,
      review: undefined,
      revision: 10,
    };
    store.transaction((transaction) => {
      transaction.insertIssue(resumed, "REPAIR");
      transaction.updateIssue(resumed, resumed.revision, null);
      transaction.appendEvent({
        id: "business-review-submitted-event",
        issueId: resumed.id,
        type: "REVIEW_SUBMITTED",
        actor: "USER",
        data: {
          requestId: "review-business",
          kind: "business-merge-conflict",
          choiceId: "keep-base",
          operation: "REPAIR",
          revision: resumed.revision,
        },
        occurredAt: now,
      });
    });
    const dependencies = {
      store,
      id: eventIds("submitted-review"),
      now: () => now,
    };

    reconcileInterruptedIssues(dependencies);
    reconcileInterruptedIssues(dependencies);

    expect(store.getIssue(resumed.id)).toEqual(resumed);
    expect(store.listPendingOperations()).toEqual([{
      issue: resumed,
      operation: "REPAIR",
    }]);
    expect(store.readEvents(resumed.id).map((event) => event.type))
      .toEqual(["REVIEW_SUBMITTED"]);
  });

  it("migrates legacy evidence failures once and preserves their delivery as a draft", () => {
    const { store } = createHarness();
    const legacy = {
      id: "legacy-evidence-failure",
      projectId: project.id,
      projectPath: project.path,
      identifier: "OMB-LEGACY-EVIDENCE",
      title: "Legacy evidence failure",
      titleSource: "user" as const,
      status: "REPAIR_FAILED" as const,
      inputs: [],
      agentSession: { agent: "fake", sessionId: "session-1" },
      assessment,
      repair: { iteration: 2, automaticEvidenceRetries: 2, delivery },
      lastFailure: { stage: "REPAIR" as const, code: "EVIDENCE_RETRY_LIMIT_REACHED" },
      revision: 7,
      createdAt: now,
      updatedAt: now,
    };
    store.transaction((transaction) => {
      transaction.insertIssue(legacy, "REPAIR");
      transaction.updateIssue(legacy, legacy.revision, null);
    });
    const dependencies = { store, id: eventIds("migration"), now: () => now };

    reconcileInterruptedIssues(dependencies);
    reconcileInterruptedIssues(dependencies);

    expect(store.getIssue(legacy.id)).toMatchObject({
      status: "EVIDENCE_FAILED",
      repair: {
        iteration: 2,
        evidenceRetries: 2,
        deliveryDraft: {
          summary: delivery.summary,
          repairIteration: 2,
          implementationCompletedAt: now,
        },
      },
      lastFailure: { stage: "EVIDENCE", code: "EVIDENCE_RETRY_LIMIT_REACHED" },
      revision: legacy.revision + 1,
    });
    expect(store.listPendingOperations()).toEqual([]);
    expect(store.readEvents(legacy.id).filter((event) =>
      event.type === "ISSUE_EVIDENCE_STATE_MIGRATED"))
      .toHaveLength(1);
  });

  it("recovers a legacy interrupted Repair failure", () => {
    const { store } = createHarness();
    const legacy = {
      id: "legacy-repair-interrupted",
      projectId: project.id,
      projectPath: project.path,
      identifier: "OMB-LEGACY-REPAIR",
      title: "Legacy interrupted repair",
      titleSource: "user" as const,
      status: "REPAIR_FAILED" as const,
      inputs: [],
      agentSession: { agent: "fake", sessionId: "session-1" },
      assessment,
      repair: { iteration: 2 },
      lastFailure: { stage: "REPAIR" as const, code: "RUNTIME_INTERRUPTED" },
      revision: 4,
      createdAt: now,
      updatedAt: now,
    };
    store.transaction((transaction) => {
      transaction.insertIssue(legacy, "REPAIR");
      transaction.updateIssue(legacy, legacy.revision, null);
    });

    reconcileInterruptedIssues({ store, id: eventIds("legacy-repair"), now: () => now });

    expect(store.getIssue(legacy.id)).toMatchObject({
      status: "REPAIRING",
      repair: { iteration: 2 },
    });
    expect(store.listPendingOperations()[0]?.operation).toBe("REPAIR");
  });

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

  it("queues finalization for a FINALIZING Issue recovered after restart", async () => {
    const { store, workspaces, workspacePersistence } = createHarness();
    const finalizing = {
      id: "finalizing-restart",
      projectId: project.id,
      projectPath: project.path,
      identifier: "OMB-FINALIZING",
      title: "Finalizing",
      titleSource: "user" as const,
      status: "FINALIZING" as const,
      resolution: "FIXED" as const,
      inputs: [],
      assessment,
      repair: { iteration: 1 },
      revision: 7,
      createdAt: now,
      updatedAt: now,
    };
    store.transaction((transaction) => transaction.insertIssue(finalizing, "FINALIZE"));
    store.transaction((transaction) => transaction.updateIssue(
      finalizing,
      finalizing.revision,
      null,
    ));

    await workspaces.recover();

    expect(store.listPendingOperations()).toEqual([
      { issue: expect.objectContaining({ id: finalizing.id }), operation: "FINALIZE" },
    ]);
    expect(workspacePersistence.getBinding(finalizing.id)?.providerId).toBe("local");
  });

  it("requeues one in-progress finalization recovery without spending another attempt", () => {
    const { store } = createHarness();
    const recovering = reviewedIssue({
      id: "finalization-recovery-restart",
      status: "FINALIZATION_RECOVERY",
      projectPath: project.path,
      agentSession: { agent: "fake", sessionId: "session-recovery" },
      finalizationRecovery: {
        automaticAttempts: 1,
        attemptId: "attempt-1",
        fingerprintRef: "fingerprint-1",
        diagnostic: {
          providerId: "git",
          step: "add",
          code: "GIT_ADD_FAILED",
          message: "git add failed",
          relatedPaths: [".pnpm-store"],
        },
      },
    });
    store.transaction((transaction) => {
      transaction.insertIssue(recovering, "RECOVER_FINALIZATION");
      transaction.updateIssue(recovering, recovering.revision, null);
    });
    const dependencies = { store, id: eventIds("recovery-restart"), now: () => now };

    reconcileInterruptedIssues(dependencies);
    reconcileInterruptedIssues(dependencies);

    expect(store.getIssue(recovering.id)).toMatchObject({
      status: "FINALIZATION_RECOVERY",
      finalizationRecovery: {
        automaticAttempts: 1,
        attemptId: "attempt-1",
        fingerprintRef: "fingerprint-1",
      },
    });
    expect(store.listPendingOperations().map((pending) => pending.operation))
      .toEqual(["RECOVER_FINALIZATION"]);
    expect(store.readEvents(recovering.id).filter((event) =>
      event.type === "RUNTIME_INTERRUPTED")).toHaveLength(1);
  });

  it("leaves FINALIZATION_FAILED idle after restart", async () => {
    const { store, workspaces, workspacePersistence } = createHarness();
    const failed = {
      id: "finalization-failed-restart",
      projectId: project.id,
      projectPath: project.path,
      identifier: "OMB-FINALIZATION-FAILED",
      title: "Finalization failed",
      titleSource: "user" as const,
      status: "FINALIZATION_FAILED" as const,
      resolution: "FIXED" as const,
      inputs: [],
      assessment,
      repair: { iteration: 1 },
      revision: 8,
      createdAt: now,
      updatedAt: now,
    };
    store.transaction((transaction) => {
      transaction.insertIssue(failed, "FINALIZE");
      transaction.updateIssue(failed, failed.revision, null);
    });

    await workspaces.recover();

    expect(store.listPendingOperations()).toEqual([]);
    expect(workspacePersistence.getBinding(failed.id)?.providerId).toBe("local");
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
    ["EVIDENCE_CAPTURE", "CAPTURE_EVIDENCE"],
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
          ...(status === "EVIDENCE_CAPTURE" ? {
            deliveryDraft: {
              summary: "Implemented",
              repairIteration: 2,
              implementationCompletedAt: now,
            },
          } : {}),
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

  it.each(["REVIEW_REQUIRED", "COMPLETED", "CLOSED"] as const)(
    "preserves durable %s state while recovering only active workspaces",
    async (status) => {
      const agent = new FakeAgent();
      const { commands, store, agents, evidence, workspaces } = createHarness(agent);
      const stable = {
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
      const issue = status === "REVIEW_REQUIRED"
        ? reviewedIssue({ ...stable, status, assessment, revision: 3 })
        : stable;
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

      if (status === "REVIEW_REQUIRED") {
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
    expect(store.getIssue("slow-pending-assess")?.status).toBe("REVIEW_REQUIRED");
  });
});
