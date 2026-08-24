# Git Worktree Publication Hygiene Design

## Goal

Prevent accidental embedded Git repositories from entering an Issue delivery commit, release a verified-clean worktree safely even when Git detects nested repository metadata, and recover `OHMYBUG-13` without losing its implementation changes.

## Incident and root cause

`OHMYBUG-13` completed implementation and evidence review. During finalization, `GitWorkspace.publish()` ran `git add -A` over the complete Issue worktree. An Agent-created directory named `.oh-my-bug-tmp-m2qzxW` was not ignored by the product or the target repository. It contained an acceptance repository at `.oh-my-bug-tmp-m2qzxW/browser-acceptance-repo-yDT6je`.

Git staged that nested repository as a `160000` gitlink. The delivery commit was created and persisted in `branchInfo`, but `GitWorkspace.release()` then ran ordinary `git worktree remove`. Git refused with:

```text
fatal: working trees containing submodules cannot be moved or removed
```

The Runtime reduced this to `GIT_COMMAND_FAILED:worktree`, so the UI could only leave the Issue in the combined `APPROVED` state labelled “发布中 / 待重试”. The delivery commit and worktree remained intact.

## Scope

This change is intentionally limited to:

- rejecting accidental staged gitlinks that are not declared as submodules;
- guarded Git worktree release;
- regression coverage using a real nested Git repository;
- one-time recovery of the local-only `OHMYBUG-13` delivery branch and Runtime publication record.

It does not change Agent prompts, temporary-directory lifecycle, Runtime state transitions, or UI labels. It does not add general-purpose repository cleaning, delete arbitrary ignored files outside a released worktree, or automatically rewrite branches that have already been pushed to a remote.

## Design

### 1. Reject undeclared embedded repositories before commit

`GitWorkspace.publish()` keeps its existing `git add -A` behavior so intended tracked, deleted, and newly created files continue to publish without a new change-manifest protocol.

After staging and before committing, publication inspects staged entries with Git. A newly added or changed `160000` gitlink must have a corresponding declaration in the staged `.gitmodules` file. An undeclared gitlink is the Git representation produced by accidentally adding an embedded repository, regardless of the directory's name. Publication rejects it with `GIT_EMBEDDED_REPOSITORY_NOT_ALLOWED` and does not create the delivery commit.

Existing and newly declared project submodules remain supported. No path prefix, Prompt compliance, or guessed artifact name is part of this safety decision.

### 2. Guard worktree release before using force

Ordinary `git worktree remove` cannot remove a worktree containing an initialized submodule or nested repository. Adding `--force` without a guard would risk deleting user changes, so release will use a two-step safety gate:

1. Run `git status --porcelain` in the Issue worktree after the delivery commit has been persisted.
2. If Git reports any tracked, staged, or non-ignored untracked change, stop with `GIT_WORKTREE_NOT_CLEAN` and preserve the worktree.
3. If the status is empty, call `git worktree remove --force`.

The guard is independent of nested-repository names. `--force` is safe only after the worktree is proven clean; it allows Git to remove initialized legitimate submodules and the already-committed accidental gitlink in `OHMYBUG-13`. Ignored build output is disposable under the repository's own ignore policy, matching the existing release behavior that removes the entire clean worktree.

The delivered branch is retained exactly as today.

### 3. Recover `OHMYBUG-13`

`OHMYBUG-13` was configured for local delivery and was not pushed remotely. Recovery will rebuild its delivery commit from the same parent using only the intended feature files, excluding `.oh-my-bug-tmp-m2qzxW`. The local Issue branch and persisted `branchInfo.commit` will be updated together after verifying that the rebuilt tree contains the intended implementation and no undeclared gitlinks.

The Issue will then be retried through normal finalization. A clean release marks it `COMPLETED`; failure leaves the rebuilt branch and worktree available for another retry.

No forced rewrite is attempted for any remotely published branch.

## Testing

Tests use real temporary Git repositories and linked worktrees.

- A renamed embedded Git repository without a `.gitmodules` declaration is rejected before commit.
- A properly declared submodule and intended new source files are still committed.
- Release succeeds for a clean delivery commit whose worktree contains initialized submodule metadata.
- Release refuses to force-remove a worktree with tracked modifications, staged modifications, or unrelated untracked files.
- A failed publication remains retryable and reuses the stable delivery commit.
- `OHMYBUG-13` recovery verification checks the rebuilt commit tree, feature tests, branch pointer, Runtime event sequence, and final Issue status.

## Safety properties

- An undeclared embedded repository cannot enter a new delivery commit, regardless of its directory name.
- `--force` is never used before proving that user-authored changes are absent.
- A failed guard preserves the worktree and branch.
- Remote history is never rewritten automatically.
- Issue completion still occurs only after publish and release both succeed.
