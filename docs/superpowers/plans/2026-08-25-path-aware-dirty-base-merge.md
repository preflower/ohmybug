# Path-Aware Dirty Base Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow automatic merges into a checked-out `main` branch when its local changes cannot overlap the merge result, while preserving strict rejection for real path collisions and unsafe Git state.

**Architecture:** Compute the paths changed by the automatic merge, enumerate tracked/staged/untracked local paths independently of `git status` configuration, and reject only exact or ancestor/descendant intersections. Keep assume-unchanged/skip-worktree entries, initialized submodules, ignored collisions, and initialized gitlink updates strict; reuse the same safety check in recovery preflight and leave `git merge --ff-only` as the final atomic guard.

**Tech Stack:** TypeScript, Node.js child processes, Git plumbing/porcelain commands, Vitest.

---

## File structure

- Modify `packages/workspace-git/src/provider.ts`: add path-overlap and checked-out-base safety helpers; use them for publication and recovery preflight.
- Modify `packages/workspace-git/test/publish.test.ts`: cover unrelated dirty files, staged changes, status-hidden files, exact collisions, and ancestor/descendant collisions.
- Modify `packages/workspace-git/test/merge-recovery.test.ts`: prove recovery accepts unrelated local state but continues to reject overlapping state.

### Task 1: Characterize path-aware publication behavior

**Files:**
- Modify: `packages/workspace-git/test/publish.test.ts:760-880`
- Test: `packages/workspace-git/test/publish.test.ts`

- [ ] **Step 1: Change the unrelated-untracked test to require a successful merge without deleting the local file**

Replace the current dirty-base retry test with this behavior:

```ts
it("merges while preserving an unrelated untracked baseline file", async () => {
  const fixture = await createGitFixture();
  cleanups.push(fixture.cleanup);
  const provider = gitWorkspaceFactory({
    state: fixture.state,
    worktreeRoot: fixture.worktreeRoot,
  }).create({ baseBranch: "main", pushToRemote: false, mergeToBaseBranch: true });
  const acquired = await provider.acquire({ issue: fixture.issue, project: fixture.project });
  await writeFile(join(acquired.projectPath, "fixed.txt"), "fixed\n");
  const localPath = join(fixture.repository, "local.txt");
  await writeFile(localPath, "uncommitted\n");
  const approved = {
    ...fixture.issue,
    projectPath: acquired.projectPath,
    status: "FINALIZING" as const,
    resolution: "FIXED" as const,
  };

  const published = await provider.publish({ issue: approved, resourceId: "git:issue-1" });

  expect(await git(fixture.repository, "rev-parse", "main")).toBe(published!.commit);
  expect(await readFile(localPath, "utf8")).toBe("uncommitted\n");
  expect(await git(fixture.repository, "show", "main:fixed.txt")).toBe("fixed");
});
```

- [ ] **Step 2: Change the status-hidden test to require success and preservation**

Keep `status.showUntrackedFiles=no`, publish once, then assert that `main` equals the published commit and `hidden-local-note.txt` still contains `keep me\n`.

- [ ] **Step 3: Add an unstaged tracked regression matching the OHMYBUG-19 path pattern**

Add `dirname` to the existing `node:path` import, then add this test:

