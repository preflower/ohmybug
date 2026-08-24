import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { FinalizationRecoveryResult, Issue } from "@oh-my-bug/core";
import { afterEach, describe, expect, it } from "vitest";

import {
  WorkspaceFinalizationError,
} from "../src/finalization-recovery.js";
import { gitWorkspaceFactory } from "../src/index.js";
import { createGitFixture, git } from "./helpers.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

const recovered: FinalizationRecoveryResult = {
  summary: "Removed generated package-manager cache",
  diagnosis: "An empty nested repository blocked git add",
  disposition: "RECOVERED",
  affectedPaths: [".pnpm-store/shared/v11/tmp/_tmp_fixture"],
};

async function setupRecovery(options: {
  diagnosticPaths?: string[];
  beforePublish?: (worktreePath: string) => Promise<void>;
} = {}) {
  const fixture = await createGitFixture();
  cleanups.push(fixture.cleanup);
  const provider = gitWorkspaceFactory({
    state: fixture.state,
    worktreeRoot: fixture.worktreeRoot,
  }).create({ baseBranch: "main", pushToRemote: false });
  const acquired = await provider.acquire({ issue: fixture.issue, project: fixture.project });
  await writeFile(join(acquired.projectPath, "README.md"), "approved source change\n");
  await git(acquired.projectPath, "branch", "recovery-alternate");
  await options.beforePublish?.(acquired.projectPath);
  const diagnosticRoot = join(
    acquired.projectPath,
    ".pnpm-store/shared/v11/tmp/_tmp_fixture",
  );
  await mkdir(diagnosticRoot, { recursive: true });
  await git(diagnosticRoot, "init", "-b", "main");
  const approved: Issue = {
    ...fixture.issue,
    projectPath: acquired.projectPath,
    status: "FINALIZING",
    resolution: "FIXED",
    finalizationRecovery: { automaticAttempts: 0 },
  };
  const head = await git(acquired.projectPath, "rev-parse", "HEAD");
  const index = await git(acquired.projectPath, "ls-files", "--stage");
  const error = await provider.publish({
    issue: approved,
    resourceId: "git:issue-1",
  }).catch((caught: unknown) => caught);
  if (!(error instanceof WorkspaceFinalizationError)) {
    throw new Error("WORKSPACE_FINALIZATION_ERROR_REQUIRED");
  }
  const context = await provider.prepareFinalizationRecovery?.({
    issue: { ...approved, status: "FINALIZATION_RECOVERY" },
    resourceId: "git:issue-1",
    diagnostic: {
      ...error.diagnostic,
      relatedPaths: options.diagnosticPaths ?? error.diagnostic.relatedPaths,
    },
    attemptId: "recovery-1",
  });
  if (!context) throw new Error("FINALIZATION_RECOVERY_CONTEXT_REQUIRED");
  return {
    ...fixture,
    provider,
    acquired,
    approved,
    diagnosticRoot,
    error,
    context,
    head,
    index,
  };
}

