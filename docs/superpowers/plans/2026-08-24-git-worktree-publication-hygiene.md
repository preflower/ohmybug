# Git Worktree Publication Hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reject undeclared embedded Git repositories before delivery commits, remove only verified-clean Git worktrees with force, and safely recover the local `OHMYBUG-13` delivery.

**Architecture:** Keep the change inside `@oh-my-bug/workspace-git`. Publication continues staging normal changes, then uses Git's submodule model to reject undeclared gitlinks. Release proves the worktree clean with porcelain status before using `git worktree remove --force`; the live Issue recovery is a separate, backed-up operational step.

**Tech Stack:** TypeScript, Node.js, Git CLI, Vitest, SQLite

---

## File structure

- Modify `packages/workspace-git/src/provider.ts`: add the publication gitlink guard and clean-release guard.
- Modify `packages/workspace-git/test/publish.test.ts`: reproduce undeclared embedded repositories and verify clean/dirty release behavior with real Git repositories.
- Read `apps/runtime/test/workspace-finalization.test.ts`: retain the existing approved-and-retryable Runtime contract; no Runtime production change is planned.
- Operationally update the local `ohmybug/ohmybug-13` branch and `~/.oh-my-bug/runtime.sqlite` only after code verification and an application-stop checkpoint.

### Task 1: Reject undeclared embedded Git repositories

**Files:**
- Modify: `packages/workspace-git/test/publish.test.ts`
- Modify: `packages/workspace-git/src/provider.ts:349-368`

- [ ] **Step 1: Write the failing embedded-repository test**

Add a test that creates a nested Git repository under an arbitrary name, proving the protection is structural rather than prefix-based:

```ts
it("rejects an embedded repository that is not declared as a submodule", async () => {
  const fixture = await createGitFixture();
  cleanups.push(fixture.cleanup);
  const provider = gitWorkspaceFactory({
    state: fixture.state,
    worktreeRoot: fixture.worktreeRoot,
  }).create({ baseBranch: "main", pushToRemote: false });
  const acquired = await provider.acquire({ issue: fixture.issue, project: fixture.project });
  const before = await git(acquired.projectPath, "rev-parse", "HEAD");
  const embedded = join(acquired.projectPath, "renamed-acceptance-repository");
  await mkdir(embedded);
  await git(embedded, "init", "-b", "main");
  await git(embedded, "config", "user.name", "Embedded Test");
  await git(embedded, "config", "user.email", "embedded@ohmybug.local");
  await writeFile(join(embedded, "README.md"), "temporary repository\n");
  await git(embedded, "add", "README.md");
  await git(embedded, "commit", "-m", "temporary repository");
  await writeFile(join(acquired.projectPath, "fixed.txt"), "fixed\n");
  const approved = {
    ...fixture.issue,
    projectPath: acquired.projectPath,
    status: "APPROVED" as const,
    resolution: "FIXED" as const,
  };

  await expect(provider.publish({ issue: approved, resourceId: "git:issue-1" }))
    .rejects.toThrow("GIT_EMBEDDED_REPOSITORY_NOT_ALLOWED");

  expect(await git(acquired.projectPath, "rev-parse", "HEAD")).toBe(before);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/workspace-git exec vitest run test/publish.test.ts -t "rejects an embedded repository"
```

Expected: FAIL because current publication creates a commit instead of throwing `GIT_EMBEDDED_REPOSITORY_NOT_ALLOWED`.

- [ ] **Step 3: Add the minimal staged-gitlink guard**

Call the guard immediately after `git add -A` and before `git commit`:

```ts
await runGit(state.worktreePath, ["add", "-A"]);
await assertNoUndeclaredGitlinks(state.worktreePath);
```

Add a focused helper near the existing provider helpers:

```ts
async function assertNoUndeclaredGitlinks(worktreePath: string): Promise<void> {
  try {
    await runGit(worktreePath, ["submodule", "status"]);
  } catch (error) {
    throw new Error("GIT_EMBEDDED_REPOSITORY_NOT_ALLOWED", { cause: error });
  }
}
```

