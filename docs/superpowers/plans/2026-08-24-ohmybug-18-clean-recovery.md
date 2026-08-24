# OHMYBUG-18 Clean Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild OHMYBUG-18 without generated pnpm cache content, reconcile its durable delivery record, merge the clean branch into `main`, and prevent `.pnpm-store` from being tracked again.

**Architecture:** Use Git plumbing with an isolated temporary index to reconstruct the Issue commit from its original parent and the exact six-path intended patch. Validate the new commit before moving any reference, back up and reconcile the Runtime SQLite records transactionally, then integrate through a normal merge while preserving the dirty `main` worktree. Finish with a separate ignore-hygiene commit and end-to-end verification.

**Tech Stack:** Git 2.38+, SQLite 3 with JSON1, pnpm, TypeScript 6, Vitest 4, Playwright

---

## File and state map

- Reconstruct `refs/heads/ohmybug/ohmybug-18`: replace the polluted local commit with a clean commit that has the same parent and only six intended file changes.
- Update `/Users/starrblink/.oh-my-bug/runtime.sqlite`: reconcile the Git Workspace `branchInfo.commit` and OHMYBUG-18 `ISSUE_COMPLETED` event after an online SQLite backup.
- Merge into `refs/heads/main`: preserve the clean Issue commit as an ancestor through a normal merge commit.
- Modify `.gitignore`: add `.pnpm-store/` near the other dependency/build ignores.
- Untrack `.pnpm-store/v11/index.db`: remove the generated database from Git while leaving the local file intact.
- Preserve these current unrelated unstaged changes:
  - `apps/desktop/scripts/dev.cjs`
  - `apps/desktop/test/electron/dev-entry.test.ts`
  - `packages/agent-codex/src/output-schemas.ts`
  - `packages/agent-codex/src/prompts.ts`
  - `packages/agent-codex/test/assessment.test.ts`
  - `packages/agent-codex/test/repair.test.ts`

### Task 1: Establish immutable recovery inputs and safety gates

**Files and state:**
- Read: `docs/superpowers/specs/2026-08-24-ohmybug-18-clean-recovery-design.md`
- Read: `/Users/starrblink/.oh-my-bug/runtime.sqlite`
- Read: `refs/heads/main`
- Read: `refs/heads/ohmybug/ohmybug-18`

- [ ] **Step 1: Start one shell session and define exact recovery constants**

Run all state-changing commands in the same shell session so the validated commit and backup paths cannot be confused:

```bash
OH18_ORIGINAL_COMMIT=cf22433c118c3b43b86a54d595b6a5a9c934ad90
OH18_PARENT_COMMIT=7a8d4bf3a7e371a18d6adaa61535e4158161d757
OH18_BRANCH_REF=refs/heads/ohmybug/ohmybug-18
OH18_ISSUE_ID=98a5e346-e9c8-4a17-953a-56323a47f587
OH18_RESOURCE_ID=git:98a5e346-e9c8-4a17-953a-56323a47f587
OH18_DB=/Users/starrblink/.oh-my-bug/runtime.sqlite
OH18_TEMP_DIR="$(mktemp -d /private/tmp/ohmybug-18-recovery.XXXXXX)"
OH18_PATHS=(
  apps/desktop/src/web/issues/issue-detail.tsx
  apps/desktop/src/web/styles/global.css
  apps/desktop/test/web/issues.test.tsx
  test/e2e/manual-workflow.spec.ts
  test/e2e/project-fixture.ts
  test/e2e/runtime-protocol-fixture.ts
)
```

Expected: `OH18_TEMP_DIR` is an empty directory under `/private/tmp`.

- [ ] **Step 2: Verify refs, commit shape, and local-only delivery**

Run:

```bash
test "$(git rev-parse "$OH18_BRANCH_REF")" = "$OH18_ORIGINAL_COMMIT"
test "$(git rev-parse "$OH18_ORIGINAL_COMMIT^")" = "$OH18_PARENT_COMMIT"
git branch -r --contains "$OH18_ORIGINAL_COMMIT"
sqlite3 -readonly -json "$OH18_DB" "
SELECT json_extract(data_json, '$.pushToRemote') AS push_to_remote,
       json_extract(data_json, '$.branchInfo.commit') AS workspace_commit
FROM module_resources
WHERE module_id = 'workspace-git' AND resource_id = '$OH18_RESOURCE_ID';
SELECT json_extract(data_json, '$.branch.commit') AS event_commit
FROM issue_events
WHERE issue_id = '$OH18_ISSUE_ID' AND event_type = 'ISSUE_COMPLETED';"
```