describe("Git finalization recovery", () => {
  it("diagnoses generated pollution without mutating HEAD or the real index", async () => {
    const fixture = await setupRecovery();

    expect(fixture.error.diagnostic).toMatchObject({
      providerId: "git",
      step: "add",
      code: "GIT_GENERATED_ARTIFACTS_PRESENT",
      relatedPaths: [".pnpm-store"],
    });
    expect(fixture.error.diagnostic.stderr).toBeUndefined();
    expect(fixture.context.fingerprintSummary)
      .toContain('generated roots: [".pnpm-store"]');
    expect(await git(fixture.acquired.projectPath, "rev-parse", "HEAD"))
      .toBe(fixture.head);
    expect(await git(fixture.acquired.projectPath, "ls-files", "--stage"))
      .toBe(fixture.index);
  });

  it("validates removal of only the untracked diagnostic root as unchanged", async () => {
    const fixture = await setupRecovery();
    await rm(fixture.diagnosticRoot, { recursive: true });

    await expect(fixture.provider.validateFinalizationRecovery?.({
      issue: { ...fixture.approved, status: "FINALIZATION_RECOVERY" },
      resourceId: "git:issue-1",
      fingerprintRef: fixture.context.fingerprintRef,
      result: recovered,
    })).resolves.toEqual({ kind: "UNCHANGED", changedPaths: [] });
  });

  it("routes an approved tracked-content change through revalidation", async () => {
    const fixture = await setupRecovery();
    await rm(fixture.diagnosticRoot, { recursive: true });
    await writeFile(join(fixture.acquired.projectPath, "README.md"), "AI changed source\n");

    await expect(fixture.provider.validateFinalizationRecovery?.({
      issue: { ...fixture.approved, status: "FINALIZATION_RECOVERY" },
      resourceId: "git:issue-1",
      fingerprintRef: fixture.context.fingerprintRef,
      result: recovered,
    })).resolves.toEqual({ kind: "CHANGED", changedPaths: ["README.md"] });
  });

  it("routes deletion of an intended untracked diagnostic path through revalidation", async () => {
    const fixture = await setupRecovery({
      diagnosticPaths: [
        ".pnpm-store/shared/v11/tmp/_tmp_fixture",
        "approved-untracked.txt",
      ],
      beforePublish: async (worktreePath) => {
        await writeFile(join(worktreePath, "approved-untracked.txt"), "approved\n");
      },
    });
    await rm(fixture.diagnosticRoot, { recursive: true });
    await rm(join(fixture.acquired.projectPath, "approved-untracked.txt"));

    await expect(fixture.provider.validateFinalizationRecovery?.({
      issue: { ...fixture.approved, status: "FINALIZATION_RECOVERY" },
      resourceId: "git:issue-1",
      fingerprintRef: fixture.context.fingerprintRef,
      result: recovered,
    })).resolves.toEqual({ kind: "CHANGED", changedPaths: ["approved-untracked.txt"] });
  });

  it.each([
    ["switch", async (path: string) => git(path, "switch", "recovery-alternate")],
    ["detach", async (path: string) => git(path, "switch", "--detach", "HEAD")],
  ] as const)("rejects a same-commit HEAD %s", async (_name, mutateHead) => {
    const fixture = await setupRecovery();
    await rm(fixture.diagnosticRoot, { recursive: true });
    await mutateHead(fixture.acquired.projectPath);

    await expect(fixture.provider.validateFinalizationRecovery?.({
      issue: { ...fixture.approved, status: "FINALIZATION_RECOVERY" },
      resourceId: "git:issue-1",
      fingerprintRef: fixture.context.fingerprintRef,
      result: recovered,
    })).resolves.toMatchObject({
      kind: "UNSAFE",
      reason: "FINALIZATION_RECOVERY_HEAD_REF_CHANGED",
    });
  });

  it("does not reject an unrelated concurrent branch creation", async () => {
    const fixture = await setupRecovery();
    await rm(fixture.diagnosticRoot, { recursive: true });
    await git(fixture.acquired.projectPath, "branch", "unrelated-concurrent-issue");

    await expect(fixture.provider.validateFinalizationRecovery?.({
      issue: { ...fixture.approved, status: "FINALIZATION_RECOVERY" },
      resourceId: "git:issue-1",
      fingerprintRef: fixture.context.fingerprintRef,
      result: recovered,
    })).resolves.toEqual({ kind: "UNCHANGED", changedPaths: [] });
  });

  it("rejects recovery preparation for a non-add failure", async () => {
    const fixture = await createGitFixture();
    cleanups.push(fixture.cleanup);
    const provider = gitWorkspaceFactory({
      state: fixture.state,
      worktreeRoot: fixture.worktreeRoot,
    }).create({ baseBranch: "main", pushToRemote: false });
    const acquired = await provider.acquire({ issue: fixture.issue, project: fixture.project });

    await expect(provider.prepareFinalizationRecovery?.({
      issue: { ...fixture.issue, projectPath: acquired.projectPath, status: "FINALIZING" },
      resourceId: "git:issue-1",
      diagnostic: {
        providerId: "git",
        step: "commit",
        code: "GIT_COMMAND_FAILED:commit",
        message: "pre-commit hook failed",
        relatedPaths: [],
      },
      attemptId: "recovery-unsupported",
    })).rejects.toThrow("FINALIZATION_RECOVERY_DIAGNOSTIC_UNSUPPORTED");
  });

  it("rejects generated cache content that would otherwise be committed", async () => {
    const fixture = await setupRecovery();
    await rm(fixture.diagnosticRoot, { recursive: true });
    await writeFile(join(fixture.acquired.projectPath, ".pnpm-store/cache.bin"), "cache\n");

    await expect(fixture.provider.validateFinalizationRecovery?.({
      issue: { ...fixture.approved, status: "FINALIZATION_RECOVERY" },
      resourceId: "git:issue-1",
      fingerprintRef: fixture.context.fingerprintRef,
      result: recovered,
    })).resolves.toMatchObject({
      kind: "UNSAFE",
      reason: "FINALIZATION_RECOVERY_GENERATED_ARTIFACT_REMAINS",
      changedPaths: [".pnpm-store/cache.bin"],
    });
  });

  it.each(["index", "new-path", "unresolved-root"] as const)(
    "rejects unsafe %s mutations",
    async (mutation) => {
      const fixture = await setupRecovery();
      if (mutation !== "unresolved-root") {
        await rm(fixture.diagnosticRoot, { recursive: true });
      }
      if (mutation === "index") {
        await git(fixture.acquired.projectPath, "add", "README.md");
      } else if (mutation === "new-path") {
        await writeFile(join(fixture.acquired.projectPath, "unexpected.txt"), "new\n");
      }

      await expect(fixture.provider.validateFinalizationRecovery?.({
        issue: { ...fixture.approved, status: "FINALIZATION_RECOVERY" },
        resourceId: "git:issue-1",
        fingerprintRef: fixture.context.fingerprintRef,
        result: recovered,
      })).resolves.toMatchObject({ kind: "UNSAFE" });
    },
  );
});