Git exits successfully for no submodules, uninitialized declared submodules, and initialized declared submodules. It fails for the incident shape: a `160000` gitlink without a `.gitmodules` mapping.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the Step 2 command again.

Expected: PASS; Git may print its normal embedded-repository warning, but no delivery commit is created.

- [ ] **Step 5: Add a declared-submodule compatibility test**

Create a real source repository, add it with an explicit `.gitmodules` declaration, and assert publication succeeds:

```ts
it("publishes a properly declared submodule", async () => {
  const fixture = await createGitFixture();
  cleanups.push(fixture.cleanup);
  const source = join(fixture.root, "declared-source");
  await mkdir(source);
  await git(source, "init", "-b", "main");
  await git(source, "config", "user.name", "Submodule Test");
  await git(source, "config", "user.email", "submodule@ohmybug.local");
  await writeFile(join(source, "README.md"), "declared submodule\n");
  await git(source, "add", "README.md");
  await git(source, "commit", "-m", "declared submodule");
  const provider = gitWorkspaceFactory({
    state: fixture.state,
    worktreeRoot: fixture.worktreeRoot,
  }).create({ baseBranch: "main", pushToRemote: false });
  const acquired = await provider.acquire({ issue: fixture.issue, project: fixture.project });
  await git(
    acquired.projectPath,
    "-c",
    "protocol.file.allow=always",
    "submodule",
    "add",
    source,
    "vendor/declared",
  );
  const approved = {
    ...fixture.issue,
    projectPath: acquired.projectPath,
    status: "APPROVED" as const,
    resolution: "FIXED" as const,
  };

  const branch = await provider.publish({ issue: approved, resourceId: "git:issue-1" });

  expect(branch.name).toBe("ohmybug/omb-1");
  expect(await git(acquired.projectPath, "status", "--porcelain")).toBe("");
});
```

- [ ] **Step 6: Run all publication tests**

Run:

```bash
pnpm --filter @oh-my-bug/workspace-git exec vitest run test/publish.test.ts
```

Expected: all tests PASS.

- [ ] **Step 7: Commit the gitlink guard**

```bash
git add packages/workspace-git/src/provider.ts packages/workspace-git/test/publish.test.ts
git commit -m "fix: reject undeclared embedded repositories"
```

### Task 2: Force-remove only a verified-clean worktree

**Files:**
- Modify: `packages/workspace-git/test/publish.test.ts`
- Modify: `packages/workspace-git/src/provider.ts:390-397`

- [ ] **Step 1: Write failing dirty-release tests**

Add one test for tracked changes and one for unrelated untracked content. Each publishes first, changes the worktree afterward, expects `GIT_WORKTREE_NOT_CLEAN`, and verifies the worktree still exists:

```ts
it.each([
  ["tracked", async (path: string) => writeFile(join(path, "README.md"), "changed\n")],
  ["untracked", async (path: string) => writeFile(join(path, "local-note.txt"), "keep me\n")],
])("preserves a worktree with %s changes during release", async (_kind, change) => {
  const fixture = await createGitFixture();
  cleanups.push(fixture.cleanup);
  const provider = gitWorkspaceFactory({
    state: fixture.state,
    worktreeRoot: fixture.worktreeRoot,
  }).create({ baseBranch: "main", pushToRemote: false });
  const acquired = await provider.acquire({ issue: fixture.issue, project: fixture.project });
  const approved = {
    ...fixture.issue,
    projectPath: acquired.projectPath,
    status: "APPROVED" as const,
    resolution: "FIXED" as const,
  };
  await provider.publish({ issue: approved, resourceId: "git:issue-1" });
  await change(acquired.projectPath);

  await expect(provider.release({ issue: approved, resourceId: "git:issue-1" }))
    .rejects.toThrow("GIT_WORKTREE_NOT_CLEAN");

  await expect(access(acquired.projectPath)).resolves.toBeUndefined();
});
```