Expected: the remote-branch command prints nothing; `push_to_remote` is `0`; both stored commits equal `cf22433c118c3b43b86a54d595b6a5a9c934ad90`.

- [ ] **Step 3: Verify the staged index is empty and snapshot unrelated worktree changes**

Run:

```bash
git diff --cached --quiet
git status --short
git diff --binary > "$OH18_TEMP_DIR/preexisting-worktree.patch"
git diff --name-only > "$OH18_TEMP_DIR/preexisting-tracked-paths.txt"
```

Expected: no staged changes. The tracked-path snapshot contains the six unrelated files listed in the file map and none of the six OHMYBUG-18 paths or `.gitignore`.

- [ ] **Step 4: Reject any path overlap before continuing**

Run:

```bash
comm -12 \
  <(sort "$OH18_TEMP_DIR/preexisting-tracked-paths.txt") \
  <(printf '%s\n' "${OH18_PATHS[@]}" .gitignore .pnpm-store/v11/index.db | sort)
```

Expected: no output. Any output is a stop condition; do not reconstruct or move refs.

### Task 2: Reconstruct and validate the clean Issue commit

**Files and state:**
- Create temporary: `$OH18_TEMP_DIR/original-intended.patch`
- Create temporary: `$OH18_TEMP_DIR/clean-intended.patch`
- Create temporary Git index: `$OH18_TEMP_DIR/index`
- Create Git objects only; do not move a ref yet.

- [ ] **Step 1: Extract only the six-path intended patch**

Run:

```bash
git diff --binary "$OH18_PARENT_COMMIT" "$OH18_ORIGINAL_COMMIT" -- "${OH18_PATHS[@]}" \
  > "$OH18_TEMP_DIR/original-intended.patch"
test -s "$OH18_TEMP_DIR/original-intended.patch"
```

Expected: a non-empty patch containing changes only for the six listed paths.

- [ ] **Step 2: Apply the patch to an isolated temporary index**

Run:

```bash
GIT_INDEX_FILE="$OH18_TEMP_DIR/index" git read-tree "$OH18_PARENT_COMMIT"
GIT_INDEX_FILE="$OH18_TEMP_DIR/index" git apply --cached --check \
  "$OH18_TEMP_DIR/original-intended.patch"
GIT_INDEX_FILE="$OH18_TEMP_DIR/index" git apply --cached \
  "$OH18_TEMP_DIR/original-intended.patch"
OH18_CLEAN_TREE="$(GIT_INDEX_FILE="$OH18_TEMP_DIR/index" git write-tree)"
```

Expected: all commands exit successfully and no working-tree file changes.

- [ ] **Step 3: Create the clean commit object without moving the branch**

Run:

```bash
OH18_CLEAN_COMMIT="$(git commit-tree "$OH18_CLEAN_TREE" \
  -p "$OH18_PARENT_COMMIT" \
  -m 'OHMYBUG-18: 为图片预览添加局部缩放功能')"
git show -s --format='commit=%H%nparent=%P%nsubject=%s' "$OH18_CLEAN_COMMIT"
```

Expected: a new commit hash, parent `7a8d4bf3a7e371a18d6adaa61535e4158161d757`, and the original subject.

- [ ] **Step 4: Prove exact path and patch equivalence**

Run:

```bash
diff -u \
  <(printf '%s\n' "${OH18_PATHS[@]}" | sort) \
  <(git diff-tree --no-commit-id --name-only -r "$OH18_CLEAN_COMMIT" | sort)
git diff --binary "$OH18_PARENT_COMMIT" "$OH18_CLEAN_COMMIT" -- "${OH18_PATHS[@]}" \
  > "$OH18_TEMP_DIR/clean-intended.patch"
cmp "$OH18_TEMP_DIR/original-intended.patch" "$OH18_TEMP_DIR/clean-intended.patch"
```

Expected: both comparisons exit `0` with no output.

- [ ] **Step 5: Prove the clean tree contains no generated delivery pollution**

Run:

```bash
if git ls-tree -r --name-only "$OH18_CLEAN_COMMIT" \
  | rg '(^|/)(\.pnpm-store|\.oh-my-bug-tmp-[^/]*)(/|$)'; then
  exit 1
fi
git diff --check "$OH18_PARENT_COMMIT" "$OH18_CLEAN_COMMIT"
```

Expected: no generated path and no whitespace error.

### Task 3: Reconcile the local branch and durable Runtime records

