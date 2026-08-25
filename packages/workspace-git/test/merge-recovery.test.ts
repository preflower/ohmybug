import { describe, expect, it } from "vitest";
import { chmod, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { WorkspaceFinalizationError } from "../src/finalization-recovery.js";
import { gitWorkspaceFactory } from "../src/provider.js";
import {
  normalizeGitFinalizationRecoveryState,
  parseMergeTreeConflictOutput,
} from "../src/merge-recovery.js";
import { createGitFixture, git } from "./helpers.js";

describe("Git merge recovery diagnostics", () => {
  it("decodes versioned persisted recovery state and strips unknown fields", () => {
    const recovery = normalizeGitFinalizationRecoveryState({
      version: 1,
      kind: "MERGE_ENVIRONMENT",
      unknownFutureField: true,
      fingerprint: fingerprintFixture(),
      merge: {
        kind: "MERGE_ENVIRONMENT",
        baseBranch: "main",
        issueBranch: "ohmybug/omb-1",
        issueCommit: "issue-commit",
        conflictPaths: [],
        mergeMessages: [],
        mergePrepared: false,
        unknownFutureField: true,
      },
    });

    expect(recovery).not.toHaveProperty("unknownFutureField");
    expect(recovery).not.toHaveProperty("merge.unknownFutureField");
  });

  it("rejects malformed active merge recovery state", () => {
    expect(() => normalizeGitFinalizationRecoveryState({
      version: 1,
      kind: "MERGE_CONFLICT",
      session: { attemptId: "missing-required-session-fields" },
    })).toThrow("GIT_MERGE_RECOVERY_STATE_INVALID");
  });

  it("preserves malformed persisted state while still giving merge failure an Agent context", async () => {
    const fixture = await createGitFixture();
    try {
      const provider = gitWorkspaceFactory({
        state: fixture.state,
        worktreeRoot: fixture.worktreeRoot,
      }).create({ baseBranch: "main", pushToRemote: false, mergeToBaseBranch: true });
      const acquired = await provider.acquire({ issue: fixture.issue, project: fixture.project });
      const saved = fixture.state.get<Record<string, unknown>>("workspace-git", "git:issue-1")!;
      const malformed = {
        ...saved,
        finalizationRecovery: {
          version: 1,
          kind: "MERGE_CONFLICT",
          session: { attemptId: "incomplete" },
        },
      };
      fixture.state.set("workspace-git", "git:issue-1", malformed);

      await expect(provider.prepareFinalizationRecovery?.({
        issue: { ...fixture.issue, projectPath: acquired.projectPath, status: "FINALIZING" },
        resourceId: "git:issue-1",
        diagnostic: {
          providerId: "git",
          step: "merge",
          code: "GIT_AUTO_MERGE_FAILED",
          message: "merge state could not be decoded",
          relatedPaths: [],
        },
        attemptId: "recovery-malformed",
      })).resolves.toMatchObject({
        recoveryKind: "MERGE_ENVIRONMENT",
        merge: { mergePrepared: false },
      });
      expect(fixture.state.get("workspace-git", "git:issue-1")).toEqual(malformed);
      expect(await git(acquired.projectPath, "status", "--porcelain")).toBe("");

      await expect(provider.validateFinalizationRecovery?.({
        issue: { ...fixture.issue, projectPath: acquired.projectPath, status: "FINALIZATION_RECOVERY" },
        resourceId: "git:issue-1",
        fingerprintRef: "git:issue-1:finalization:recovery-malformed",
        result: {
          summary: "Persisted merge state is malformed",
          diagnosis: "Recovery cannot safely resume",
          disposition: "UNSAFE",
          affectedPaths: [],
        },
      })).resolves.toMatchObject({
        kind: "UNSAFE",
        reason: "GIT_MERGE_RECOVERY_STATE_INVALID",
      });
    } finally {
      await fixture.cleanup();
    }
  });

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

  it("does not let Agent-declared paths broaden merge recovery authority", async () => {
    const prepared = await createPreparedConflict({ trackedRelatedFile: true });
    try {
      await writeFile(join(prepared.acquired.projectPath, "README.md"), "combined behavior\n");
      await writeFile(join(prepared.acquired.projectPath, "unrelated.txt"), "self-declared edit\n");

      await expect(prepared.provider.validateFinalizationRecovery?.({
        issue: prepared.approved,
        resourceId: "git:issue-1",
        fingerprintRef: prepared.context.fingerprintRef,
        result: {
          summary: "Changed an unrelated path",
          diagnosis: "The Agent declared the path itself",
          disposition: "REVALIDATION_REQUIRED",
          affectedPaths: ["README.md", "unrelated.txt"],
        },
      })).resolves.toMatchObject({
        kind: "UNSAFE",
        reason: "GIT_MERGE_RECOVERY_OUT_OF_SCOPE",
        changedPaths: ["unrelated.txt"],
      });
    } finally {
      await prepared.cleanup();
    }
  });

  it("rejects a conflict resolution replaced by a symlink", async () => {
    const prepared = await createPreparedConflict();
    try {
      const outside = join(prepared.root, "outside.txt");
      await writeFile(outside, "outside content\n");
      await rm(join(prepared.acquired.projectPath, "README.md"));
      await symlink(outside, join(prepared.acquired.projectPath, "README.md"));

      await expect(prepared.provider.validateFinalizationRecovery?.({
        issue: prepared.approved,
        resourceId: "git:issue-1",
        fingerprintRef: prepared.context.fingerprintRef,
        result: {
          summary: "Replaced the conflict with a symlink",
          diagnosis: "Unsafe file type",
          disposition: "REVALIDATION_REQUIRED",
          affectedPaths: ["README.md"],
        },
      })).resolves.toMatchObject({
        kind: "UNSAFE",
        reason: "GIT_MERGE_RECOVERY_FILE_TYPE_INVALID",
        changedPaths: ["README.md"],
      });
    } finally {
      await prepared.cleanup();
    }
  });

  it("rejects dirty initialized submodules during merge recovery", async () => {
    const prepared = await createPreparedConflict({ initializedSubmodule: true });
    try {
      await writeFile(join(prepared.acquired.projectPath, "README.md"), "combined behavior\n");
      await writeFile(
        join(prepared.acquired.projectPath, "vendor", "README.md"),
        "dirty submodule content\n",
      );

      await expect(prepared.provider.validateFinalizationRecovery?.({
        issue: prepared.approved,
        resourceId: "git:issue-1",
        fingerprintRef: prepared.context.fingerprintRef,
        result: {
          summary: "Resolved the source conflict",
          diagnosis: "A submodule was also modified",
          disposition: "REVALIDATION_REQUIRED",
          affectedPaths: ["README.md"],
        },
      })).resolves.toMatchObject({
        kind: "UNSAFE",
        reason: "GIT_MERGE_RECOVERY_OUT_OF_SCOPE",
        changedPaths: ["vendor"],
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

  it("renews repository invariants immediately before final publication", async () => {
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
      await git(prepared.acquired.projectPath, "config", "user.name", "Changed After Validation");

      await expect(prepared.provider.publish({
        issue: prepared.approved,
        resourceId: "git:issue-1",
      })).rejects.toThrow("GIT_MERGE_RECOVERY_REPOSITORY_STATE_CHANGED");
      expect(await git(prepared.acquired.projectPath, "rev-parse", "HEAD"))
        .toBe(prepared.context.merge!.issueCommit);
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
    const prepared = await createPreparedConflict({
      pushToRemote: true,
      moveBaseDuringRecoveredPush: true,
    });
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
      await expect(prepared.provider.publish({
        issue: prepared.approved,
        resourceId: "git:issue-1",
      })).rejects.toThrow("GIT_AUTO_MERGE_BASE_MOVED");
      expect(await git(prepared.repository, "rev-parse", "main")).toBe(prepared.movedBase);
    } finally {
      await prepared.cleanup();
    }
  });
});

function fingerprintFixture() {
  return {
    fingerprintRef: "fingerprint-ref",
    attemptId: "attempt-id",
    head: "head",
    headRef: "refs/heads/ohmybug/omb-1",
    index: "",
    indexFlags: "",
    repositoryStateHash: "hash",
    tracked: [],
    untracked: [],
    diagnosticEntries: [],
    diagnosticRoots: [],
  };
}

async function createPreparedConflict(options: {
  pushToRemote?: boolean;
  trackedRelatedFile?: boolean;
  moveBaseDuringRecoveredPush?: boolean;
  initializedSubmodule?: boolean;
} = {}) {
  const fixture = await createGitFixture();
  if (options.trackedRelatedFile) {
    await writeFile(join(fixture.repository, "unrelated.txt"), "baseline unrelated\n");
    await git(fixture.repository, "add", "unrelated.txt");
    await git(fixture.repository, "commit", "-m", "add unrelated source file");
  }
  if (options.initializedSubmodule) {
    const source = join(fixture.root, "submodule-source");
    await mkdir(source);
    await git(source, "init", "-b", "main");
    await git(source, "config", "user.name", "Submodule Test");
    await git(source, "config", "user.email", "submodule@ohmybug.local");
    await writeFile(join(source, "README.md"), "submodule baseline\n");
    await git(source, "add", "README.md");
    await git(source, "commit", "-m", "submodule baseline");
    await git(
      fixture.repository,
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      source,
      "vendor",
    );
    await git(fixture.repository, "commit", "-am", "add submodule");
  }
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
  if (options.initializedSubmodule) {
    await git(
      acquired.projectPath,
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "update",
      "--init",
      "vendor",
    );
  }
  await writeFile(join(acquired.projectPath, "README.md"), "issue change\n");
  await writeFile(join(fixture.repository, "README.md"), "base change\n");
  await git(fixture.repository, "add", "README.md");
  await git(fixture.repository, "commit", "-m", "advance base");
  let movedBase: string | undefined;
  if (options.moveBaseDuringRecoveredPush) {
    const baseCommit = await git(fixture.repository, "rev-parse", "main");
    const baseTree = await git(fixture.repository, "rev-parse", `${baseCommit}^{tree}`);
    movedBase = await git(
      fixture.repository,
      "commit-tree",
      baseTree,
      "-p",
      baseCommit,
      "-m",
      "advance base during push",
    );
    const hooks = join(fixture.root, "hooks");
    await mkdir(hooks);
    const prePush = join(hooks, "pre-push");
    const bare = join(fixture.root, "delivery.git");
    await writeFile(prePush, [
      "#!/bin/sh",
      `if git --git-dir=${JSON.stringify(bare)} show-ref --verify --quiet refs/heads/ohmybug/omb-1; then`,
      `  git -C ${JSON.stringify(fixture.repository)} update-ref refs/heads/main ${movedBase} ${baseCommit}`,
      "fi",
    ].join("\n"));
    await chmod(prePush, 0o755);
    await git(fixture.repository, "config", "core.hooksPath", hooks);
  }
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
  return { ...fixture, provider, acquired, approved, context, movedBase };
}
