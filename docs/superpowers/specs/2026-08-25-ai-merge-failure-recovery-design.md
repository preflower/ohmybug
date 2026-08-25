# AI Merge Failure Recovery Design

**Date:** 2026-08-25

## Goal

Route every Git Workspace finalization failure from the `merge` step through one bounded AI recovery attempt before requiring manual repair.

The Workspace Provider continues to own Git state transitions. The AI diagnoses the failure and may edit the retained Issue Worktree, but it does not commit, merge, push, rewrite refs, discard user changes, or release the Worktree. Deterministic validation decides whether the result may retry automatically, must return through evidence and human acceptance, or must stop for manual action.

## Problem

The first Finalization Recovery implementation was built around OHMYBUG-14. It accepts only `git add` failures associated with recognized generated-artifact roots. That narrow gate prevents the Agent from seeing other finalization failures even though the Runtime already has an Agent-backed recovery operation, durable attempt accounting, capability requests, fingerprint validation, and revalidation transitions.

OHMYBUG-21 exposed the gap. The approved Issue branch and the configured base branch both changed `apps/desktop/src/web/issues/issue-detail.tsx`. Automatic publication called `git merge-tree --write-tree`, received a content conflict, and recorded:

```text
step: merge
code: GIT_AUTO_MERGE_CONFLICT
relatedPaths: []
```

Recovery preparation rejected the diagnostic as `FINALIZATION_RECOVERY_DIAGNOSTIC_UNSUPPORTED` before an Agent turn was started. The UI therefore appeared to offer AI recovery while the actual policy excluded the entire merge stage.

The desired policy is broader: every merge failure receives AI diagnosis and one safe repair opportunity. Eligibility for AI analysis must not imply authority to publish the result without validation or renewed acceptance.

## Product Decisions

1. Every finalization diagnostic with `step: "merge"` enters `FINALIZATION_RECOVERY` when the approval has an unused recovery attempt and the retained Issue Worktree is readable. A specialized preparation failure falls back to non-mutating AI diagnosis instead of excluding the error code.
2. The allowlist moves out of recovery preparation. Preparation gathers the safest context it can; validation after the Agent turn determines whether the result is publishable.
3. The Workspace Provider owns all mutating Git operations, including creating a non-committing merge state, staging a resolved tree, committing, updating refs, pushing, aborting provider-owned state, and releasing the Worktree.
4. The AI may edit files in the Issue Worktree and run non-destructive diagnostics or project verification. It must not run mutating Git commands.
5. Any AI resolution of a source conflict changes the previously approved delivery snapshot and therefore returns through evidence capture and human acceptance.
6. Automatic finalization retry remains available only when the original merge failure is removed without changing approved delivery content.
7. Environmental or policy failures still go to the AI for diagnosis. The AI may return an actionable unresolved result when safe repair requires authority it does not have.
8. Recovery remains bounded to one attempt per human delivery approval.

## Approaches Considered

### Expand the current error allowlist

Add `GIT_AUTO_MERGE_CONFLICT` and selected related codes to `assertRecoverableGitDiagnostic`.

This is a small change, but it repeats the current architectural mistake. Every new Git failure requires another hard-coded exception, diagnostics remain incomplete, and preparation still decides recoverability before the Agent can inspect the Worktree.

### Give the Agent direct ownership of Git merge operations

Permit the Agent to run `git merge`, stage files, commit, update refs, and retry publication.

This offers maximum flexibility but crosses established safety boundaries. It makes deterministic comparison harder, risks overwriting user or provider state, and permits changed source to bypass the delivery approval snapshot.

### Provider-prepared merge with AI content resolution

The Workspace Provider creates and fingerprints a bounded merge-recovery session. The AI receives complete conflict context and edits only the retained Issue Worktree. The Provider validates the result and keeps ownership of the index, commits, refs, and publication.

This is the selected approach. It gives the AI enough context to solve semantic conflicts while preserving existing authority and acceptance boundaries.

## Scope

This design includes:

- every Git finalization failure whose diagnostic step is `merge`;
- structured merge diagnostics with base, Issue, and conflict context;
- provider-owned preparation of content-conflict state;
- AI diagnosis for both content and non-content merge failures;
- deterministic post-recovery validation;
- evidence and human reacceptance for source conflict resolutions;
- restart-safe recovery state and base-branch movement handling;
- UI and durable activity for merge recovery;
- automated coverage based on the OHMYBUG-21 conflict shape.

This design does not:

