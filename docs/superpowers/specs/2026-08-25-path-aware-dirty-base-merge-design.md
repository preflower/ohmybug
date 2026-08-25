# Path-Aware Dirty Base Merge Design

**Date:** 2026-08-25

## Goal

Allow an approved Issue branch to merge into a checked-out base branch that contains unrelated local changes, while preserving every local change and continuing to reject any state that could be overwritten or made ambiguous by the merge.

## Problem

Automatic publication currently calls `assertWorktreeAndSubmodulesClean` before advancing a checked-out base branch. This rejects every tracked, staged, untracked, or configured-hidden local change, even when the Issue merge touches completely different paths.

`OHMYBUG-19` changes five sidebar layout, test, and design-document paths. The checked-out `main` branch contains six local changes in desktop startup and Codex prompt files. The sets do not overlap, but the repository-wide cleanliness gate returns `GIT_AUTO_MERGE_BASE_DIRTY` before Git can perform its own safe merge checks.

## Selected Approach

Replace the checked-out base's whole-worktree cleanliness requirement with a path-aware merge-safety check. Keep automatic stash and direct ref mutation out of scope.

For the proposed merge from `baseCommit` to `resultCommit`, the provider computes:

- paths changed by the merge result;
- tracked or staged paths that differ from the checked-out base HEAD;
- untracked non-ignored paths, independent of `status.showUntrackedFiles`;
- ignored paths that collide with the merge result;
- hidden index entries and initialized submodule state.

The merge is allowed only when local changed paths and merge-result paths are disjoint, including ancestor/descendant path relationships. For example, local `assets` conflicts with merged `assets/icon.png`, and local `assets/icon.png` conflicts with merged `assets`.

## Safety Rules

- Hidden `assume-unchanged` and `skip-worktree` index entries remain unsupported and fail closed.
- Initialized or populated submodule state remains subject to the existing strict cleanliness and gitlink protections.
- Ignored files that collide with a result path continue to fail closed.
- Tracked, staged, or untracked local paths that overlap a result path return `GIT_AUTO_MERGE_BASE_DIRTY` before the base branch moves.
- Unrelated local paths are preserved exactly across `git merge --ff-only`.
- A failure from Git's final merge check leaves the base commit and local state unchanged and is mapped to `GIT_AUTO_MERGE_BASE_DIRTY` when caused by local checkout state.
- A concurrent base-ref movement continues through the existing bounded recomputation path.

## Data Flow

1. Compute or recompute `resultCommit` from the observed base and Issue commit.
2. Verify hidden-index, submodule, ignored-file, and gitlink safety.
3. Read local tracked/staged changes with `git diff --name-only -z HEAD`.
4. Read untracked paths with `git ls-files --others --exclude-standard -z`.
5. Read merge-result paths with the existing commit diff helper.
6. Reject any exact, ancestor, or descendant collision.
7. Run `git merge --ff-only resultCommit` in the checked-out base worktree.
8. Verify through Git that the base moved without overwriting local state.

## Recovery Integration

The merge-environment preflight and unresolved-reason checks must use the same path-aware safety function. Otherwise a retry could remain stuck in recovery even though normal publication now accepts the workspace.

`FINALIZATION_FAILED -> RETRY_FINALIZATION` continues to reset the automatic recovery budget. No database migration or direct Issue-status mutation is introduced.

## Testing

Regression coverage will prove:

- an unrelated tracked local modification survives automatic merge;
- an unrelated staged local modification survives automatic merge with its staged state intact;
- an unrelated untracked file survives automatic merge even when `status.showUntrackedFiles=no`;
- exact and ancestor/descendant collisions fail without moving the base or changing local data;
- ignored collisions, hidden index entries, dirty submodules, and gitlink protections still fail;
- merge-environment preflight accepts unrelated local changes and rejects overlapping ones;
- the `OHMYBUG-19` path pattern succeeds with the current six unrelated local changes represented in a fixture.

## Non-Goals

- Automatically stashing, committing, resetting, or deleting local changes.
- Allowing dirty or ambiguous submodule state.
- Rebasing approved Issue branches.
- Updating a checked-out branch with `git update-ref` behind its index and worktree.
- Resolving semantic merge conflicts automatically.
