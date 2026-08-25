# Finalization Recovery Concurrency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make delivery recovery tolerate unrelated branch movement, safely normalize mixed tracked/untracked generated cache roots, and retry automatic base merges after concurrent base movement.

**Architecture:** Scope the recovery fingerprint to the recovering worktree and local Git configuration. Require untracked diagnostic artifacts to disappear and tracked diagnostic paths to match `HEAD`. Preserve `merge-tree`/`commit-tree`/compare-and-swap publication and recompute against a newer base after bounded contention.

**Tech Stack:** TypeScript, Node.js, Git CLI, Vitest, pnpm workspaces.

---

### Task 1: Scope Recovery State to the Recovering Worktree

**Files:**
- Modify: `packages/workspace-git/test/finalization-recovery.test.ts`
- Modify: `packages/workspace-git/src/finalization-recovery.ts:293-304`

- [ ] **Step 1: Write the failing unrelated-ref regression**

Replace the current unrelated-ref test and add the configuration test:

```ts
it("ignores an unrelated ref mutation during the Agent turn", async () => {
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

it("rejects a repository-local Git configuration mutation", async () => {
  const fixture = await setupRecovery();
  await rm(fixture.diagnosticRoot, { recursive: true });
  await git(fixture.acquired.projectPath, "config", "core.autocrlf", "true");
  await expect(fixture.provider.validateFinalizationRecovery?.({
    issue: { ...fixture.approved, status: "FINALIZATION_RECOVERY" },
    resourceId: "git:issue-1",
    fingerprintRef: fixture.context.fingerprintRef,
    result: recovered,
  })).resolves.toMatchObject({
    kind: "UNSAFE",
    reason: "FINALIZATION_RECOVERY_REPOSITORY_STATE_CHANGED",
  });
});
```

- [ ] **Step 2: Verify RED**

Run `pnpm --filter @oh-my-bug/workspace-git test -- finalization-recovery.test.ts`.

Expected: the unrelated-ref test receives `FINALIZATION_RECOVERY_REPOSITORY_STATE_CHANGED`; the configuration test passes.

- [ ] **Step 3: Implement the scoped repository hash**

```ts
async function repositoryStateHash(worktreePath: string): Promise<string> {
  return digest(await runGit(worktreePath, ["config", "--local", "--null", "--list"]));
}
```

- [ ] **Step 4: Verify GREEN**

Run `pnpm --filter @oh-my-bug/workspace-git test -- finalization-recovery.test.ts`.

Expected: all tests pass; HEAD, symbolic HEAD, index, content, and local configuration protections remain covered.

- [ ] **Step 5: Commit**

```bash
git add packages/workspace-git/src/finalization-recovery.ts packages/workspace-git/test/finalization-recovery.test.ts
git commit -m "fix(recovery): ignore unrelated branch movement"
```

### Task 2: Normalize Mixed Generated Roots

**Files:**
- Modify: `packages/workspace-git/test/finalization-recovery.test.ts`
- Modify: `packages/workspace-git/src/finalization-recovery.ts:142-199`
- Modify: `packages/agent-codex/test/finalization-recovery.test.ts`
- Modify: `packages/agent-codex/src/finalization-recovery-prompt.ts:12-15`

- [ ] **Step 1: Extend the fixture and write mixed-root regressions**

Add the `beforeAcquire` property to the current options type:

```ts
async function setupRecovery(options: {
  diagnosticPaths?: string[];
  beforeAcquire?: (repositoryPath: string) => Promise<void>;
  beforePublish?: (worktreePath: string) => Promise<void>;
} = {}) {
  const fixture = await createGitFixture();
  cleanups.push(fixture.cleanup);
  await options.beforeAcquire?.(fixture.repository);
```

Keep the provider construction immediately after this inserted call; no other fixture ordering changes.

Add the fixture helper:

```ts
async function trackGeneratedIndex(repositoryPath: string): Promise<void> {
  const indexPath = join(repositoryPath, ".pnpm-store/v11/index.db");
  await mkdir(join(indexPath, ".."), { recursive: true });
  await writeFile(indexPath, "baseline cache index\n");
  await git(repositoryPath, "add", "-f", ".pnpm-store/v11/index.db");
  await git(repositoryPath, "commit", "-m", "track legacy cache index");
}
```