- allow the Agent to commit, merge, push, rewrite branches, reset, clean, or release Worktrees;
- overwrite or stash a user's dirty base-branch checkout;
- bypass protected branches, hooks, repository permissions, or capability boundaries;
- guarantee that every merge problem is repairable;
- automatically accept AI-resolved product code;
- broaden non-merge recovery beyond the existing generated-artifact flow.

## Recovery Classification

Git recovery preparation classifies the diagnostic without rejecting `merge` failures:

```ts
type GitFinalizationRecoveryKind =
  | "GENERATED_ARTIFACT_CLEANUP"
  | "MERGE_CONFLICT"
  | "MERGE_ENVIRONMENT";
```

`GENERATED_ARTIFACT_CLEANUP` preserves the existing `git add` recovery behavior.

`MERGE_CONFLICT` applies when automatic merge computation identifies one or more unmerged paths and the Provider can safely establish a non-committing merge in the Issue Worktree.

`MERGE_ENVIRONMENT` covers all other merge-step failures, including a missing local base branch, dirty base checkout, unsupported Git version, ref lock, base ref race, hook or policy rejection, repository permission failure, and an unclassified merge command error. These failures still receive an Agent turn, but preparation does not mutate the base checkout or invent missing authority.

It is also the fallback when conflict-specific preparation cannot safely establish a provider-owned merge session. The fallback sets `mergePrepared: false`, retains the original diagnostic and observed repository state, and instructs the Agent to diagnose without editing. Only an absent or unreadable Issue Worktree, unavailable Agent adapter, or exhausted recovery budget can prevent the Agent turn entirely.

## Structured Merge Diagnostics

The generic diagnostic remains bounded and sanitized. Merge failures additionally populate provider recovery context:

```ts
interface GitMergeRecoveryContext {
  kind: "MERGE_CONFLICT" | "MERGE_ENVIRONMENT";
  baseBranch: string;
  baseCommit?: string;
  issueBranch: string;
  issueCommit: string;
  conflictPaths: string[];
  mergeMessages: string[];
  mergePrepared: boolean;
}

interface WorkspaceFinalizationRecoveryContext {
  fingerprintRef: string;
  workspaceStatus: string;
  fingerprintSummary: string;
  recoveryKind: GitFinalizationRecoveryKind;
  merge?: GitMergeRecoveryContext;
}
```

`GIT_AUTO_MERGE_CONFLICT` must retain conflict paths rather than reducing them to an empty `relatedPaths` list. The Git client captures bounded stdout and stderr from `merge-tree`, while the Provider also derives the authoritative path set from `git ls-files -u` after preparing the merge. Absolute paths, credentials, control characters, and unbounded command output remain excluded from durable events and prompts.

The Agent receives:

- the finalization diagnostic;
- base branch, base commit, Issue branch, and Issue commit;
- conflict paths and bounded merge messages;
- conflict status from the retained Worktree;
- the Issue request, Assessment, latest accepted delivery summary, and relevant feedback;
- approved-content and merge-session fingerprint summaries;
- explicit Git ownership and capability restrictions.

## Provider-Owned Merge Preparation

Automatic publication continues to try the object-level `merge-tree --write-tree` path first. A clean result never starts AI recovery.

When that operation reports a content conflict, recovery preparation performs these steps in the Issue Worktree:

1. Verify that the saved Issue commit still equals `HEAD`, the Issue Worktree has no unrelated changes after publication committed the approved delivery, and no earlier provider-owned merge session is active.
2. Record the repository configuration, refs, `HEAD`, real index, Issue tree, current base ref, and current Worktree status.
3. Run a Provider-owned `git merge --no-commit --no-ff <baseCommit>` against the immutable commit recorded by the failed publication attempt.
4. Require the expected conflict exit, `MERGE_HEAD` equal to `baseCommit`, and at least one unmerged path.
5. Record the prepared index, non-conflicting merge result, conflict stages, conflict paths, and a content fingerprint for every path visible to the Agent.
6. Persist the merge session in Workspace module state under the recovery `attemptId` and return bounded context to Runtime.

The Provider, not the Agent, initiates this merge. The base checkout is never changed. The existing Issue branch remains checked out in its isolated Worktree, and `HEAD` remains at the approved Issue commit until a later human-approved finalization commits the merge.

Preparation is idempotent. On restart, a matching `MERGE_HEAD`, attempt identifier, base commit, Issue commit, and fingerprint resume the existing session. A mismatched or foreign merge state is classified as unsafe instead of being aborted or overwritten.

For `MERGE_ENVIRONMENT`, preparation fingerprints the retained Issue Worktree and repository state without creating a merge session. This lets the Agent inspect and explain the condition while preventing it from changing the user's base checkout or repository policy.