**Files and state:**
- Create backup: `/Users/starrblink/.oh-my-bug/backups/ohmybug-18-clean-recovery-20260824-*/runtime.sqlite`
- Update: `refs/heads/ohmybug/ohmybug-18`
- Update: `/Users/starrblink/.oh-my-bug/runtime.sqlite`

- [ ] **Step 1: Create an online SQLite backup before any reference moves**

Run with approval to write under `/Users/starrblink/.oh-my-bug/backups`:

```bash
OH18_BACKUP_DIR="$(mktemp -d /Users/starrblink/.oh-my-bug/backups/ohmybug-18-clean-recovery-20260824-XXXXXX)"
sqlite3 "$OH18_DB" ".backup '$OH18_BACKUP_DIR/runtime.sqlite'"
sqlite3 -readonly "$OH18_BACKUP_DIR/runtime.sqlite" "PRAGMA integrity_check;"
```

Expected: `integrity_check` prints `ok`.

- [ ] **Step 2: Move the local Issue branch with compare-and-swap protection**

Run:

```bash
git update-ref "$OH18_BRANCH_REF" "$OH18_CLEAN_COMMIT" "$OH18_ORIGINAL_COMMIT"
test "$(git rev-parse "$OH18_BRANCH_REF")" = "$OH18_CLEAN_COMMIT"
```

Expected: the branch points to the validated clean commit. A compare-and-swap failure is a stop condition.

- [ ] **Step 3: Update both durable commit references in one checked transaction**

Run with approval to update `/Users/starrblink/.oh-my-bug/runtime.sqlite`:

```bash
sqlite3 "$OH18_DB" ".bail on
CREATE TEMP TABLE assert_one(value INTEGER CHECK(value = 1));
BEGIN IMMEDIATE;
UPDATE module_resources
SET data_json = json_set(data_json, '$.branchInfo.commit', '$OH18_CLEAN_COMMIT')
WHERE module_id = 'workspace-git'
  AND resource_id = '$OH18_RESOURCE_ID'
  AND json_extract(data_json, '$.branchInfo.commit') = '$OH18_ORIGINAL_COMMIT';
INSERT INTO assert_one VALUES(changes());
DELETE FROM assert_one;
UPDATE issue_events
SET data_json = json_set(data_json, '$.branch.commit', '$OH18_CLEAN_COMMIT')
WHERE issue_id = '$OH18_ISSUE_ID'
  AND event_type = 'ISSUE_COMPLETED'
  AND json_extract(data_json, '$.branch.commit') = '$OH18_ORIGINAL_COMMIT';
INSERT INTO assert_one VALUES(changes());
COMMIT;"
```

Expected: exit `0`. If it fails, immediately restore the branch with `git update-ref "$OH18_BRANCH_REF" "$OH18_ORIGINAL_COMMIT" "$OH18_CLEAN_COMMIT"` and stop.

- [ ] **Step 4: Verify all three clean commit references agree**

Run:

```bash
git rev-parse "$OH18_BRANCH_REF"
sqlite3 -readonly -json "$OH18_DB" "
SELECT json_extract(data_json, '$.branchInfo.commit') AS workspace_commit
FROM module_resources
WHERE module_id = 'workspace-git' AND resource_id = '$OH18_RESOURCE_ID';
SELECT json_extract(data_json, '$.branch.commit') AS event_commit
FROM issue_events
WHERE issue_id = '$OH18_ISSUE_ID' AND event_type = 'ISSUE_COMPLETED';"
```

Expected: all three values equal `$OH18_CLEAN_COMMIT`.

### Task 4: Merge the clean Issue branch into `main`

**Files and state:**
- Update: `refs/heads/main`
- Merge the six intended feature paths through Git; do not stage unrelated changes.

- [ ] **Step 1: Re-run the dirty-worktree safety gates**

Run:

```bash
test "$(git branch --show-current)" = main
git diff --cached --quiet
git diff --binary | cmp "$OH18_TEMP_DIR/preexisting-worktree.patch" -
comm -12 \
  <(git diff --name-only | sort) \
  <(printf '%s\n' "${OH18_PATHS[@]}" | sort)
```

Expected: the patch comparison exits `0` and the overlap command prints nothing. If the user's worktree changed during recovery, stop and reassess rather than overwriting it.

- [ ] **Step 2: Prove the committed histories merge without conflicts**

Run:

```bash
git merge-tree --write-tree main "$OH18_CLEAN_COMMIT"
```

Expected: one tree hash and exit `0`. Exit `1` or conflict output is a stop condition.

- [ ] **Step 3: Perform the normal merge**

Run:

```bash
git merge --no-ff --no-edit ohmybug/ohmybug-18
```