Add one safe and two unsafe cases:

```ts
it("accepts tracked generated state restored exactly to HEAD", async () => {
  const fixture = await setupRecovery({
    beforeAcquire: trackGeneratedIndex,
    beforePublish: (path) => writeFile(
      join(path, ".pnpm-store/v11/index.db"),
      "generated mutation\n",
    ),
  });
  await rm(fixture.diagnosticRoot, { recursive: true });
  await git(fixture.acquired.projectPath, "restore", "--source=HEAD", "--worktree", "--",
    ".pnpm-store/v11/index.db");
  await expect(fixture.provider.validateFinalizationRecovery?.({
    issue: { ...fixture.approved, status: "FINALIZATION_RECOVERY" },
    resourceId: "git:issue-1",
    fingerprintRef: fixture.context.fingerprintRef,
    result: recovered,
  })).resolves.toEqual({ kind: "UNCHANGED", changedPaths: [] });
});

it.each([
  ["deleted", (path: string) => rm(path)],
  ["modified", (path: string) => writeFile(path, "non-HEAD generated state\n")],
] as const)("rejects tracked generated state that is %s", async (_name, mutate) => {
  const fixture = await setupRecovery({
    beforeAcquire: trackGeneratedIndex,
    beforePublish: (path) => writeFile(
      join(path, ".pnpm-store/v11/index.db"),
      "generated mutation\n",
    ),
  });
  await rm(fixture.diagnosticRoot, { recursive: true });
  await mutate(join(fixture.acquired.projectPath, ".pnpm-store/v11/index.db"));
  await expect(fixture.provider.validateFinalizationRecovery?.({
    issue: { ...fixture.approved, status: "FINALIZATION_RECOVERY" },
    resourceId: "git:issue-1",
    fingerprintRef: fixture.context.fingerprintRef,
    result: recovered,
  })).resolves.toMatchObject({
    kind: "UNSAFE",
    reason: "FINALIZATION_RECOVERY_GENERATED_TRACKED_ARTIFACT_REMAINS",
    changedPaths: [".pnpm-store/v11/index.db"],
  });
});
```

- [ ] **Step 2: Verify RED**

Run `pnpm --filter @oh-my-bug/workspace-git test -- finalization-recovery.test.ts`.

Expected: safe restoration is rejected as `FINALIZATION_RECOVERY_DIAGNOSTIC_ROOT_TRACKED`; unsafe cases do not return the new reason.

- [ ] **Step 3: Implement tracked generated-path normalization**

Remove the unconditional `DIAGNOSTIC_ROOT_TRACKED` return. Replace tracked-change validation with:

```ts
const generatedTrackedPaths = before.tracked
  .map((entry) => entry.path)
  .filter((path) => before.diagnosticRoots.some((root) => withinRoot(path, root.path)));
const generatedTrackedSet = new Set(generatedTrackedPaths);
const trackedChanges = changedEntries(before.tracked, current.tracked);
const approvedTrackedChanges = trackedChanges.filter((path) => !generatedTrackedSet.has(path));
if (approvedTrackedChanges.length > 0) {
  return { kind: "CHANGED", changedPaths: approvedTrackedChanges };
}
const remainingTrackedArtifacts: string[] = [];
for (const path of generatedTrackedPaths) {
  if (!(await pathMatchesHead(input.worktreePath, path))) remainingTrackedArtifacts.push(path);
}
if (remainingTrackedArtifacts.length > 0) {
  return unsafe(
    "FINALIZATION_RECOVERY_GENERATED_TRACKED_ARTIFACT_REMAINS",
    remainingTrackedArtifacts,
  );
}
```

Add:

```ts
async function pathMatchesHead(worktreePath: string, path: string): Promise<boolean> {
  return await tryRunGit(
    worktreePath,
    ["diff", "--quiet", "HEAD", "--", `:(literal)${path}`],
    [1],
  ) !== undefined;
}
```

- [ ] **Step 4: Verify GREEN for workspace recovery**