If any conflict-specific preparation check fails after the Worktree has been located, the Provider captures a bounded observation of the unchanged state and returns `MERGE_ENVIRONMENT` context. It does not throw `FINALIZATION_RECOVERY_DIAGNOSTIC_UNSUPPORTED`. If the Provider had already started its own merge before a later preparation check failed, it must either prove and restore the exact pre-merge fingerprint or preserve the merge state and describe it as provider-owned; it never silently aborts unknown state.

## Agent Recovery Turn

The existing `RECOVER_FINALIZATION` operation and Agent session are reused. The prompt becomes recovery-kind aware.

For `MERGE_CONFLICT`, the Agent is instructed to:

- inspect every conflict path and both conflict sides;
- preserve the Issue intent and compatible base-branch changes;
- edit the working files until conflict markers and semantic contradictions are resolved;
- avoid editing paths outside the conflict set unless compilation requires a directly related change;
- run the smallest relevant tests, followed by broader verification when feasible;
- report all affected paths and whether source behavior changed;
- never stage, commit, merge, rebase, reset, clean, push, or update refs.

For `MERGE_ENVIRONMENT`, the Agent is instructed to diagnose the failure, make only safe Issue-Worktree changes, request capabilities when needed, and return `UNSAFE` when repair would require touching the user's base checkout, weakening policy, or exceeding granted authority.

The existing result shape remains sufficient:

```ts
interface FinalizationRecoveryResult {
  summary: string;
  diagnosis: string;
  disposition: "RECOVERED" | "REVALIDATION_REQUIRED" | "UNSAFE";
  affectedPaths: string[];
}
```

The disposition is advisory. Provider validation remains authoritative.

## Deterministic Validation

Validation dispatches by the persisted recovery kind.

### Merge conflict validation

The Provider requires all of the following:

- repository configuration and refs are unchanged;
- `HEAD` still equals the approved Issue commit;
- `MERGE_HEAD` still equals the prepared base commit;
- the real index still matches the Provider-prepared merge index;
- the unmerged path set still matches the recorded conflict set;
- no conflict markers remain in resolved text files;
- paths outside the conflict set match the Provider-prepared non-conflicting merge snapshot, except for explicitly reported directly related paths;
- no undeclared Gitlinks, dirty submodules, hidden-index entries, generated artifacts, or foreign merge metadata were introduced;
- the resolved tree can be constructed using a temporary index without mutating the real index;
- required project verification can run from the resolved working tree.

The temporary index starts from the Provider-prepared index. The Provider stages only the allowed resolved paths into that temporary index and calls `write-tree`. This proves that a complete merge tree exists while preserving the real index and the no-preapproval-commit rule.

Any valid source conflict resolution returns validation kind `CHANGED`, regardless of the Agent's disposition. It routes the Issue to `EVIDENCE_CAPTURE`, creates a new delivery draft, and requires human acceptance. A conflict resolution cannot be classified as `UNCHANGED` merely because tests pass.

Out-of-scope edits, ref changes, Git mutations, unresolved entries, missing conflict paths, or a failed resolved-tree check return `UNSAFE` with bounded reasons and changed paths.

### Merge environment validation

If the Agent removes a transient Issue-Worktree condition without changing approved content and a fresh publication preflight succeeds, validation returns `UNCHANGED` and Runtime automatically retries `FINALIZE` once.

If approved source changes, validation returns `CHANGED` and follows evidence plus human acceptance.

If the condition still exists or repair requires touching the base checkout, refs, hooks, permissions, or policy, validation returns `UNSAFE` and leaves the Issue in `FINALIZATION_FAILED` with actionable diagnostics.

## Revalidation and Final Publication

After a valid merge conflict resolution:

1. Runtime records `DELIVERY_FINALIZATION_MERGE_RESOLVED`.
2. The Issue transitions from `FINALIZATION_RECOVERY` to `EVIDENCE_CAPTURE` using the existing changed-delivery path.
3. Evidence is captured or inspected against the resolved working tree.
4. The user accepts or rejects the new delivery snapshot.
5. Acceptance resets the one-attempt recovery budget and queues `FINALIZE`.
6. The Git Provider recognizes its persisted merge session, verifies the immutable base and Issue commits, stages the resolved paths into the real index, and commits the merge using two parents.
7. Automatic base integration sees the prepared base commit as an ancestor of the new Issue merge commit and updates the configured base ref through the existing safe fast path.
8. Push and release continue through existing Provider behavior.