- [ ] **Step 2: Extend the declared-submodule test to require successful release**

After publishing the initialized declared submodule, call `provider.release()` and assert the worktree path disappears. Current ordinary removal must fail with Git's “working trees containing submodules” error.

- [ ] **Step 3: Run the new release tests and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/workspace-git exec vitest run test/publish.test.ts -t "release|submodule"
```

Expected: the dirty tests fail because current code returns `GIT_COMMAND_FAILED:worktree`; the initialized-submodule test fails because ordinary worktree removal is refused.

- [ ] **Step 4: Add the clean-release guard and force removal**

Replace the final release command with:

```ts
const changes = await runGit(state.worktreePath, ["status", "--porcelain"]);
if (changes) throw new Error("GIT_WORKTREE_NOT_CLEAN");
await runGit(state.repositoryPath, [
  "worktree",
  "remove",
  "--force",
  state.worktreePath,
]);
```

Keep the existing missing-path prune behavior unchanged.

- [ ] **Step 5: Run publication tests and verify GREEN**

Run:

```bash
pnpm --filter @oh-my-bug/workspace-git exec vitest run test/publish.test.ts
```

Expected: all publication tests PASS, including clean ordinary release, declared-submodule release, and both dirty preservation cases.

- [ ] **Step 6: Commit guarded release**

```bash
git add packages/workspace-git/src/provider.ts packages/workspace-git/test/publish.test.ts
git commit -m "fix: guard forced git worktree release"
```

### Task 3: Verify package and Runtime contracts

**Files:**
- Verify: `packages/workspace-git/test/*.test.ts`
- Verify: `apps/runtime/test/workspace-finalization.test.ts`

- [ ] **Step 1: Run the complete Git Workspace suite**

```bash
pnpm --filter @oh-my-bug/workspace-git test
```

Expected: all tests PASS.

- [ ] **Step 2: Run Git Workspace type checking**

```bash
pnpm --filter @oh-my-bug/workspace-git typecheck
```

Expected: exit code 0 with no TypeScript errors.

- [ ] **Step 3: Run Runtime finalization regression tests**

```bash
pnpm --filter @oh-my-bug/runtime exec vitest run test/workspace-finalization.test.ts
```

Expected: all tests PASS, including failed publication remaining `APPROVED` and retryable.

- [ ] **Step 4: Run repository checks scoped to changed files**

```bash
pnpm exec oxlint packages/workspace-git/src/provider.ts packages/workspace-git/test/publish.test.ts
git diff --check HEAD~2..HEAD
```

Expected: both commands exit 0.

### Task 4: Recover `OHMYBUG-13` after an application-stop checkpoint

**Files and state:**
- Rewrite local-only branch: `ohmybug/ohmybug-13`
- Update after backup: `/Users/starrblink/.oh-my-bug/runtime.sqlite`
- Preserve unrelated working-tree changes in the main checkout.

- [ ] **Step 1: Stop and confirm the application is not writing Runtime state**

Ask the user to quit Oh My Bug ?!, then run:

```bash
pgrep -fl "[O]h My Bug|apps/runtime/src/entry" || true
```

Expected: no Oh My Bug ?! desktop or Runtime process. Do not continue while a matching process remains; this is a hard operational checkpoint.

- [ ] **Step 2: Reconfirm local-only recovery preconditions read-only**

```bash
git branch --contains 401b21ad4e19a70b38abc6f2ea279ac916568680
git branch -r --contains 401b21ad4e19a70b38abc6f2ea279ac916568680
git -C /Users/starrblink/.oh-my-bug/worktrees/8658b7f1-5784-4a50-9e06-072e38389e27/e7318938-f4dd-458a-ac94-b844e690572f status --short
```

Expected: only local `ohmybug/ohmybug-13` contains the commit, no remote branch contains it, and the Issue worktree is clean.

- [ ] **Step 3: Checkpoint and back up Runtime state**

Use a fixed, validated backup target and checkpoint the WAL before copying:

```bash
omb_recovery_backup=/Users/starrblink/.oh-my-bug/backups/ohmybug-13-pre-recovery-20260824
test ! -e "$omb_recovery_backup"
mkdir -p "$omb_recovery_backup"
sqlite3 /Users/starrblink/.oh-my-bug/runtime.sqlite "PRAGMA wal_checkpoint(TRUNCATE);"
cp /Users/starrblink/.oh-my-bug/runtime.sqlite "$omb_recovery_backup/runtime.sqlite"
test ! -f /Users/starrblink/.oh-my-bug/runtime.sqlite-wal || cp /Users/starrblink/.oh-my-bug/runtime.sqlite-wal "$omb_recovery_backup/runtime.sqlite-wal"
test ! -f /Users/starrblink/.oh-my-bug/runtime.sqlite-shm || cp /Users/starrblink/.oh-my-bug/runtime.sqlite-shm "$omb_recovery_backup/runtime.sqlite-shm"
ls -la "$omb_recovery_backup"
```

Expected: the checkpoint reports no busy writers and the backup directory contains `runtime.sqlite` plus any companions that still exist. Record `/Users/starrblink/.oh-my-bug/backups/ohmybug-13-pre-recovery-20260824` before mutation.

- [ ] **Step 4: Rebuild the local delivery commit without the accidental temp tree**

In the Issue worktree, remove only `.oh-my-bug-tmp-m2qzxW` from the commit and amend without changing the message:

```bash
git rm -r -- .oh-my-bug-tmp-m2qzxW
git commit --amend --no-edit
```

Capture the new commit as `clean_commit`. Verify:

```bash
git ls-tree -r --name-only HEAD
git ls-files --stage
git diff HEAD^ -- apps/desktop/src/web/projects/git-workspace-fields.tsx apps/desktop/test/electron/e2e/git-workspace.spec.ts apps/desktop/test/web/projects.test.tsx packages/workspace-git/src/provider.ts packages/workspace-git/test/acquire.test.ts packages/workspace-git/test/inspection.test.ts packages/workspace-git/test/publish.test.ts
```

Expected: no `.oh-my-bug-tmp-*` path, no undeclared `160000` entry, and all intended `OHMYBUG-13` feature changes remain.

- [ ] **Step 5: Clear stale publication metadata transactionally**

After verifying `json_extract(data_json, '$.branchInfo.commit')` still equals the old commit, update only the `workspace-git` resource `git:e7318938-f4dd-458a-ac94-b844e690572f`:

```sql
BEGIN IMMEDIATE;
UPDATE module_resources
SET data_json = json_remove(data_json, '$.branchInfo')
WHERE module_id = 'workspace-git'
  AND resource_id = 'git:e7318938-f4dd-458a-ac94-b844e690572f'
  AND json_extract(data_json, '$.branchInfo.commit') = '401b21ad4e19a70b38abc6f2ea279ac916568680';
SELECT changes();
COMMIT;
```

Expected: `changes()` is exactly `1`. Any other result requires rollback/restoration from the backup before proceeding.

- [ ] **Step 6: Start the updated application and retry publication once**

Build the updated Electron Runtime, then start the development desktop:

```bash
pnpm build:electron
pnpm dev
```

After the window opens, open `OHMYBUG-13` and select “重试发布” once. Do not retry repeatedly if it fails; stop the development process and inspect the new `WORKSPACE_PUBLISH_FAILED` event first.

- [ ] **Step 7: Verify final state read-only**

Verify that:

- `OHMYBUG-13` is `COMPLETED`;
- the latest `ISSUE_COMPLETED` event records `clean_commit`;
- the workspace binding is `RELEASED`;
- the Issue worktree path no longer exists;
- `ohmybug/ohmybug-13` still points to `clean_commit`;
- `git fsck --no-reflogs --unreachable` is diagnostic only; no garbage collection or destructive cleanup is performed.

If verification fails, stop and restore Runtime state from the recorded backup before another mutation.