```ts
it("merges the OHMYBUG-19 path set beside the current unrelated local changes", async () => {
  const fixture = await createGitFixture();
  cleanups.push(fixture.cleanup);
  const localPaths = [
    "apps/desktop/scripts/dev.cjs",
    "apps/desktop/test/electron/dev-entry.test.ts",
    "packages/agent-codex/src/output-schemas.ts",
    "packages/agent-codex/src/prompts.ts",
    "packages/agent-codex/test/assessment.test.ts",
    "packages/agent-codex/test/repair.test.ts",
  ];
  for (const path of localPaths) {
    const absolutePath = join(fixture.repository, path);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, "baseline\n");
  }
  await git(fixture.repository, "add", ...localPaths);
  await git(fixture.repository, "commit", "-m", "add local-path fixtures");
  const provider = gitWorkspaceFactory({
    state: fixture.state,
    worktreeRoot: fixture.worktreeRoot,
  }).create({ baseBranch: "main", pushToRemote: false, mergeToBaseBranch: true });
  const acquired = await provider.acquire({ issue: fixture.issue, project: fixture.project });
  for (const path of localPaths) {
    await writeFile(join(fixture.repository, path), "local change\n");
  }
  const issuePaths = [
    "apps/desktop/src/web/styles/global.css",
    "apps/desktop/test/electron/e2e/sidebar-layout.spec.ts",
    "apps/desktop/test/web/sidebar-layout.test.ts",
    "docs/superpowers/plans/2026-08-24-new-issue-icon-alignment.md",
    "docs/superpowers/specs/2026-08-24-new-issue-icon-alignment-design.md",
  ];
  for (const path of issuePaths) {
    const absolutePath = join(acquired.projectPath, path);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, "issue change\n");
  }
  const approved = {
    ...fixture.issue,
    projectPath: acquired.projectPath,
    status: "FINALIZING" as const,
    resolution: "FIXED" as const,
  };

  const published = await provider.publish({ issue: approved, resourceId: "git:issue-1" });

  expect(await git(fixture.repository, "rev-parse", "main")).toBe(published!.commit);
  for (const path of localPaths) {
    expect(await readFile(join(fixture.repository, path), "utf8")).toBe("local change\n");
  }
  expect(new Set((await git(fixture.repository, "diff", "--name-only")).split("\n")))
    .toEqual(new Set(localPaths));
  for (const path of issuePaths) {
    expect(await git(fixture.repository, "show", `main:${path}`)).toBe("issue change");
  }
});
```

- [ ] **Step 4: Add a staged-unrelated-file success test**

Commit `baseline.txt` before acquiring the Issue worktree, modify and stage it in the checked-out baseline, add `fixed.txt` in the Issue worktree, publish, and assert:

```ts
expect(await git(fixture.repository, "rev-parse", "main")).toBe(published!.commit);
expect(await readFile(join(fixture.repository, "baseline.txt"), "utf8"))
  .toBe("local staged version\n");
expect(await git(fixture.repository, "diff", "--cached", "--name-only"))
  .toBe("baseline.txt");
```

- [ ] **Step 5: Add exact and directory/file collision tests**

Add three tests that each expect `GIT_AUTO_MERGE_BASE_DIRTY` and verify `main` is unchanged:

```ts
// Exact: Issue and checked-out baseline both modify tracked README.md.
await writeFile(join(acquired.projectPath, "README.md"), "issue version\n");
await writeFile(join(fixture.repository, "README.md"), "local version\n");

// Local ancestor: Issue adds generated/result.txt while baseline has untracked file generated.
await mkdir(join(acquired.projectPath, "generated"), { recursive: true });
await writeFile(join(acquired.projectPath, "generated", "result.txt"), "issue\n");
await writeFile(join(fixture.repository, "generated"), "local file\n");

// Local descendant: Issue adds file generated while baseline has generated/local.txt.
await writeFile(join(acquired.projectPath, "generated"), "issue file\n");
await mkdir(join(fixture.repository, "generated"), { recursive: true });
await writeFile(join(fixture.repository, "generated", "local.txt"), "local descendant\n");
```

Each test uses a fresh fixture so filesystem shapes do not interfere.

- [ ] **Step 6: Run the focused publication tests and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/workspace-git test -- publish.test.ts
```

Expected: unrelated untracked, status-hidden, unstaged OHMYBUG-19-pattern, and staged-unrelated tests fail because the current strict clean-worktree guard throws `GIT_AUTO_MERGE_BASE_DIRTY`; collision protection tests remain passing.

- [ ] **Step 7: Commit the characterization tests**

```bash
git add packages/workspace-git/test/publish.test.ts
git commit -m "test(git): define path-aware dirty base merges"
```

### Task 2: Implement checked-out-base path safety

**Files:**
- Modify: `packages/workspace-git/src/provider.ts:820-1085`
- Test: `packages/workspace-git/test/publish.test.ts`

- [ ] **Step 1: Add a NUL-path parser and path relationship predicate**

Place these helpers beside `getChangedPaths`:

```ts
function parseNulPaths(output: string): string[] {
  return output.split("\0").filter(Boolean);
}