If the user rejects the delivery, Repair continues in the retained merge Worktree. The merge session stays provider-owned, and later validation includes any additional source changes in the next delivery snapshot.

Cancel preserves the Issue branch, Worktree, conflict resolution, and merge diagnostics. It does not abort or discard the provider-owned merge state. Any future explicit recovery must verify that state before resuming.

## Base Branch Movement

The failed publication records the exact `baseCommit`. AI resolves against that immutable commit.

Before committing or updating the base ref, the Provider compares the current base ref with the prepared base commit:

- If they match, publication continues.
- If the prepared base commit is still the current base ancestor but new commits were added, the resolved merge is stale. Publication records `GIT_AUTO_MERGE_BASE_MOVED` and starts a new bounded recovery only when the latest human approval has an unused attempt.
- If the base ref was rewritten or deleted, recovery stops as unsafe with the observed ref state.

The Provider never silently applies a resolution made against one base tree to a different base tree.

## Runtime and State Model

No new Issue status is required. The existing states retain their meanings:

- `FINALIZING`: Provider publication is active.
- `FINALIZATION_RECOVERY`: the Agent is diagnosing or resolving the failed merge.
- `EVIDENCE_CAPTURE`: AI changed or resolved source and the new snapshot requires validation.
- `FINALIZATION_FAILED`: the bounded attempt is exhausted, unsafe, unresolved, or blocked by external authority.

`FinalizationRecoveryState` keeps the durable attempt, diagnostic, fingerprint reference, and summary. Provider-specific merge session data remains in Workspace module state, bound to `issueId`, `resourceId`, and `attemptId`.

The coordinator must call `prepareFinalizationRecovery` for every merge-step diagnostic rather than converting preparation rejection directly into `automaticRecoveryAvailable: false`. The Git Provider converts specialized preparation failures into bounded `MERGE_ENVIRONMENT` context whenever the Issue Worktree remains readable. A merge error is never excluded merely because its code is absent from an allowlist. Missing Worktree access, unavailable Agent support, and exhausted attempt budget remain explicit terminal gates.

## UI Behavior

The existing `FINALIZATION_RECOVERY` status remains, with merge-aware copy:

- list badge: `AI 正在修复合并` for merge recovery;
- detail heading: `AI 正在解析合并问题`;
- conflict summary: base branch plus the bounded list of conflict paths;
- activity: preparation, Agent diagnosis, edited paths, verification, and validation result;
- no manual retry button while recovery is active.

When source conflict resolution succeeds, the UI explains that the base branch was integrated by AI and the changed delivery requires evidence plus renewed acceptance.

When recovery stops, the existing retry panel shows the safe merge diagnostic, AI summary, unresolved paths, and whether the failure needs repository authority, user cleanup, or semantic review.

## Permissions and Safety

The default recovery sandbox remains `workspace-write` with network disabled. Existing Issue-scoped capability requests remain available.

Capability grants do not expand Git ownership. Host execution may permit a required project test or repository inspection, but the prompt and Provider validator still prohibit Agent-owned commit, merge, ref update, push, reset, clean, or base-checkout mutation.

The Provider never automatically stashes, resets, or edits a dirty base checkout. It never disables hooks, changes branch protection, rewrites Git configuration, or substitutes another remote. The Agent reports those conditions and requests only capabilities that could safely advance diagnosis.

## Restart, Retry, and Concurrency

- Recovery preparation and validation are keyed by `attemptId` and Issue revision.
- Restart during a prepared merge resumes the same session when `HEAD`, `MERGE_HEAD`, index fingerprint, base commit, and Issue commit match.
- Restart after a changed result requeues evidence capture through the existing pending operation.
- A stale Agent result cannot validate against a newer merge session or Issue revision.
- Only one Finalize or Finalization Recovery operation may be active for an Issue.
- Explicit retry is rejected while either operation is active.
- A new human acceptance resets the recovery budget but does not erase the persisted merge session needed for final commit.
- A foreign or mismatched merge state is preserved and reported; Runtime does not automatically abort it.

## Durable Events

Existing generic recovery events remain. Add merge-specific bounded metadata to them and introduce two semantic events:

- `DELIVERY_FINALIZATION_MERGE_PREPARED`: base commit, Issue commit, conflict count, and sanitized conflict paths;
- `DELIVERY_FINALIZATION_MERGE_RESOLVED`: resolved path count, validation kind, and verification summary.

