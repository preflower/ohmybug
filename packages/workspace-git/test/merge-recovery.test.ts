import { describe, expect, it } from "vitest";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { WorkspaceFinalizationError } from "../src/finalization-recovery.js";
import { gitWorkspaceFactory } from "../src/provider.js";
import { parseMergeTreeConflictOutput } from "../src/merge-recovery.js";
import { createGitFixture, git } from "./helpers.js";

describe("Git merge recovery diagnostics", () => {
  it("extracts bounded repository-relative conflict paths", () => {
    const parsed = parseMergeTreeConflictOutput([
      "deadbeef",
      "Auto-merging src/feature.ts",
      "CONFLICT (content): Merge conflict in src/feature.ts",
      "Auto-merging src/file with spaces.ts",
      "CONFLICT (content): Merge conflict in src/file with spaces.ts",
      "CONFLICT (content): Merge conflict in /private/secret.ts",
      "CONFLICT (content): Merge conflict in ../outside.ts",
    ].join("\n"), "");

    expect(parsed.conflictPaths).toEqual([
      "src/feature.ts",
      "src/file with spaces.ts",
    ]);
    expect(parsed.mergeMessages).toHaveLength(6);
    expect(parsed.mergeMessages.every((message) => message.length <= 1_000)).toBe(true);
  });

  it("deduplicates and bounds paths and messages", () => {
    const output = Array.from({ length: 70 }, (_, index) =>
      `CONFLICT (content): Merge conflict in src/${index}.ts`).join("\n");

    const parsed = parseMergeTreeConflictOutput(output, output);

    expect(parsed.conflictPaths).toHaveLength(50);
    expect(parsed.mergeMessages).toHaveLength(20);
  });

  it("prepares an idempotent provider-owned conflict in the Issue Worktree", async () => {
    const fixture = await createGitFixture();
    try {
      const provider = gitWorkspaceFactory({
        state: fixture.state,
        worktreeRoot: fixture.worktreeRoot,
      }).create({ baseBranch: "main", pushToRemote: false, mergeToBaseBranch: true });
      const acquired = await provider.acquire({ issue: fixture.issue, project: fixture.project });
      await writeFile(join(acquired.projectPath, "README.md"), "issue change\n");
      await writeFile(join(fixture.repository, "README.md"), "base change\n");
      await git(fixture.repository, "add", "README.md");
      await git(fixture.repository, "commit", "-m", "advance base");
      const baseCommit = await git(fixture.repository, "rev-parse", "main");
      const approved = {
        ...fixture.issue,
        projectPath: acquired.projectPath,
        status: "FINALIZING" as const,
        resolution: "FIXED" as const,
      };
      let failure: WorkspaceFinalizationError;
      try {
        await provider.publish({ issue: approved, resourceId: "git:issue-1" });
        throw new Error("EXPECTED_MERGE_CONFLICT");
      } catch (error) {
        if (!(error instanceof WorkspaceFinalizationError)) throw error;
        failure = error;
      }
      const issueCommit = await git(acquired.projectPath, "rev-parse", "HEAD");

      const context = await provider.prepareFinalizationRecovery?.({
        issue: approved,
        resourceId: "git:issue-1",
        diagnostic: failure.diagnostic,
        attemptId: "recovery-21",
      });

      expect(context).toMatchObject({
        recoveryKind: "MERGE_CONFLICT",
        merge: {
          kind: "MERGE_CONFLICT",
          baseBranch: "main",
          baseCommit,
          issueBranch: "ohmybug/omb-1",
          issueCommit,
          conflictPaths: ["README.md"],
          mergePrepared: true,
        },
      });
      expect(await git(acquired.projectPath, "rev-parse", "HEAD")).toBe(issueCommit);
      expect(await git(acquired.projectPath, "rev-parse", "MERGE_HEAD")).toBe(baseCommit);
      expect(await git(fixture.repository, "status", "--porcelain")).toBe("");
      expect(await provider.prepareFinalizationRecovery?.({
        issue: approved,
        resourceId: "git:issue-1",
        diagnostic: failure.diagnostic,
        attemptId: "recovery-21",
      })).toEqual(context);
    } finally {
      await fixture.cleanup();
    }
  });

  it("gives unknown merge failures an inspection-only Agent context", async () => {
    const fixture = await createGitFixture();
    try {
      const provider = gitWorkspaceFactory({
        state: fixture.state,
        worktreeRoot: fixture.worktreeRoot,
      }).create({ baseBranch: "main", pushToRemote: false, mergeToBaseBranch: true });
      await provider.acquire({ issue: fixture.issue, project: fixture.project });

      await expect(provider.prepareFinalizationRecovery?.({
        issue: { ...fixture.issue, status: "FINALIZING" },
        resourceId: "git:issue-1",
        diagnostic: {
          providerId: "git",
          step: "merge",
          code: "GIT_AUTO_MERGE_BASE_DIRTY",
          message: "The base checkout is dirty",
          relatedPaths: [],
        },
        attemptId: "recovery-env",
      })).resolves.toMatchObject({
        recoveryKind: "MERGE_ENVIRONMENT",
        merge: {
          kind: "MERGE_ENVIRONMENT",
          baseBranch: "main",
          mergePrepared: false,
        },
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("validates a resolved merge through a temporary index without staging the real index", async () => {
    const prepared = await createPreparedConflict();
    try {
      const indexBefore = await git(prepared.acquired.projectPath, "ls-files", "--stage", "-z");
      await writeFile(join(prepared.acquired.projectPath, "README.md"), "combined behavior\n");

      await expect(prepared.provider.validateFinalizationRecovery?.({
        issue: prepared.approved,
        resourceId: "git:issue-1",
        fingerprintRef: prepared.context.fingerprintRef,
        result: {
          summary: "Preserved the base behavior and Issue intent",
          diagnosis: "Both branches changed README.md",
          disposition: "RECOVERED",
          affectedPaths: ["README.md"],
        },
      })).resolves.toEqual({ kind: "CHANGED", changedPaths: ["README.md"] });
      expect(await git(prepared.acquired.projectPath, "ls-files", "--stage", "-z"))
        .toBe(indexBefore);
    } finally {
      await prepared.cleanup();
    }
  });

  it("rejects unresolved conflict markers", async () => {
    const prepared = await createPreparedConflict();
    try {
      await expect(prepared.provider.validateFinalizationRecovery?.({
        issue: prepared.approved,
        resourceId: "git:issue-1",
        fingerprintRef: prepared.context.fingerprintRef,
        result: {
          summary: "Could not resolve the conflict",
          diagnosis: "README.md remains conflicted",
          disposition: "UNSAFE",
          affectedPaths: ["README.md"],
        },
      })).resolves.toMatchObject({
        kind: "UNSAFE",
        reason: "GIT_MERGE_RECOVERY_CONFLICT_MARKERS",
      });
    } finally {
      await prepared.cleanup();
    }
  });

  it("rejects a resolved tree changed after deterministic validation", async () => {
    const prepared = await createPreparedConflict();
    try {
      await writeFile(join(prepared.acquired.projectPath, "README.md"), "combined behavior\n");
      await prepared.provider.validateFinalizationRecovery!({
        issue: prepared.approved,
        resourceId: "git:issue-1",
        fingerprintRef: prepared.context.fingerprintRef,
        result: {
          summary: "Combined both changes",
          diagnosis: "Both branches changed README.md",
          disposition: "REVALIDATION_REQUIRED",
          affectedPaths: ["README.md"],
        },
      });
      await writeFile(join(prepared.acquired.projectPath, "README.md"), "changed after review\n");

      await expect(prepared.provider.publish({
        issue: prepared.approved,
        resourceId: "git:issue-1",
      })).rejects.toThrow("GIT_MERGE_RECOVERY_TREE_CHANGED");
    } finally {
      await prepared.cleanup();
    }
  });

  it("publishes a reaccepted resolution as a two-parent merge commit", async () => {
    const prepared = await createPreparedConflict();
    try {
      const issueCommit = prepared.context.merge!.issueCommit;
      const baseCommit = prepared.context.merge!.baseCommit!;
      await writeFile(join(prepared.acquired.projectPath, "README.md"), "combined behavior\n");
      await prepared.provider.validateFinalizationRecovery!({
        issue: prepared.approved,
        resourceId: "git:issue-1",
        fingerprintRef: prepared.context.fingerprintRef,
        result: {
          summary: "Combined both changes",
          diagnosis: "Both branches changed README.md",
          disposition: "REVALIDATION_REQUIRED",
          affectedPaths: ["README.md"],
        },
      });

      const published = await prepared.provider.publish({
        issue: prepared.approved,
        resourceId: "git:issue-1",
      });

      expect((await git(
        prepared.repository,
        "show",
        "-s",
        "--format=%P",
        published!.commit,
      )).split(" ")).toEqual([issueCommit, baseCommit]);
      expect(await git(prepared.repository, "rev-parse", "main")).toBe(published!.commit);
    } finally {
      await prepared.cleanup();
    }
  });

  it("does not apply a resolution after the base branch moves", async () => {
    const prepared = await createPreparedConflict();
    try {
      await writeFile(join(prepared.acquired.projectPath, "README.md"), "combined behavior\n");
      await prepared.provider.validateFinalizationRecovery!({
        issue: prepared.approved,
        resourceId: "git:issue-1",
        fingerprintRef: prepared.context.fingerprintRef,
        result: {
          summary: "Combined both changes",
          diagnosis: "Both branches changed README.md",
          disposition: "REVALIDATION_REQUIRED",
          affectedPaths: ["README.md"],
        },
      });
      await writeFile(join(prepared.repository, "later.txt"), "later base change\n");
      await git(prepared.repository, "add", "later.txt");
      await git(prepared.repository, "commit", "-m", "move base again");
      const movedBase = await git(prepared.repository, "rev-parse", "main");

      await expect(prepared.provider.publish({
        issue: prepared.approved,
        resourceId: "git:issue-1",
      })).rejects.toThrow("GIT_AUTO_MERGE_BASE_MOVED");
      expect(await git(prepared.repository, "rev-parse", "main")).toBe(movedBase);
      expect(await git(prepared.acquired.projectPath, "rev-parse", "HEAD"))
        .toBe(prepared.context.merge!.issueCommit);
    } finally {
      await prepared.cleanup();
    }
  });

  it("rejects a base move between recovered merge creation and base publication", async () => {
    const prepared = await createPreparedConflict({ pushToRemote: true });
    try {
      await writeFile(join(prepared.acquired.projectPath, "README.md"), "combined behavior\n");
      await prepared.provider.validateFinalizationRecovery!({
        issue: prepared.approved,
        resourceId: "git:issue-1",
        fingerprintRef: prepared.context.fingerprintRef,
        result: {
          summary: "Combined both changes",
          diagnosis: "Both branches changed README.md",
          disposition: "REVALIDATION_REQUIRED",
          affectedPaths: ["README.md"],
        },
      });
      const baseCommit = prepared.context.merge!.baseCommit!;
      const baseTree = await git(prepared.repository, "rev-parse", `${baseCommit}^{tree}`);
      const movedBase = await git(
        prepared.repository,
        "commit-tree",
        baseTree,
        "-p",
        baseCommit,
        "-m",
        "advance base during push",
      );
      const hooks = join(prepared.root, "hooks");
      await mkdir(hooks);
      const prePush = join(hooks, "pre-push");
      await writeFile(prePush, [
        "#!/bin/sh",
        `git -C ${JSON.stringify(prepared.repository)} update-ref refs/heads/main ${movedBase} ${baseCommit}`,
      ].join("\n"));
      await chmod(prePush, 0o755);
      await git(prepared.repository, "config", "core.hooksPath", hooks);

      await expect(prepared.provider.publish({
        issue: prepared.approved,
        resourceId: "git:issue-1",
      })).rejects.toThrow("GIT_AUTO_MERGE_BASE_MOVED");
      expect(await git(prepared.repository, "rev-parse", "main")).toBe(movedBase);
    } finally {
      await prepared.cleanup();
    }
  });
});

async function createPreparedConflict(options: { pushToRemote?: boolean } = {}) {
  const fixture = await createGitFixture();
  if (options.pushToRemote) {
    const bare = join(fixture.root, "delivery.git");
    await mkdir(bare);
    await git(bare, "init", "--bare");
    await git(fixture.repository, "remote", "add", "delivery", bare);
  }
  const provider = gitWorkspaceFactory({
    state: fixture.state,
    worktreeRoot: fixture.worktreeRoot,
  }).create({
    baseBranch: "main",
    pushToRemote: options.pushToRemote ?? false,
    mergeToBaseBranch: true,
    ...(options.pushToRemote ? { remote: "delivery" } : {}),
  });
  const acquired = await provider.acquire({ issue: fixture.issue, project: fixture.project });
  await writeFile(join(acquired.projectPath, "README.md"), "issue change\n");
  await writeFile(join(fixture.repository, "README.md"), "base change\n");
  await git(fixture.repository, "add", "README.md");
  await git(fixture.repository, "commit", "-m", "advance base");
  const approved = {
    ...fixture.issue,
    projectPath: acquired.projectPath,
    status: "FINALIZING" as const,
    resolution: "FIXED" as const,
  };
  let failure: WorkspaceFinalizationError;
  try {
    await provider.publish({ issue: approved, resourceId: "git:issue-1" });
    throw new Error("EXPECTED_MERGE_CONFLICT");
  } catch (error) {
    if (!(error instanceof WorkspaceFinalizationError)) throw error;
    failure = error;
  }
  const context = await provider.prepareFinalizationRecovery!({
    issue: approved,
    resourceId: "git:issue-1",
    diagnostic: failure.diagnostic,
    attemptId: "recovery-21",
  });
  return { ...fixture, provider, acquired, approved, context };
}