function gitPathsOverlap(left: string, right: string): boolean {
  return left === right
    || left.startsWith(`${right}/`)
    || right.startsWith(`${left}/`);
}
```

Update `getChangedPaths` to return `parseNulPaths(output)`.

- [ ] **Step 2: Add the checked-out-base safety helper**

Add this helper above `assertNoIgnoredMergeCollisions`:

```ts
async function assertBaseCheckoutMergeSafe(
  repositoryPath: string,
  worktreePath: string,
  baseCommit: string,
  resultObject: string,
): Promise<void> {
  await assertNoHiddenIndexEntries(worktreePath);
  await assertInitializedSubmodulesClean(worktreePath, new Set<string>());

  const [mergePaths, trackedOutput, untrackedOutput] = await Promise.all([
    getChangedPaths(repositoryPath, baseCommit, resultObject),
    runGit(worktreePath, ["diff", "--name-only", "-z", "HEAD"]),
    runGit(worktreePath, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  const localPaths = [
    ...parseNulPaths(trackedOutput),
    ...parseNulPaths(untrackedOutput),
  ];
  if (localPaths.some((localPath) =>
    mergePaths.some((mergePath) => gitPathsOverlap(localPath, mergePath)))) {
    throw new Error("GIT_WORKTREE_NOT_CLEAN");
  }

  await assertNoIgnoredMergeCollisions(
    repositoryPath,
    worktreePath,
    baseCommit,
    resultObject,
  );
  await assertNoInitializedGitlinkUpdates(
    repositoryPath,
    worktreePath,
    baseCommit,
    resultObject,
  );
}
```

- [ ] **Step 3: Replace the publication clean-worktree gate**

Inside `mergeIntoBaseBranch`, replace the three separate assertions with:

```ts
await assertBaseCheckoutMergeSafe(
  state.repositoryPath,
  checkedOutPath,
  baseCommit,
  resultCommit,
);
```

Keep the existing conversion from `GIT_WORKTREE_NOT_CLEAN` to `GIT_AUTO_MERGE_BASE_DIRTY`. Convert a stable checked-out-worktree `merge --ff-only` failure to `GIT_AUTO_MERGE_BASE_DIRTY`; the surrounding base-advance check still maps concurrent base movement to retry or `GIT_AUTO_MERGE_BASE_MOVED`.

- [ ] **Step 4: Run the focused publication tests and verify GREEN**

Run:

```bash
pnpm --filter @oh-my-bug/workspace-git test -- publish.test.ts
```

Expected: all publication tests pass, including unrelated dirty preservation and all collision/submodule/hidden-index protections.

- [ ] **Step 5: Run type checking**

Run:

```bash
pnpm --filter @oh-my-bug/workspace-git typecheck
```

Expected: exit 0 with no TypeScript diagnostics.

- [ ] **Step 6: Commit the implementation**

```bash
git add packages/workspace-git/src/provider.ts
git commit -m "fix(git): allow unrelated dirty base paths"
```

### Task 3: Reuse path safety during recovery validation

**Files:**
- Modify: `packages/workspace-git/src/provider.ts:900-970`
- Modify: `packages/workspace-git/test/merge-recovery.test.ts:325-470`
- Test: `packages/workspace-git/test/merge-recovery.test.ts`

- [ ] **Step 1: Rewrite dirty-base recovery coverage**

In the existing dirty-base recovery test, first add `fixed.txt` to the Issue worktree and commit it. With unrelated `local-only.txt` present, require:

```ts
await expect(provider.validateFinalizationRecovery!(validationInput)).resolves.toEqual({
  kind: "UNCHANGED",
  changedPaths: [],
});
```

Then remove `local-only.txt`, create an untracked baseline `fixed.txt`, and require:

```ts
await expect(provider.validateFinalizationRecovery!(validationInput)).resolves.toMatchObject({
  kind: "UNSAFE",
  reason: "GIT_AUTO_MERGE_BASE_DIRTY",
});
```

Remove the collision before retaining the existing advanced-base fingerprint assertion.

- [ ] **Step 2: Update missing-base recovery coverage**

After restoring and checking out `main`, keep `local-after-restore.txt` present and require `UNCHANGED`, because it does not overlap the Issue merge. Add a separate `README.md` local modification matching the Issue-changed path and require `GIT_AUTO_MERGE_BASE_DIRTY`; restore `README.md` afterward.

- [ ] **Step 3: Run focused recovery tests and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/workspace-git test -- merge-recovery.test.ts
```

Expected: the unrelated-local-state assertions fail because recovery still calls the strict clean-worktree guard.

- [ ] **Step 4: Make recovery preflight compute and validate the merge result tree**

In `automaticMergePreflightReason`, resolve `baseCommit` and `issueCommit`, run `merge-tree --write-tree`, parse the first output line as `resultTree`, then run the same path-aware guard when the base is checked out:

```ts
const [baseCommit, issueCommit] = await Promise.all([
  runGit(state.repositoryPath, ["rev-parse", baseRef]),
  runGit(state.worktreePath, ["rev-parse", "HEAD"]),
]);
const treeOutput = await runGit(state.repositoryPath, [
  "merge-tree",
  "--write-tree",
  baseCommit,
  issueCommit,
]);
const resultTree = treeOutput.split("\n", 1)[0]?.trim();
if (!resultTree) return "GIT_MERGE_ENVIRONMENT_UNRESOLVED";
if (checkedOutPath) {
  try {
    await assertBaseCheckoutMergeSafe(
      state.repositoryPath,
      checkedOutPath,
      baseCommit,
      resultTree,
    );
  } catch {
    return "GIT_AUTO_MERGE_BASE_DIRTY";
  }
}
```

Preserve `GitCommandError` exit code 1 mapping to `GIT_AUTO_MERGE_CONFLICT`.

- [ ] **Step 5: Make dirty-base obstruction validation delegate to the shared preflight**

In `unresolvedMergeEnvironmentReason`, replace the strict clean-worktree branch for `GIT_AUTO_MERGE_BASE_DIRTY` with:

```ts
if (diagnosticCode === "GIT_AUTO_MERGE_BASE_DIRTY") {
  return await automaticMergePreflightReason(state);
}
```

This lets an unrelated local file clear the original obstruction while still reporting a current collision, missing base, unsupported Git version, or merge conflict accurately.

- [ ] **Step 6: Run recovery and publication tests and verify GREEN**

Run:

```bash
pnpm --filter @oh-my-bug/workspace-git test -- merge-recovery.test.ts publish.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 7: Commit recovery parity**

```bash
git add packages/workspace-git/src/provider.ts packages/workspace-git/test/merge-recovery.test.ts
git commit -m "fix(recovery): accept unrelated dirty base paths"
```

### Task 4: Full verification and integration readiness

**Files:**
- Verify: `packages/workspace-git/src/provider.ts`
- Verify: `packages/workspace-git/test/publish.test.ts`
- Verify: `packages/workspace-git/test/merge-recovery.test.ts`

- [ ] **Step 1: Run workspace-git tests**

Run:

```bash
pnpm --filter @oh-my-bug/workspace-git test
```

Expected: all `@oh-my-bug/workspace-git` tests pass with 0 failures.

- [ ] **Step 2: Run workspace-git type checking**

Run:

```bash
pnpm --filter @oh-my-bug/workspace-git typecheck
```

Expected: exit 0 with no diagnostics.

- [ ] **Step 3: Run the repository test suite**

Run:

```bash
pnpm test
```

Expected: all repository tests pass with 0 failures.

- [ ] **Step 4: Inspect the final diff and commits**

Run:

```bash
git status --short
git diff main...HEAD --check
git log --oneline main..HEAD
```

Expected: clean feature worktree; no whitespace errors; only the planned provider/tests commits are listed.

- [ ] **Step 5: Prepare the branch for the finishing workflow**

Use the `verification-before-completion` skill to record fresh evidence, then use the `finishing-a-development-branch` skill to merge the verified feature branch into `main` without touching the unrelated local files already present in the primary checkout.
