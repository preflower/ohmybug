import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { gitWorkspaceFactory } from "@oh-my-bug/workspace-git";
import { describe, expect, it } from "vitest";

import { RuntimeWorker } from "../src/orchestration/worker.js";
import { FakeAgent } from "./helpers/fakes.js";
import { assessment, createHarness, eventIds, project } from "./helpers/runtime.js";

const execFileAsync = promisify(execFile);

describe("Workspace finalization", () => {
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
    expect(approved.status).toBe("APPROVED");
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

  it("keeps an approved issue retryable when publishing fails", async () => {
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
            return { name: "ohmybug/omb-1", commit: "abc123" };
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

    commands.approveDelivery(created.issue.id);
    await worker.drainOne();

    expect(store.getIssue(created.issue.id)?.status).toBe("APPROVED");
    expect(store.listPendingOperations()).toEqual([]);
    expect(workspacePersistence.getBinding(created.issue.id)?.status).toBe("READY");
    expect(store.readEvents(created.issue.id).map((event) => event.type))
      .toContain("WORKSPACE_PUBLISH_FAILED");

    const retrying = commands.approveDelivery(created.issue.id);
    expect(retrying.status).toBe("APPROVED");
    expect(store.listPendingOperations()).toEqual([
      { issue: retrying, operation: "FINALIZE" },
    ]);
    await worker.drainOne();

    expect(store.getIssue(created.issue.id)?.status).toBe("COMPLETED");
    expect(workspacePersistence.getBinding(created.issue.id)?.status).toBe("RELEASED");
    expect(publishAttempts).toBe(2);
    expect(releases).toBe(1);
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