Run `pnpm --filter @oh-my-bug/workspace-git test -- finalization-recovery.test.ts`.

Expected: safe restoration is `UNCHANGED`; deletion and non-HEAD modification are `UNSAFE`; existing content-change and preflight tests pass.

- [ ] **Step 5: Write and verify the prompt regression**

Add:

```ts
expect(prompt).toContain("Remove untracked generated content");
expect(prompt).toContain("Restore tracked generated content exactly to HEAD");
expect(prompt).toContain("never delete tracked generated content");
```

Run `pnpm --filter @oh-my-bug/agent-codex test -- finalization-recovery.test.ts`.

Expected: the three expectations fail against the current prompt.

- [ ] **Step 6: Update the prompt and verify GREEN**

Replace its two generated-artifact instructions with:

```ts
"Do not change product behavior. Remove untracked generated content only after proving it is untracked. Restore tracked generated content exactly to HEAD; never delete tracked generated content or replace it with invented content. If any other product or approved delivery content must change, return REVALIDATION_REQUIRED.",
"Inspect every generated root listed in the fingerprint summary. Remove all untracked generated entries and restore every tracked entry under those roots exactly to HEAD; do not return RECOVERED while generated pollution or a non-HEAD tracked generated entry remains.",
```

Run:

```bash
pnpm --filter @oh-my-bug/workspace-git test -- finalization-recovery.test.ts
pnpm --filter @oh-my-bug/agent-codex test -- finalization-recovery.test.ts
```

Expected: both focused suites pass.

- [ ] **Step 7: Commit**

```bash
git add packages/workspace-git/src/finalization-recovery.ts packages/workspace-git/test/finalization-recovery.test.ts packages/agent-codex/src/finalization-recovery-prompt.ts packages/agent-codex/test/finalization-recovery.test.ts
git commit -m "fix(recovery): normalize tracked generated state"
```

### Task 3: Recompute After Concurrent Base Movement

**Files:**
- Modify: `packages/workspace-git/test/publish.test.ts`
- Modify: `packages/workspace-git/src/provider.ts:568-634`

- [ ] **Step 1: Write deterministic retry-helper tests**

Import `retryOnBaseAdvance` from `../src/provider.js`, then add:

```ts
it("recomputes after the base advances concurrently", async () => {
  let base = "base-1";
  const attempted: string[] = [];
  const result = await retryOnBaseAdvance(async () => base, async (observed) => {
    attempted.push(observed);
    if (observed === "base-1") {
      base = "base-2";
      throw new Error("stale compare-and-swap");
    }
    return "merged-on-base-2";
  }, 3);
  expect(result).toBe("merged-on-base-2");
  expect(attempted).toEqual(["base-1", "base-2"]);
});

it("does not retry while the base is unchanged", async () => {
  let attempts = 0;
  await expect(retryOnBaseAdvance(async () => "base-1", async () => {
    attempts += 1;
    throw new Error("merge conflict");
  }, 3)).rejects.toThrow("merge conflict");
  expect(attempts).toBe(1);
});
```

- [ ] **Step 2: Verify RED**

Run `pnpm --filter @oh-my-bug/workspace-git test -- publish.test.ts`.

Expected: compilation fails because `retryOnBaseAdvance` does not exist.

- [ ] **Step 3: Implement bounded base-advance retry**

```ts
const MAX_BASE_ADVANCE_ATTEMPTS = 3;

export async function retryOnBaseAdvance<T>(
  readBase: () => Promise<string>,
  attempt: (baseCommit: string) => Promise<T>,
  maxAttempts = MAX_BASE_ADVANCE_ATTEMPTS,
): Promise<T> {
  let lastError: unknown;
  for (let number = 0; number < maxAttempts; number += 1) {
    const observedBase = await readBase();
    try {
      return await attempt(observedBase);
    } catch (error) {
      if (await readBase() === observedBase) throw error;
      lastError = error;
    }
  }
  throw new Error("GIT_AUTO_MERGE_FAILED", { cause: lastError });
}
```

- [ ] **Step 4: Use the helper in `mergeIntoBaseBranch`**

Replace `mergeIntoBaseBranch` with:

