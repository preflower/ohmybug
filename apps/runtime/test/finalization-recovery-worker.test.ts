import {
  AgentCapabilityRequiredError,
  type AgentAdapter,
  type FinalizationRecoveryResult,
} from "@oh-my-bug/core";
import type { WorkspaceFinalizationRecoveryValidation } from "@oh-my-bug/module-api";
import { describe, expect, it } from "vitest";

import { RuntimeWorker } from "../src/orchestration/worker.js";
import { FakeAgent } from "./helpers/fakes.js";
import { assessment, createHarness, eventIds, now, project } from "./helpers/runtime.js";

const recoveredResult: FinalizationRecoveryResult = {
  summary: "Removed generated package-manager pollution",
  diagnosis: "An untracked nested repository blocked Git staging",
  disposition: "RECOVERED",
  affectedPaths: [".pnpm-store/shared/v11/tmp/_tmp_fixture"],
};

describe("finalization recovery worker", () => {
  it.each([
    {
      validation: { kind: "UNCHANGED" as const, changedPaths: [] as string[] },
      status: "FINALIZING",
      operation: "FINALIZE",
      event: "DELIVERY_FINALIZATION_AUTO_RETRIED",
    },
    {
      validation: { kind: "CHANGED" as const, changedPaths: ["src/checkout.ts"] },
      status: "EVIDENCE_CAPTURE",
      operation: "CAPTURE_EVIDENCE",
      event: "DELIVERY_FINALIZATION_REVALIDATION_REQUIRED",
    },
    {
      validation: {
        kind: "UNSAFE" as const,
        changedPaths: [".git/index"],
        reason: "FINALIZATION_RECOVERY_INDEX_CHANGED",
      },
      status: "FINALIZATION_FAILED",
      operation: undefined,
      event: "DELIVERY_FINALIZATION_RECOVERY_FAILED",
    },
  ])("maps provider $validation.kind validation to $status", async ({
    validation,
    status,
    operation,
    event,
  }) => {
    const setup = await recoveryHarness(validation);

    await setup.worker.drainOne();

    const current = setup.fixture.store.getIssue(setup.issueId)!;
    expect(current.status).toBe(status);
    expect(setup.fixture.store.listPendingOperations().map((pending) => pending.operation))
      .toEqual(operation ? [operation] : []);
    expect(setup.fixture.store.readEvents(setup.issueId).map((entry) => entry.type))
      .toContain(event);
    if (validation.kind === "CHANGED") {
      expect(current.repair).toMatchObject({
        iteration: 2,
        deliveryDraft: { summary: recoveredResult.summary, repairIteration: 2 },
      });
    }
    expect(setup.recoveryInputs).toEqual([
      expect.objectContaining({
        workspaceStatus: "?? .pnpm-store/shared/v11/tmp/_tmp_fixture/",
        fingerprintSummary: "1 diagnostic root",
        diagnostic: expect.objectContaining({ code: "GIT_COMMAND_FAILED:add" }),
      }),
    ]);
  });

  it("stops safely when the Agent recovery turn throws", async () => {
    const setup = await recoveryHarness(
      { kind: "UNCHANGED", changedPaths: [] },
      async () => { throw new Error("provider token=private-secret"); },
    );

    await setup.worker.drainOne();

    expect(setup.fixture.store.getIssue(setup.issueId)).toMatchObject({
      status: "FINALIZATION_FAILED",
      lastFailure: { stage: "FINALIZATION_RECOVERY" },
    });
    expect(setup.fixture.store.listPendingOperations()).toEqual([]);
    const failed = setup.fixture.store.readEvents(setup.issueId)
      .findLast((event) => event.type === "DELIVERY_FINALIZATION_RECOVERY_FAILED");
    expect(JSON.stringify(failed)).not.toContain("private-secret");
  });

  it("pauses and resumes the same recovery operation for a capability request", async () => {
    let calls = 0;
    const setup = await recoveryHarness(
      { kind: "UNCHANGED", changedPaths: [] },
      async () => {
        calls += 1;
        if (calls === 1) {
          throw new AgentCapabilityRequiredError({
            capabilities: ["HOST_EXECUTION"],
            reason: "Inspect a host-owned lock file",
          });
        }
        return recoveredResult;
      },
    );
    const attemptId = setup.fixture.store.getIssue(setup.issueId)!
      .finalizationRecovery!.attemptId;

    await setup.worker.drainOne();

    const paused = setup.fixture.store.getIssue(setup.issueId)!;
    expect(paused).toMatchObject({
      status: "PERMISSION_REQUIRED",
      pendingCapabilityRequest: {
        operation: "RECOVER_FINALIZATION",
        stage: "FINALIZATION_RECOVERY",
        resumeStatus: "FINALIZATION_RECOVERY",
      },
      finalizationRecovery: { attemptId, automaticAttempts: 1 },
    });
    setup.fixture.commands.grantIssueCapabilities(
      paused.id,
      paused.revision,
      paused.pendingCapabilityRequest!.id,
    );
    const resumed = setup.fixture.store.getIssue(setup.issueId)!;
    expect(resumed).toMatchObject({
      status: "FINALIZATION_RECOVERY",
      finalizationRecovery: { attemptId, automaticAttempts: 1 },
    });
    expect(setup.fixture.store.listPendingOperations().map((pending) => pending.operation))
      .toEqual(["RECOVER_FINALIZATION"]);

    await setup.worker.drainOne();
    expect(setup.fixture.store.getIssue(setup.issueId)?.status).toBe("FINALIZING");
    expect(setup.recoveryInputs.at(-1)?.continuation).toMatchObject({
      reason: "CAPABILITY_GRANTED",
      capabilities: ["HOST_EXECUTION"],
    });
  });
});

