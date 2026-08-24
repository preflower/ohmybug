# OHMYBUG-18 Clean Recovery Design

## Problem

OHMYBUG-18 completed with local branch `ohmybug/ohmybug-18` at commit
`cf22433c118c3b43b86a54d595b6a5a9c934ad90`, but the commit contains 25,078
generated `.pnpm-store` paths in addition to six intended product and test files.
The Issue workspace captured `mergeToBaseBranch: false` before the project setting
was enabled, so finalization released the workspace without merging the branch into
`main`.

The repository also already tracks `.pnpm-store/v11/index.db` from OHMYBUG-17.
Adding an ignore rule alone would not remove that tracked cache file.

## Scope

This recovery will:

- rebuild the OHMYBUG-18 delivery commit with only its six intended file changes;
- update the local Issue branch and durable OHMYBUG-18 commit references together;
- merge the clean Issue branch into `main`;
- ignore `.pnpm-store/` and remove its currently tracked index database from Git;
- preserve all unrelated uncommitted files in the current `main` worktree.

This recovery will not change how active Issues snapshot or apply project Workspace
configuration. That behavior requires a separate design.

## Clean Commit Reconstruction

Create a new commit with the original OHMYBUG-18 parent
`7a8d4bf3a7e371a18d6adaa61535e4158161d757`. Populate its tree from that parent plus
the versions of these six paths in the original delivery commit:

- `apps/desktop/src/web/issues/issue-detail.tsx`
- `apps/desktop/src/web/styles/global.css`
- `apps/desktop/test/web/issues.test.tsx`
- `test/e2e/manual-workflow.spec.ts`
- `test/e2e/project-fixture.ts`
- `test/e2e/runtime-protocol-fixture.ts`

Preserve the original delivery subject. Validate the reconstructed tree before
moving any branch or database reference:

- its parent is the original base commit;
- its changed-path set is exactly the six paths above;
- it contains no `.pnpm-store`, `.oh-my-bug-tmp-*`, generated evidence, or build output;
- the intended six-file patch is identical to the non-store portion of the original
  delivery patch.

## Durable State Reconciliation

The branch is local-only because the Issue captured `pushToRemote: false`. Before
changing it, create a SQLite backup of the Runtime database and record the old branch
reference.

Move `ohmybug/ohmybug-18` to the validated clean commit, then update both durable
commit references for OHMYBUG-18 in one SQLite transaction:

- `module_resources.data_json.branchInfo.commit` for its Git Workspace resource;
- the `ISSUE_COMPLETED` event's `data_json.branch.commit`.

Do not change the Issue status, revision, timestamps, delivery content, binding, or
other event data. If the database transaction fails, restore the branch reference to
the old commit. Verify the branch and both database values agree before proceeding.

## Main Integration and Ignore Hygiene

The current `main` worktree contains unrelated user changes. Record its status and
verify that none of those tracked changes overlap the six OHMYBUG-18 paths or the
ignore cleanup. Do not stash, reset, stage, or rewrite those changes.

First prove that the clean Issue commit merges with the current `main`. Then perform
a normal merge so the clean Issue commit remains an ancestor of `main`. If Git refuses
because of local changes or reports a conflict, abort the merge and stop for user
direction.

After the feature merge, create a separate repository-hygiene commit that:

- adds `.pnpm-store/` to `.gitignore`;
- removes `.pnpm-store/v11/index.db` from Git tracking without deleting the local
  cache file.

Only the requested paths may be staged for either commit.

## Verification

Verification must establish all of the following:

- the rebuilt Issue commit changes exactly the six intended paths;
- its patch matches the intended portion of the original OHMYBUG-18 commit;
- `ohmybug/ohmybug-18` and both Runtime database records name the clean commit;
- the clean commit is an ancestor of `main`;
- `main` contains no tracked `.pnpm-store` path and `.gitignore` ignores the directory;
- the pre-existing unrelated worktree changes remain present and unstaged;
- targeted desktop tests, repository type checking, and the relevant browser workflow
  pass after integration.

If a verification step fails, preserve the backups and report the exact state rather
than attempting an unrelated cleanup.