```ts
async function mergeIntoBaseBranch(
  state: GitWorkspaceState,
  commit: string,
): Promise<void> {
  await assertGitSupportsAutomaticMerge(state.repositoryPath);
  const baseRef = `refs/heads/${state.baseBranch}`;
  if (!(await gitRefExists(state.repositoryPath, baseRef))) {
    throw new Error("GIT_AUTO_MERGE_REQUIRES_LOCAL_BASE_BRANCH");
  }
  const listed = await runGit(state.repositoryPath, ["worktree", "list", "--porcelain", "-z"]);
  const checkedOutPath = worktreePathForBranch(listed, baseRef);

  await retryOnBaseAdvance(
    () => runGit(state.repositoryPath, ["rev-parse", baseRef]),
    async (baseCommit) => {
      if (await tryRunGit(
        state.repositoryPath,
        ["merge-base", "--is-ancestor", commit, baseCommit],
      ) !== undefined) {
        return;
      }
      const resultCommit = await createAutomaticMergeCommit(
        state.repositoryPath,
        baseCommit,
        commit,
        state.branch,
        state.baseBranch,
      );
      if (checkedOutPath !== undefined) {
        try {
          await assertWorktreeAndSubmodulesClean(checkedOutPath);
          await assertNoIgnoredMergeCollisions(
            state.repositoryPath,
            checkedOutPath,
            baseCommit,
            resultCommit,
          );
          await assertNoInitializedGitlinkUpdates(
            state.repositoryPath,
            checkedOutPath,
            baseCommit,
            resultCommit,
          );
        } catch (error) {
          if (error instanceof Error && error.message === "GIT_WORKTREE_NOT_CLEAN") {
            throw new Error("GIT_AUTO_MERGE_BASE_DIRTY", { cause: error });
          }
          throw error;
        }
        try {
          await runGit(checkedOutPath, ["merge", "--ff-only", resultCommit]);
        } catch (error) {
          throw new Error("GIT_AUTO_MERGE_FAILED", { cause: error });
        }
        return;
      }
      try {
        await runGit(state.repositoryPath, [
          "update-ref",
          baseRef,
          resultCommit,
          baseCommit,
        ]);
      } catch (error) {
        throw new Error("GIT_AUTO_MERGE_FAILED", { cause: error });
      }
    },
  );
}
```

The attempt must throw `GIT_AUTO_MERGE_CONFLICT` for a stable conflicting base, `GIT_AUTO_MERGE_BASE_DIRTY` for a stable dirty checked-out base, and `GIT_AUTO_MERGE_FAILED` for a stable ref update failure. The helper retries only when rereading `baseRef` proves it moved.

- [ ] **Step 5: Verify GREEN**

Run `pnpm --filter @oh-my-bug/workspace-git test -- publish.test.ts`.

Expected: retry-helper tests and all existing automatic merge safety tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/workspace-git/src/provider.ts packages/workspace-git/test/publish.test.ts
git commit -m "fix(git): recompute concurrent base merges"
```

### Task 4: Full Verification

**Files:**
- Verify: all files modified in Tasks 1-3

- [ ] **Step 1: Run package suites**

```bash
pnpm --filter @oh-my-bug/workspace-git test
pnpm --filter @oh-my-bug/agent-codex test
```

Expected: both suites pass with zero failures.

- [ ] **Step 2: Run typechecks and runtime acceptance**

```bash
pnpm --filter @oh-my-bug/workspace-git typecheck
pnpm --filter @oh-my-bug/agent-codex typecheck
pnpm --filter @oh-my-bug/runtime test -- finalization-recovery.test.ts
```

Expected: all commands exit 0.

- [ ] **Step 3: Run changed-file controls**

```bash
pnpm exec oxlint packages/workspace-git/src/finalization-recovery.ts packages/workspace-git/src/provider.ts packages/workspace-git/test/finalization-recovery.test.ts packages/workspace-git/test/publish.test.ts packages/agent-codex/src/finalization-recovery-prompt.ts packages/agent-codex/test/finalization-recovery.test.ts
git diff --check HEAD~3..HEAD
git status --short
```

Expected: lint and whitespace checks pass; the isolated implementation worktree is clean.