async function recoveryHarness(
  validation: WorkspaceFinalizationRecoveryValidation,
  recover: NonNullable<AgentAdapter["recoverFinalization"]> = async () => recoveredResult,
) {
  const recoveryInputs: Parameters<NonNullable<AgentAdapter["recoverFinalization"]>>[1][] = [];
  const recoverFinalization: NonNullable<AgentAdapter["recoverFinalization"]> = async (
    session,
    input,
  ) => {
    recoveryInputs.push(input);
    return recover(session, input);
  };
  const agent: AgentAdapter = Object.assign(new FakeAgent(), { recoverFinalization });
  const fixture = createHarness(agent);
  const diagnostic = {
    providerId: "recoverable",
    step: "add" as const,
    code: "GIT_COMMAND_FAILED:add",
    exitCode: 128,
    message: "Git could not add a generated directory",
    relatedPaths: [".pnpm-store/shared/v11/tmp/_tmp_fixture"],
  };
  fixture.workspaceRegistry.register({
    id: "recoverable",
    manifest: { id: "recoverable", name: "Recoverable", configFields: [] },
    validate() {},
    create() {
      return {
        id: "recoverable",
        async acquire({ issue, project: runtimeProject }) {
          return {
            projectPath: runtimeProject.path,
            resourceId: `recoverable:${issue.id}`,
          };
        },
        async publish() {
          throw Object.assign(new Error(diagnostic.code), { diagnostic });
        },
        async prepareFinalizationRecovery() {
          return {
            fingerprintRef: "fingerprint-1",
            workspaceStatus: "?? .pnpm-store/shared/v11/tmp/_tmp_fixture/",
            fingerprintSummary: "1 diagnostic root",
          };
        },
        async validateFinalizationRecovery() { return validation; },
        async release() {},
      };
    },
  });
  fixture.workspacePersistence.setProjectConfiguration(project.id, {
    provider: "recoverable",
    config: {},
  });
  const worker = new RuntimeWorker({
    store: fixture.store,
    agents: fixture.agents,
    evidence: fixture.evidence,
    workspaces: fixture.workspaces,
    hooks: fixture.hooks,
    id: eventIds("worker-recovery"),
    now: () => now,
  });
  const created = await fixture.commands.submitManual(project.id, {
    commandId: "worker-recovery",
    content: "Checkout fails",
  });
  if (created.kind !== "CREATED") throw new Error("CREATED_REQUIRED");
  await worker.drain();
  fixture.commands.approveAssessment(created.issue.id, {
    assessmentRevision: assessment.revision,
    assessmentContentHash: assessment.contentHash,
    title: assessment.suggestedTitle,
  });
  await worker.drain();
  fixture.commands.approveDelivery(created.issue.id);
  await worker.drainOne();
  expect(fixture.store.getIssue(created.issue.id)?.status).toBe("FINALIZATION_RECOVERY");
  return { fixture, issueId: created.issue.id, worker, recoveryInputs };
}
