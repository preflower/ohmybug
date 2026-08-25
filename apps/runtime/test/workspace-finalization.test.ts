import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { gitWorkspaceFactory } from "@oh-my-bug/workspace-git";
import { describe, expect, it } from "vitest";

import { RuntimeWorker } from "../src/orchestration/worker.js";
import { OhMyBugRuntime } from "../src/runtime.js";
import { FakeAgent } from "./helpers/fakes.js";
import { assessment, createHarness, eventIds, now, project } from "./helpers/runtime.js";

const execFileAsync = promisify(execFile);

describe("Workspace finalization", () => {
  it("returns FINALIZING before background publication settles", async () => {
    const fixture = createHarness();
    let releasePublish!: () => void;
    const publishing = new Promise<void>((resolve) => { releasePublish = resolve; });
    fixture.workspaceRegistry.register({
      id: "deferred",
      manifest: { id: "deferred", name: "Deferred", configFields: [] },
      validate() {},
      create() {
        return {
          id: "deferred",
          async acquire({ issue, project: runtimeProject }) {
            return {
              projectPath: runtimeProject.path,
              resourceId: `deferred:${issue.id}`,
            };
          },
          async publish() {
            await publishing;
            return {
              kind: "PUBLISHED" as const,
              branch: { name: "ohmybug/omb-1", commit: "abc123" },
            };
          },
          async release() {},
        };
      },
    });
    fixture.workspacePersistence.setProjectConfiguration(project.id, {
      provider: "deferred",
      config: {},
    });
    const runtime = new OhMyBugRuntime({
      commands: fixture.commands,
      store: fixture.store,
      agents: fixture.agents,
      evidence: fixture.evidence,
      workspaces: fixture.workspaces,
      hooks: fixture.hooks,
      id: eventIds("async-finalize"),
      now: () => "2026-08-24T10:00:00.000Z",
    });
    await runtime.start();
    const created = await fixture.commands.submitManual(project.id, {
      commandId: "async-finalize",
      content: "Checkout fails",
    });
    if (created.kind !== "CREATED") throw new Error("CREATED_REQUIRED");
    await runtime.drain();
    fixture.commands.approveAssessment(created.issue.id, {
      assessmentRevision: assessment.revision,
      assessmentContentHash: assessment.contentHash,
      title: assessment.suggestedTitle,
    });
    await runtime.drain();
    const ready = fixture.store.getIssue(created.issue.id)!;
    expect(ready.status).toBe("REVIEW_REQUIRED");

    const approval = runtime.approveDelivery(ready.id);
    runtime.kick();
    let accepted: Awaited<typeof approval> | undefined;
    void approval.then((value) => { accepted = value; });
    await Promise.resolve();
    try {
      expect(accepted).toEqual({
        issue: expect.objectContaining({ status: "FINALIZING" }),
      });
      expect(fixture.store.getIssue(ready.id)?.status).toBe("FINALIZING");
    } finally {
      releasePublish();
    }
    await approval;
    await runtime.drain();
    expect(fixture.store.getIssue(ready.id)?.status).toBe("COMPLETED");
  });

  it("completes LocalWorkspace only after durable user approval", async () => {
    const agent = new FakeAgent();
    const {
      commands,
      store,
      agents,
      evidence,
      workspacePersistence,
      workspaces,
      hooks,
    } = createHarness(agent);
    const completedHooks: string[] = [];
    hooks.on("observer", "issue.completed", ({ issue }) => completedHooks.push(issue.status));
    const worker = new RuntimeWorker({
      store,
      agents,
      evidence,
      workspaces,
      hooks,
      id: eventIds("finalize"),
      now: () => "2026-08-20T15:01:00.000Z",
    });
    const created = await commands.submitManual(project.id, {
      commandId: "finalize-local",
      content: "Checkout fails",
    });
    if (created.kind !== "CREATED") throw new Error("CREATED_REQUIRED");
    await worker.drain();
    const assessed = store.getIssue(created.issue.id)!;
    commands.approveAssessment(assessed.id, {
      assessmentRevision: assessment.revision,
      assessmentContentHash: assessment.contentHash,
      title: assessment.suggestedTitle,
    });
    await worker.drain();

    const approved = commands.approveDelivery(assessed.id);
    expect(approved.status).toBe("FINALIZING");
    expect(store.listPendingOperations()).toEqual([
      { issue: approved, operation: "FINALIZE" },
    ]);
    await worker.drainOne();

    expect(store.getIssue(assessed.id)).toMatchObject({
      status: "COMPLETED",
      resolution: "FIXED",
    });
    expect(workspacePersistence.getBinding(assessed.id)).toMatchObject({ status: "RELEASED" });
    expect(completedHooks).toEqual(["COMPLETED"]);
    expect(store.readEvents(assessed.id).map((event) => event.type)).toContain("ISSUE_COMPLETED");
  });

  it("returns a stale accepted base to the same Agent for a new Repair iteration", async () => {
    const agent = new FakeAgent();
    const fixture = createHarness(agent);
    let releases = 0;
    fixture.workspaceRegistry.register({
      id: "stale-base",
      manifest: { id: "stale-base", name: "Stale base", configFields: [] },
      validate() {},
      create() {
        return {
          id: "stale-base",
          async acquire({ issue, project: runtimeProject }) {
            return {
              projectPath: runtimeProject.path,
              resourceId: `stale-base:${issue.id}`,
            };
          },
          async publish() {
            return {
              kind: "BASE_STALE" as const,
              currentBaseCommit: "c".repeat(40),
            };
          },
          async release() { releases += 1; },
        };
      },
    });
    fixture.workspacePersistence.setProjectConfiguration(project.id, {
      provider: "stale-base",
      config: {},
    });
    const worker = new RuntimeWorker({
      store: fixture.store,
      agents: fixture.agents,
      evidence: fixture.evidence,
      workspaces: fixture.workspaces,
      hooks: fixture.hooks,
      id: eventIds("stale-base"),
      now: () => now,
    });
    const created = await fixture.commands.submitManual(project.id, {
      commandId: "stale-base",
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
    const accepted = fixture.commands.approveDelivery(created.issue.id);
    const originalSession = accepted.agentSession;

    await worker.drainOne();

    const stale = fixture.store.getIssue(created.issue.id)!;
    expect(stale).toMatchObject({
      status: "REPAIRING",
      agentSession: originalSession,
      repair: {
        iteration: 2,
        feedback: expect.stringContaining("c".repeat(40)),
      },
    });
    expect(stale.repair).not.toHaveProperty("delivery");
    expect(stale.repair).not.toHaveProperty("deliveryDraft");
    expect(stale).not.toHaveProperty("resolution");
    expect(stale).not.toHaveProperty("lastFailure");
    expect(fixture.store.listPendingOperations()).toEqual([{
      issue: stale,
      operation: "REPAIR",
    }]);
    expect(fixture.store.readEvents(stale.id)).toContainEqual(expect.objectContaining({
      type: "BASE_INTEGRATION_STALE",
      data: expect.objectContaining({ currentBaseCommit: "c".repeat(40) }),
    }));
    expect(releases).toBe(0);
  });

  it("routes a failed publication retry through fresh Repair validation", async () => {
    const agent = new FakeAgent();
    const {
      commands,
      store,
      agents,
      evidence,
      workspacePersistence,
      workspaceRegistry,
      workspaces,
      hooks,
    } = createHarness(agent);
    let publishAttempts = 0;
    let releases = 0;
    workspaceRegistry.register({
      id: "flaky",
      manifest: { id: "flaky", name: "Flaky", configFields: [] },
      validate() {},
      create() {
        return {
          id: "flaky",
          async acquire({ issue, project: runtimeProject }) {
            return {
              projectPath: runtimeProject.path,
              resourceId: `flaky:${issue.id}`,
            };
          },
          async publish() {
            publishAttempts += 1;
            if (publishAttempts === 1) throw new Error("PIPELINE_UNAVAILABLE");
            return {
              kind: "PUBLISHED" as const,
              branch: { name: "ohmybug/omb-1", commit: "abc123" },
            };
          },
          async release() { releases += 1; },
        };
      },
    });
    workspacePersistence.setProjectConfiguration(project.id, {
      provider: "flaky",
      config: {},
    });
    const worker = new RuntimeWorker({
      store,
      agents,
      evidence,
      workspaces,
      hooks,
      id: eventIds("retry-finalize"),
      now: () => "2026-08-20T15:02:00.000Z",
    });
    const created = await commands.submitManual(project.id, {
      commandId: "finalize-retry",
      content: "Checkout fails",
    });
    if (created.kind !== "CREATED") throw new Error("CREATED_REQUIRED");
    await worker.drain();
    commands.approveAssessment(created.issue.id, {
      assessmentRevision: assessment.revision,
      assessmentContentHash: assessment.contentHash,
      title: assessment.suggestedTitle,
    });
    await worker.drain();

    const runtime = new OhMyBugRuntime({
      commands,
      store,
      agents,
      evidence,
      workspaces,
      hooks,
      id: eventIds("approval-result"),
      now: () => "2026-08-20T15:02:00.000Z",
    });
    const failed = await runtime.approveDelivery(created.issue.id);

    expect(failed).toEqual({
      issue: expect.objectContaining({ status: "FINALIZING" }),
    });
    await runtime.drain();
    expect(store.getIssue(created.issue.id)?.status).toBe("FINALIZATION_FAILED");
    expect(store.listPendingOperations()).toEqual([]);
    expect(workspacePersistence.getBinding(created.issue.id)?.status).toBe("READY");
    expect(store.readEvents(created.issue.id).map((event) => event.type))
      .toContain("WORKSPACE_PUBLISH_FAILED");

    const published = await runtime.approveDelivery(created.issue.id);

    expect(published).toEqual({
      issue: expect.objectContaining({
        status: "REPAIRING",
        repair: { iteration: 2, feedback: expect.any(String) },
      }),
    });
    expect(store.listPendingOperations().map(({ operation }) => operation)).toEqual(["REPAIR"]);
    expect(workspacePersistence.getBinding(created.issue.id)?.status).toBe("READY");
    expect(publishAttempts).toBe(1);
    expect(releases).toBe(0);
  });

  it("does not open automatic finalization recovery for a new publication error", async () => {
    const fixture = createHarness();
    const diagnostic = {
      providerId: "recoverable",
      step: "add" as const,
      code: "GIT_COMMAND_FAILED:add",
      exitCode: 128,
      message: "Git could not add a generated directory",
      stderr: "fatal: adding files failed",
      relatedPaths: [".pnpm-store/shared/v11/tmp/_tmp_fixture"],
    };
    let publishAttempts = 0;
    let recoveryPreparations = 0;
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
            publishAttempts += 1;
            throw Object.assign(new Error(diagnostic.code), { diagnostic });
          },
          async prepareFinalizationRecovery() {
            recoveryPreparations += 1;
            return {
              fingerprintRef: "fingerprint-1",
              workspaceStatus: "?? .pnpm-store/shared/v11/tmp/_tmp_fixture/",
              fingerprintSummary: "1 diagnostic root",
              recoveryKind: "GENERATED_ARTIFACT_CLEANUP" as const,
            };
          },
          async validateFinalizationRecovery() {
            return { kind: "UNCHANGED" as const, changedPaths: [] };
          },
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
      id: eventIds("finalization-recovery"),
      now: () => now,
    });
    const created = await fixture.commands.submitManual(project.id, {
      commandId: "finalization-recovery",
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

    const failed = fixture.store.getIssue(created.issue.id)!;
    expect(failed).toMatchObject({
      status: "FINALIZATION_FAILED",
      lastFailure: {
        stage: "FINALIZATION_RECOVERY",
        code: "GIT_COMMAND_FAILED:add",
      },
    });
    expect(failed).not.toHaveProperty("finalizationRecovery");
    expect(fixture.store.listPendingOperations()).toEqual([]);
    expect(publishAttempts).toBe(1);
    expect(recoveryPreparations).toBe(0);
    expect(fixture.store.readEvents(failed.id).map((event) => event.type))
      .not.toContain("DELIVERY_FINALIZATION_RECOVERY_STARTED");
  });

  it("does not release or discard an uncommitted Git worktree on cancellation", async () => {
    const root = await mkdtemp(join(tmpdir(), "ohmybug-cancel-"));
    try {
      const repository = join(root, "repository");
      await mkdir(repository);
      await git(repository, "init", "-b", "main");
      await git(repository, "config", "user.email", "tests@example.com");
      await git(repository, "config", "user.name", "OhMyBug Tests");
      await writeFile(join(repository, "README.md"), "baseline\n");
      await git(repository, "add", "README.md");
      await git(repository, "commit", "-m", "baseline");

      const {
        commands,
        store,
        agents,
        evidence,
        workspacePersistence,
        workspaceRegistry,
        workspaces,
        hooks,
      } = createHarness();
      workspaceRegistry.register(gitWorkspaceFactory({
        state: workspacePersistence,
        worktreeRoot: join(root, "worktrees"),
      }));
      const gitProject = {
        ...project,
        id: "git-project",
        key: "GIT",
        path: repository,
      };
      commands.registerProject(gitProject);
      workspacePersistence.setProjectConfiguration(gitProject.id, {
        provider: "git",
        config: { baseBranch: "main", delivery: "local" },
      });
      const worker = new RuntimeWorker({
        store,
        agents,
        evidence,
        workspaces,
        hooks,
        id: eventIds("cancel-git"),
        now: () => "2026-08-20T15:03:00.000Z",
      });
      const created = await commands.submitManual(gitProject.id, {
        commandId: "cancel-git",
        content: "Checkout fails",
      });
      if (created.kind !== "CREATED") throw new Error("CREATED_REQUIRED");
      await worker.drainOne();
      const prepared = store.getIssue(created.issue.id)!;
      if (!prepared.projectPath) throw new Error("PROJECT_PATH_REQUIRED");
      await writeFile(join(prepared.projectPath, "uncommitted.txt"), "keep me\n");

      await commands.cancelIssue(prepared.id);

      expect(store.getIssue(prepared.id)?.status).toBe("CANCELED");
      expect(workspacePersistence.getBinding(prepared.id)?.status).toBe("READY");
      expect(await git(prepared.projectPath, "status", "--porcelain"))
        .toContain("?? uncommitted.txt");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, { cwd, encoding: "utf8" });
  return result.stdout.trim();
}
