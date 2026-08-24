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

async function setupRecovery() {
  const fixture = await createGitFixture();
  cleanups.push(fixture.cleanup);
  const provider = gitWorkspaceFactory({
    state: fixture.state,
    worktreeRoot: fixture.worktreeRoot,
  }).create({ baseBranch: "main", pushToRemote: false });
  const acquired = await provider.acquire({ issue: fixture.issue, project: fixture.project });
  await writeFile(join(acquired.projectPath, "README.md"), "approved source change\n");
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
    diagnostic: error.diagnostic,
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
  it("diagnoses an empty nested repository without mutating HEAD or the real index", async () => {
    const fixture = await setupRecovery();

    expect(fixture.error.diagnostic).toMatchObject({
      providerId: "git",
      step: "add",
      code: "GIT_COMMAND_FAILED:add",
      exitCode: 128,
      relatedPaths: [".pnpm-store/shared/v11/tmp/_tmp_fixture"],
    });
    expect(fixture.error.diagnostic.stderr?.length).toBeLessThanOrEqual(8_000);
    expect(fixture.error.diagnostic.stderr).not.toContain(fixture.acquired.projectPath);
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