`WORKSPACE_PUBLISH_FAILED`, `DELIVERY_FINALIZATION_RECOVERY_STARTED`, `DELIVERY_FINALIZATION_REVALIDATION_REQUIRED`, `DELIVERY_FINALIZATION_RECOVERY_FAILED`, and `ISSUE_COMPLETED` continue to describe the overall lifecycle.

Raw conflict contents and unrestricted command output are not persisted in Issue events.

## Existing Data

No database migration is required for Issue rows because existing statuses and `FinalizationRecoveryState` remain valid.

Workspace module state gains a versioned optional merge-recovery session. Old state without that session continues through the generated-artifact path. Existing `FINALIZATION_FAILED` merge Issues receive the broader behavior on explicit retry: approval resets `automaticAttempts` to zero, a repeated merge failure prepares the new context, and the Agent receives the recovery turn.

Provider state decoding must ignore unknown future fields and reject malformed active merge sessions without rewriting the Worktree.

## Testing

### Git Provider

- `merge-tree` conflict diagnostics include sanitized conflict paths and immutable commit identifiers.
- the Provider prepares a non-committing merge only in the Issue Worktree and never changes the base checkout;
- merge preparation records expected `HEAD`, `MERGE_HEAD`, conflict stages, index, refs, and configuration;
- repeated preparation with the same attempt is idempotent;
- foreign merge state is preserved and rejected as unsafe;
- temporary-index validation produces a resolved tree without mutating the real index;
- out-of-scope edits, unresolved paths, conflict markers, Gitlinks, submodule changes, hidden-index entries, and ref mutations are rejected;
- final publication creates a two-parent merge commit only after renewed human acceptance;
- a moved, rewritten, or deleted base ref cannot consume a stale resolution;
- dirty base checkout, missing local base, unsupported Git, ref lock, and permission failures produce `MERGE_ENVIRONMENT` context instead of pre-Agent rejection.
- failed conflict-specific preparation falls back to an inspection-only Agent turn without modifying foreign merge state;

### Runtime and Agent

- every `step: "merge"` diagnostic with available budget queues `RECOVER_FINALIZATION`;
- OHMYBUG-21's import and cancel-button conflict reaches the Agent with both conflict paths and Issue context;
- successful source resolution routes to `EVIDENCE_CAPTURE` even when the Agent reports `RECOVERED`;
- unchanged environment repair automatically retries Finalize once;
- unsafe or unresolved recovery stops with actionable diagnostics;
- capability requests pause and resume the same merge recovery attempt;
- restart and stale-result guards preserve one-attempt accounting;
- user rejection keeps the merge session and re-enters Repair safely;
- renewed acceptance finalizes the prepared merge and completes the Issue.

### UI

- merge-specific active copy and conflict paths are shown;
- manual retry is hidden while recovery is active;
- changed source clearly requires renewed acceptance;
- unsafe recovery shows the AI diagnosis and required human action;
- generic generated-artifact recovery copy remains unchanged.

### Regression

- the existing OHMYBUG-14 generated-artifact recovery remains automatic and unchanged;
- clean automatic merges still avoid Agent recovery;
- completed branch information, push behavior, release, restart recovery, and asynchronous approval continue to pass;
- the full repository test suite passes in an environment with a valid Electron installation.

## Operational Acceptance Scenario

An acceptance test reproduces OHMYBUG-21:

1. Create an Issue branch from an older base commit.
2. Change an icon import and the cancel-button line in the Issue branch.
3. Change the same component on the base branch with compatible image-preview and recovery UI work.
4. Approve delivery and observe `GIT_AUTO_MERGE_CONFLICT`.
5. Verify Runtime enters `FINALIZATION_RECOVERY` and the Agent receives the conflicting file, both commits, and Issue intent.
6. Have the Agent preserve the base changes while applying the Issue's `X` icon intent.
7. Verify deterministic validation returns `CHANGED` and queues evidence rather than auto-publishing.
8. Accept the new evidence.
9. Verify the Provider creates a two-parent merge commit, updates the base branch safely, releases the Worktree, and completes the Issue.

## Success Criteria

- No merge-step failure with a readable retained Issue Worktree is excluded from AI diagnosis by a code or path allowlist.
- Content conflicts include enough structured context for the Agent to resolve them.
- The Agent cannot own or silently mutate commits, refs, the base checkout, pushes, or Worktree release.
- AI-resolved source conflicts cannot bypass evidence and renewed human acceptance.
- Environment-only repairs that preserve approved content can retry automatically.
- Unsafe, unresolved, stale, or externally blocked merges remain durable and actionable.
- OHMYBUG-21's conflict shape completes through AI resolution followed by renewed acceptance, without manual branch surgery.
