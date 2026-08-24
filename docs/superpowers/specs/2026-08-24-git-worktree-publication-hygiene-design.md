# Git Worktree Publication Hygiene Design

## Goal

Prevent Oh My Bug's private Agent and acceptance-test artifacts from entering an Issue delivery commit, allow clean worktrees that contain legitimate or accidentally created nested Git repositories to be released safely, and recover `OHMYBUG-13` without losing its implementation changes.

## Incident and root cause

`OHMYBUG-13` completed implementation and evidence review. During finalization, `GitWorkspace.publish()` ran `git add -A` over the complete Issue worktree. An Agent-created directory named `.oh-my-bug-tmp-m2qzxW` was not ignored by the product or the target repository. It contained an acceptance repository at `.oh-my-bug-tmp-m2qzxW/browser-acceptance-repo-yDT6je`.

Git staged that nested repository as a `160000` gitlink. The delivery commit was created and persisted in `branchInfo`, but `GitWorkspace.release()` then ran ordinary `git worktree remove`. Git refused with:

```text
fatal: working trees containing submodules cannot be moved or removed
```

The Runtime reduced this to `GIT_COMMAND_FAILED:worktree`, so the UI could only leave the Issue in the combined `APPROVED` state labelled “发布中 / 待重试”. The delivery commit and worktree remained intact.

## Scope

This change covers:

- private Agent temporary-directory lifecycle;
- Git publication staging hygiene;
- guarded Git worktree release;
- actionable, sanitized publication diagnostics;
- regression coverage using a real nested Git repository;
- one-time recovery of the local-only `OHMYBUG-13` delivery branch and Runtime publication record.

It does not add general-purpose repository cleaning, delete arbitrary ignored files outside a released worktree, or automatically rewrite branches that have already been pushed to a remote.

## Design

### 1. Reserve and identify private temporary paths

`.oh-my-bug-tmp-*` remains an Oh My Bug-owned path prefix. Writable Codex turns continue receiving a private `TMPDIR` beneath the Issue workspace. The Agent instructions will require temporary repositories, browser profiles, extracted packages, and other disposable artifacts to stay under the supplied `TMPDIR` instead of creating sibling directories manually.

The SDK lifecycle will continue deleting its owned private directory when a turn ends. Cleanup failure remains an explicit Agent/runtime failure rather than being silently ignored.

This lifecycle rule reduces leftovers but is not trusted as the only protection; publication independently excludes the reserved prefix.

### 2. Stage product changes without private artifacts

`GitWorkspace.publish()` must stop using an unrestricted `git add -A` over the whole worktree. It will stage all normal tracked, deleted, and newly created project files while excluding `.oh-my-bug-tmp-*` directories located at the Agent working-directory boundary.

After staging and before committing, publication will inspect the index. If a reserved private path or an unexpected gitlink from a reserved private path is staged, publication fails with a stable hygiene error and does not create a delivery commit.

This preserves support for legitimate new source files and legitimate project submodules while preventing product-owned transient data from entering the delivery commit.

### 3. Guard worktree release before using force

Ordinary `git worktree remove` cannot remove a worktree containing an initialized submodule or nested repository. Adding `--force` without a guard would risk deleting user changes, so release will use a two-step safety gate:

1. Verify that tracked and staged content is clean relative to the persisted delivery commit.
2. Inspect non-ignored untracked paths. Every remaining non-ignored untracked path must be under the reserved `.oh-my-bug-tmp-*` boundary.

If either check fails, release stops with a stable `GIT_WORKTREE_NOT_CLEAN` error and keeps the worktree for recovery. If both checks pass, release may call `git worktree remove --force`. At that point the only disposable content is product-owned temporary data; real source changes have either been committed or caused the guard to stop release.

The delivered branch is retained exactly as today.

### 4. Preserve actionable diagnostics

Git command failures will retain the stable operation code used by Runtime transitions, while the workspace layer also classifies safe details such as “nested repository prevents worktree removal” or “worktree contains uncommitted files”. Runtime events and the UI must not expose absolute private paths or raw command output.

For this class of failure, the Issue remains approved and retryable. The UI can accurately distinguish an active finalization attempt from a completed attempt waiting for retry by using the persisted finalization failure event rather than inferring both from `APPROVED` alone.

### 5. Recover `OHMYBUG-13`

`OHMYBUG-13` was configured for local delivery and was not pushed remotely. Recovery will rebuild its delivery commit from the same parent using only the intended feature files, excluding `.oh-my-bug-tmp-m2qzxW`. The local Issue branch and persisted `branchInfo.commit` will be updated together after verifying that the rebuilt tree contains the intended implementation and no reserved temporary paths or unexpected gitlinks.

The Issue will then be retried through normal finalization. A clean release marks it `COMPLETED`; failure leaves the rebuilt branch and worktree available for another retry.

No forced rewrite is attempted for any remotely published branch.

## Testing

Tests use real temporary Git repositories and linked worktrees.

- A private temporary directory containing ordinary files and a nested Git repository is excluded from the delivery commit.
- Intended new source files are still committed.
- Release succeeds when only reserved temporary artifacts or initialized submodules remain after a clean delivery commit.
- Release refuses to force-remove a worktree with tracked modifications, staged modifications, or unrelated untracked files.
- A failed publication remains retryable and reuses the stable delivery commit.
- Safe diagnostics identify the release category without exposing absolute paths.
- `OHMYBUG-13` recovery verification checks the rebuilt commit tree, feature tests, branch pointer, Runtime event sequence, and final Issue status.

## Safety properties

- Product-owned temporary data cannot enter a new delivery commit.
- `--force` is never used before proving that user-authored changes are absent.
- A failed guard preserves the worktree and branch.
- Remote history is never rewritten automatically.
- Issue completion still occurs only after publish and release both succeed.
