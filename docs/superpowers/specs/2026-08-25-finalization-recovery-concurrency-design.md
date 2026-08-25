# Finalization Recovery Concurrency Design

**Date:** 2026-08-25

## Goal

Prevent safe delivery recovery from failing when another Issue updates an unrelated Git branch, safely normalize generated package-manager state on older Issue branches, and keep automatic merges into `main` correct when several Issues finalize concurrently.

## Problem

`OHMYBUG-19` exposed two recovery-boundary defects:

1. The recovery fingerprint hashes every local and remote ref. All Issue worktrees share one Git repository, so an unrelated branch update changes the fingerprint and produces `FINALIZATION_RECOVERY_REPOSITORY_STATE_CHANGED` even when the recovering Issue's HEAD, index, and delivery files are unchanged.
2. Generated paths under `.pnpm-store` are collapsed to the whole `.pnpm-store` root. Older Issue branches can contain a tracked `.pnpm-store/v11/index.db` alongside untracked generated cache trees. The current validator requires the diagnostic root to be entirely untracked, so a safe cleanup cannot pass. Leaving the tracked cache dirty is also unsafe because a later publish would commit it.

Automatic merge already creates a result with `merge-tree` and `commit-tree`, then advances the base ref with compare-and-swap semantics. A concurrent base update can still make that single attempt fail even when recomputing against the new base would merge cleanly.

## Recovery Fingerprint Boundary

The recovery fingerprint will continue to protect:

- the recovering worktree's HEAD commit;
- the recovering worktree's symbolic HEAD ref;
- the real Git index entries and index flags;
- tracked and approved untracked delivery content;
- repository-local Git configuration, because changing it can alter publication behavior.

It will no longer hash every `refs/heads/*` and `refs/remotes/*` entry. Unrelated Issue and remote-tracking ref movements do not mutate the recovering worktree. Movement of the recovering branch remains detectable through `rev-parse HEAD` and `symbolic-ref HEAD`.

## Generated Artifact Normalization

Diagnostic roots remain policy roots such as `.pnpm-store`, but validation distinguishes tracked entries from untracked generated entries inside each root.

After recovery:

- every untracked generated entry under a diagnostic root must be gone;
- every tracked path under a diagnostic root must exactly match its `HEAD` version;
- restoring a tracked generated path exactly to `HEAD` is safe normalization and does not invalidate approved delivery content;
- deleting a tracked generated path, changing it to any non-HEAD content, staging changes, or touching tracked content outside the generated root continues to require revalidation or fail safe;
- new non-generated paths and remaining generated artifacts continue to fail safe.

This permits the `OHMYBUG-19` cleanup: remove `.pnpm-store/v11/files` and `.pnpm-store/v11/tmp`, then restore the tracked `.pnpm-store/v11/index.db` exactly to `HEAD`.

The Agent prompt and fingerprint summary will state this boundary explicitly: remove untracked generated content, restore tracked generated content to `HEAD`, and never delete or invent tracked content.

## Concurrent Merge Into Main

The provider keeps the existing non-checkout merge algorithm:

1. Read the current base commit.
2. Compute the merge tree without mutating a worktree.
3. Create a merge commit whose parents are the observed base and Issue commits.
4. Advance the base ref only if it still equals the observed base.

If the base ref advanced concurrently, the provider rereads it and recomputes the merge against the newer base. Retries are bounded. A real content conflict, dirty checked-out base worktree, unsafe gitlink update, or repeated contention still returns the existing finalization failure instead of overwriting another delivery.

Rebase is not part of finalization. It rewrites the approved Issue history and does not prevent shared-ref movement.

## Error Handling

- An unrelated branch movement is ignored by recovery validation.
- A recovering branch HEAD or symbolic-ref movement remains `UNSAFE`.
- A local Git configuration mutation remains `UNSAFE`.
- A tracked generated path not restored to `HEAD` produces a bounded unsafe diagnostic listing the affected path.
- Exhausted base-advance retries produce `GIT_AUTO_MERGE_FAILED` with the original Git error as cause.
- Merge conflicts continue to produce `GIT_AUTO_MERGE_CONFLICT` without retrying the same base.

## Testing

Regression tests will prove:

- creating or advancing an unrelated Issue branch during recovery no longer changes the validation outcome;
- switching or detaching the recovering worktree's HEAD remains unsafe;
- repository-local Git configuration changes remain unsafe;
- a mixed `.pnpm-store` containing a tracked dirty index plus untracked cache validates only after the cache is removed and the tracked index is restored exactly to `HEAD`;
- deleting or incorrectly modifying that tracked index does not auto-retry delivery;
- two concurrent clean Issue deliveries both reach `main` without losing either commit;
- merge conflicts and dirty base-worktree protections remain unchanged.

## Non-Goals

- General cleanup of arbitrary ignored directories.
- Rebasing approved Issue branches.
- Retrying semantic merge conflicts.
- Weakening HEAD, index, source-content, submodule, or dirty-worktree protections.