Expected: a merge commit named `Merge branch 'ohmybug/ohmybug-18'`; the unrelated unstaged changes remain unstaged. If Git refuses before merging, stop. If an unexpected merge conflict begins, run `git merge --abort`, verify the pre-existing patch snapshot, and stop.

- [ ] **Step 4: Verify feature ancestry and preserved local changes**

Run:

```bash
git merge-base --is-ancestor "$OH18_CLEAN_COMMIT" main
git diff --binary | cmp "$OH18_TEMP_DIR/preexisting-worktree.patch" -
git diff --cached --quiet
```

Expected: all commands exit `0`.

### Task 5: Ignore the pnpm store and remove its tracked database

**Files:**
- Modify: `.gitignore`
- Remove from Git only: `.pnpm-store/v11/index.db`

- [ ] **Step 1: Add the repository ignore rule**

Insert immediately after `node_modules/` in `.gitignore`:

```gitignore
.pnpm-store/
```

- [ ] **Step 2: Remove the existing database from the Git index only**

Run:

```bash
test -f .pnpm-store/v11/index.db
git update-index --force-remove -- .pnpm-store/v11/index.db
git add -- .gitignore
git diff --cached --name-status
```

Expected exactly:

```text
M	.gitignore
D	.pnpm-store/v11/index.db
```

The local `.pnpm-store/v11/index.db` file must still exist.

- [ ] **Step 3: Verify the ignore rule and staged diff**

Run:

```bash
git check-ignore -v .pnpm-store/v11/index.db
git diff --cached --check
git diff --cached --stat
```

Expected: `git check-ignore` identifies the new `.pnpm-store/` rule; the staged diff contains only `.gitignore` and the tracked database deletion.

- [ ] **Step 4: Commit repository hygiene separately**

Run:

```bash
git commit -m "chore: ignore pnpm store"
```

Expected: one commit changing `.gitignore` and deleting `.pnpm-store/v11/index.db` from Git tracking.

### Task 6: Verify the integrated delivery

**Files and state:**
- Test the merged desktop feature and repository.
- Read final Git, Runtime database, and worktree state.

- [ ] **Step 1: Run the focused desktop tests**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run test/web/issues.test.tsx
```

Expected: the focused file passes with no failed tests.

- [ ] **Step 2: Run repository type checking**

Run:

```bash
pnpm typecheck
```

Expected: all workspace and repository TypeScript checks exit `0`.

- [ ] **Step 3: Run the browser workflow that exercises image preview zoom**

Run:

```bash
pnpm exec playwright test test/e2e/manual-workflow.spec.ts --project=chromium
```

Expected: `1 passed` and no failed browser test.

- [ ] **Step 4: Verify final Git and Runtime invariants**

Run:

```bash
git merge-base --is-ancestor "$OH18_CLEAN_COMMIT" main
test "$(git rev-parse "$OH18_BRANCH_REF")" = "$OH18_CLEAN_COMMIT"
test -z "$(git ls-tree -r --name-only main .pnpm-store)"
git check-ignore -q .pnpm-store/v11/index.db
test -f .pnpm-store/v11/index.db
sqlite3 -readonly "$OH18_DB" "PRAGMA integrity_check;"
sqlite3 -readonly -json "$OH18_DB" "
SELECT i.identifier, i.status, b.status AS binding_status,
       json_extract(m.data_json, '$.branchInfo.commit') AS workspace_commit,
       json_extract(e.data_json, '$.branch.commit') AS event_commit
FROM issues i
JOIN workspace_bindings b ON b.issue_id = i.id
JOIN module_resources m ON m.module_id = 'workspace-git' AND m.resource_id = b.resource_id
JOIN issue_events e ON e.issue_id = i.id AND e.event_type = 'ISSUE_COMPLETED'
WHERE i.id = '$OH18_ISSUE_ID';"
```

Expected: Git checks exit `0`; SQLite integrity is `ok`; OHMYBUG-18 remains `COMPLETED`, binding remains `RELEASED`, and both durable commit fields equal `$OH18_CLEAN_COMMIT`.

- [ ] **Step 5: Confirm unrelated user changes were preserved and report commits**

Run:

```bash
git diff --binary | cmp "$OH18_TEMP_DIR/preexisting-worktree.patch" -
git diff --cached --quiet
git status --short
git log --oneline --decorate -n 5
```

Expected: the original unrelated patch is byte-identical and unstaged; `.pnpm-store` no longer appears in status; the log shows the OHMYBUG-18 merge and `chore: ignore pnpm store` commits.
