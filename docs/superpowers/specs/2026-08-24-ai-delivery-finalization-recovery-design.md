# AI Delivery Finalization Recovery Design

**Date:** 2026-08-24

## Goal

Automatically give a failed delivery finalization to the Issue Agent for one bounded recovery attempt, then retry finalization without requiring another human approval when the approved delivery content is unchanged.

If recovery changes product code, tests, configuration, or other approved delivery content, the Issue must return through evidence validation and human acceptance before it can finalize again.

## Problem

Delivery finalization currently reduces Workspace failures to a short compatibility code such as `GIT_COMMAND_FAILED:add`. The Issue moves to `FINALIZATION_FAILED`, retains its Worktree, and waits for a human to retry the same operation. A retry cannot succeed when the Worktree still contains the condition that caused the failure.

OHMYBUG-14 demonstrates the failure mode. Its approved implementation remained valid, but Agent-created temporary content included an empty nested Git repository under `.pnpm-store`. `git add -A` failed before the existing post-stage gitlink guard could run. Repeated finalization attempts failed identically, while the renderer-facing approval request also exceeded the Utility Client's generic ten-second timeout.

The product already isolates private-temp cleanup failures from the primary Agent result and preserves failed finalization state. It does not yet diagnose and repair the retained Worktree automatically.

## Principles

- A finalization failure is recoverable work, not an invitation to repeat the same command unchanged.
- The Agent may diagnose and repair the retained Issue Worktree, but Git commit, merge, push, and Worktree release remain Workspace Provider responsibilities.
- Human approval applies to a specific delivery content snapshot. Automatic recovery must not bypass acceptance when that content changes.
- Automatic recovery is bounded to one attempt per human delivery approval.
- Recovery state, diagnostics, attempt accounting, and transitions are durable across application restarts.
- Unknown or unsafe conditions stop for human action instead of being hidden, deleted, or retried indefinitely.

## Scope

This design includes:

- structured, sanitized Workspace finalization diagnostics;
- a dedicated Agent-backed finalization recovery operation;
- deterministic before-and-after delivery-content comparison;
- automatic finalization retry when approved content is unchanged;
- revalidation when recovery changes approved content;
- asynchronous delivery approval and finalization requests;
- UI status and activity for automatic recovery;
- recovery of OHMYBUG-14 through the new path.

This design does not:

- give the Agent ownership of commits, merges, pushes, or Worktree release;
- silently delete arbitrary untracked files;
- make every Git or host failure automatically repairable;
- grant network access or unrestricted host execution by default;
- retry automatic recovery more than once per human approval;
- remove the explicit user retry action after bounded recovery is exhausted.

## Lifecycle

Add the durable Issue status `FINALIZATION_RECOVERY` and pending operation `RECOVER_FINALIZATION`.

The normal lifecycle becomes:

```text
ACCEPTANCE_REVIEW
  -> FINALIZING
  -> COMPLETED
```

The failed lifecycle becomes:

```text
FINALIZING
  -> FINALIZATION_RECOVERY
  -> FINALIZING
  -> COMPLETED
```

Bounded and unsafe outcomes become:

```text
FINALIZATION_RECOVERY
  -> EVIDENCE_CAPTURE      when approved delivery content changed
  -> PERMISSION_REQUIRED   when the Agent needs an Issue-scoped capability
  -> FINALIZATION_FAILED   when recovery cannot proceed safely

FINALIZING
  -> FINALIZATION_FAILED   when finalization fails after the automatic recovery budget is spent
```

`FINALIZATION_RECOVERY` is an active status. It has exactly one pending `RECOVER_FINALIZATION` operation. Restart recovery requeues that operation just as it requeues Assessment, Repair, Evidence, and Finalize operations today.

Each human transition from `ACCEPTANCE_REVIEW` to `FINALIZING` starts a new recovery budget with one available automatic attempt. An automatic transition from recovery back to `FINALIZING` consumes that attempt and does not replenish it. Returning through evidence and human acceptance starts a new approval and therefore a new single-attempt budget.

## Persisted Recovery State

Extend the Issue with a durable optional finalization recovery record:

```ts
interface FinalizationRecoveryState {
  automaticAttempts: 0 | 1;
  attemptId?: string;
  diagnostic?: WorkspaceFinalizationDiagnostic;
  fingerprintRef?: string;
  summary?: string;
}
```

Human approval creates or resets the record with `automaticAttempts: 0`. The first finalization failure atomically records its diagnostic, assigns an `attemptId`, changes the status to `FINALIZATION_RECOVERY`, sets the pending operation to `RECOVER_FINALIZATION`, and increments `automaticAttempts` to `1`. Because the counter increments in the same transaction that queues recovery, restart recovery cannot spend the budget twice.

The recovery fingerprint itself remains in Workspace module state because it is provider-specific. `fingerprintRef` binds the Issue attempt to that stored record. Completion and a new human approval clear obsolete diagnostics and references while durable events preserve history.

Extend capability request state so Finalization Recovery can use the existing permission workflow:

- operation: add `RECOVER_FINALIZATION`;
- stage: add `FINALIZATION_RECOVERY`;
- resume status: add `FINALIZATION_RECOVERY`.

A request transitions the Issue to the existing `PERMISSION_REQUIRED` status. Granting it restores `FINALIZATION_RECOVERY` and requeues the same pending operation without resetting the attempt identifier or recovery budget.

## Structured Finalization Diagnostics

Workspace publication failures must retain enough information for recovery without exposing unbounded process output.

Add a structured diagnostic value with:

```ts
interface WorkspaceFinalizationDiagnostic {
  providerId: string;
  step: "status" | "add" | "commit" | "push" | "merge" | "release" | "unknown";
  code: string;
  exitCode?: number;
  message: string;
  stderr?: string;
  relatedPaths: string[];
}
```

The Git Workspace Provider maps its command failures to this shape. `stderr` is sanitized and bounded to 8,000 characters. `relatedPaths` contains at most 50 normalized, repository-relative paths extracted from Git diagnostics. Absolute paths, credentials, environment variables, remote URLs containing credentials, and control characters are removed from Agent and UI views.

The existing `WORKSPACE_PUBLISH_FAILED` event remains for compatibility. Its data gains the structured diagnostic and an `automaticRecoveryAvailable` boolean. Existing readers may continue using the top-level compatibility error code.

## Approved Delivery Fingerprint

Automatic recovery needs a deterministic boundary between disposable finalization state and approved delivery content.

Immediately before the Agent recovery turn, the Workspace Provider records a fingerprint containing:

- the current HEAD commit;
- tracked path status and content object IDs;
- untracked regular files and symlinks that Git can represent;
- file modes and symlink targets;
- explicitly unrepresentable roots implicated by the finalization diagnostic, such as an empty embedded repository.

The fingerprint is stored in Workspace module state and referenced by the Issue recovery attempt. It does not modify the real Git index or create a delivery commit. Temporary index and object storage used to calculate the fingerprint lives outside the Issue Worktree and is cleaned as secondary lifecycle work.

Paths excluded as diagnostic roots are not automatically considered disposable. They are recorded separately so the recovery result can explain what happened to them. Unknown excluded paths prevent automatic retry unless the post-recovery state makes them Git-representable or the Agent classifies them as generated artifacts and the deterministic validator can prove they were entirely untracked.

## Agent Recovery Contract

The Worker invokes the existing Issue Agent and session with a dedicated finalization-recovery prompt and structured output schema.

The prompt includes:

- the approved delivery summary;
- the structured finalization diagnostic;
- the current Git status;
- the approved delivery fingerprint summary;
- the single-attempt recovery limit;
- an instruction not to commit, merge, push, rewrite branches, or release the Worktree;
- an instruction to prefer removal or relocation of generated artifacts over product changes;
- an instruction to stop and request capabilities when the existing permission boundary is insufficient.

The first version uses `workspace-write` with network disabled, matching Repair defaults. Existing Issue-scoped capability requests remain available. A capability request pauses and later resumes the same `RECOVER_FINALIZATION` operation and Agent session.

The Agent returns:

```ts
interface FinalizationRecoveryResult {
  summary: string;
  diagnosis: string;
  disposition: "RECOVERED" | "REVALIDATION_REQUIRED" | "UNSAFE";
  affectedPaths: string[];
}
```

The result is advisory. Runtime transitions depend on the deterministic Workspace comparison, not solely on the Agent's claimed disposition.

## Deterministic Recovery Validation

After the Agent turn, the Workspace Provider compares the Worktree with the approved delivery fingerprint.

### Approved content unchanged

Automatic retry is allowed only when all of the following hold:

- HEAD and the real Git index were not changed by the Agent;
- every tracked path has the same status, content, and mode;
- every representable untracked delivery path has the same content, mode, and symlink target;
- no new non-generated delivery path appeared;
- every removed or changed diagnostic root was entirely untracked before recovery;
- the original failure condition is absent in a dry-run publication preflight.

The Runtime appends `DELIVERY_FINALIZATION_RECOVERY_COMPLETED` and `DELIVERY_FINALIZATION_AUTO_RETRIED`, transitions to `FINALIZING`, queues `FINALIZE`, consumes the automatic recovery budget, and wakes the Worker.

### Approved content changed

If tracked content or a representable untracked delivery path changed, automatic delivery is forbidden even when the Agent reports success.

The Runtime records a new implementation draft and routes the Issue through the existing evidence pipeline. Visual evidence is recaptured or re-inspected as required, and the Issue returns to `ACCEPTANCE_REVIEW`. The previous human approval is retained in history but does not authorize the changed delivery.

### Unsafe or unresolved

Recovery transitions to `FINALIZATION_FAILED` when:

- the Agent reports `UNSAFE`;
- the Agent changes HEAD, the real index, branches, or remotes;
- an unknown untracked path would have to be silently discarded;
- the publication preflight still fails;
- the Agent turn fails without a recoverable capability request;
- the automatic recovery budget is already consumed.

The Worktree, Issue branch, diagnostics, fingerprint, and Agent activity remain available for inspection and explicit user retry.

## Asynchronous Approval and Retry

`approveDelivery` must no longer await `worker.drain()` inside the renderer-facing Utility request.

The command atomically:

1. records the user approval or explicit retry;
2. transitions the Issue to `FINALIZING`;
3. persists `FINALIZE` as the pending operation;
4. wakes the Worker;
5. returns the accepted Issue state immediately.

The Worker performs Finalize and any automatic recovery in the background. Issue event subscriptions already refresh list and detail snapshots. The Desktop derives completed branch information from the durable `ISSUE_COMPLETED` event instead of depending on a long-lived approval response.

The generic Utility Client timeout remains ten seconds for ordinary request-response operations. Long-running finalization and Agent recovery are no longer part of that request lifetime.

## Existing Data Migration

Existing `FINALIZATION_FAILED` Issues have no recovery record. Database normalization initializes them with `automaticAttempts: 0` and preserves their Issue revision, delivery, resolution, events, Workspace binding, branch, and Worktree.

An explicit user retry of one of these migrated Issues transitions it to `FINALIZING`. If Finalize fails again, the normal first-failure rule queues its one automatic recovery attempt. This is how OHMYBUG-14 enters the new recovery path without manual Issue-row or branch metadata edits.

Existing `FINALIZING` Issues also receive `automaticAttempts: 0`, so an in-flight or restart-recovered finalization has one automatic recovery opportunity. Terminal Issues do not need a recovery record.

## UI Behavior

Add a consistent status label for `FINALIZATION_RECOVERY`:

- badge and list label: `AI 正在修复交付`;
- detail heading: `正在自动修复交付问题`;
- description: `代码和工作目录已保留。AI 正在诊断交付失败，修复后会自动重试一次。`;
- no manual retry button while recovery or finalization is active.

Activity shows:

- the sanitized finalization failure step and message;
- `AI 开始修复交付`;
- Agent command and file activity using the existing terminal presentation;
- whether approved delivery content remained unchanged;
- whether finalization was retried automatically or returned for revalidation.

After bounded recovery fails, the existing `交付失败，待重试` panel remains. Its detail includes the latest safe diagnostic and explains that the automatic attempt has been used.

## Restart and Concurrency

All transitions use existing Issue revision checks and persisted pending operations.

- Restart during `FINALIZATION_RECOVERY` requeues one `RECOVER_FINALIZATION` operation without incrementing the attempt count twice.
- Restart after the recovery result but before automatic Finalize resumes the persisted `FINALIZE` operation.
- A stale Finalize or recovery result cannot overwrite a newer Issue revision.
- Only one Finalize or Finalization Recovery operation may be active for an Issue.
- Explicit retry is rejected while either active status is present.
- Canceling the Issue cancels the active Agent turn, preserves the Worktree, and does not release or discard uncommitted content.

## OHMYBUG-14 Recovery

After the implementation is deployed to the local development Runtime:

1. Keep the current OHMYBUG-14 branch and Worktree unchanged.
2. Trigger one explicit finalization retry from `FINALIZATION_FAILED`.
3. Let the expected `git add` failure transition into `FINALIZATION_RECOVERY`.
4. The Agent receives the empty nested repository diagnostic for `.pnpm-store/shared/v11/tmp/_tmp_RdJN2l/` and the retained Worktree status.
5. The Agent removes or relocates generated temporary content without changing the approved product files.
6. The deterministic comparison verifies that the approved delivery fingerprint is unchanged.
7. Runtime retries Finalize once, commits the intended delivery, performs the configured local merge, releases the Worktree, and marks the Issue `COMPLETED`.

Before the operational retry, create a checkpointed backup of the Runtime database. Do not edit Issue rows or branch metadata manually. If the deterministic validator finds delivery-content changes, stop at revalidation rather than forcing completion.

## Testing

Automated coverage must include:

- Git command failures preserve bounded structured diagnostics and related paths;
- diagnostics remove secrets, absolute paths, and control characters;
- first finalization failure queues `RECOVER_FINALIZATION` instead of stopping immediately;
- a consumed recovery budget transitions the next failure to `FINALIZATION_FAILED`;
- Agent recovery that only removes the OHMYBUG-14 generated-artifact shape automatically retries Finalize;
- tracked source changes force evidence and human reacceptance;
- intended untracked source deletion also forces revalidation and never silently finalizes;
- changes to HEAD, index, branches, or remotes are rejected as unsafe;
- capability requests pause and resume Finalization Recovery;
- restart recovery preserves attempt accounting and pending operations;
- migration gives existing `FINALIZING` and `FINALIZATION_FAILED` Issues one unused automatic recovery attempt without changing their other persisted data;
- concurrent or stale results cannot overwrite newer Issue revisions;
- `approveDelivery` returns a `FINALIZING` Issue without waiting for Workspace publication;
- the renderer does not report `UTILITY_REQUEST_TIMEOUT` for long finalization;
- completed branch information survives refresh through durable events;
- UI labels, retry visibility, activity, failure detail, and revalidation behavior match the lifecycle;
- the full Git Workspace publication suite continues to protect declared submodules, hidden index state, dirty submodules, merges, and Worktree release.

## Observability

Add durable events:

- `DELIVERY_FINALIZATION_RECOVERY_STARTED`;
- `DELIVERY_FINALIZATION_RECOVERY_COMPLETED`;
- `DELIVERY_FINALIZATION_RECOVERY_FAILED`;
- `DELIVERY_FINALIZATION_REVALIDATION_REQUIRED`;
- `DELIVERY_FINALIZATION_AUTO_RETRIED`.

Each event records the recovery attempt identifier and bounded safe metadata. Agent command output continues through the existing activity stream. Raw unrestricted stderr is never persisted or displayed.

## Success Criteria

- OHMYBUG-14 completes through one automatic Agent recovery without manual database or branch rewriting.
- A finalization failure does not merely repeat unchanged on the first automatic recovery opportunity.
- Approved delivery content cannot change and bypass evidence plus human acceptance.
- Long-running finalization no longer occupies a renderer Utility request or produces `UTILITY_REQUEST_TIMEOUT`.
- Failed or unsafe recovery remains durable, inspectable, bounded, and manually retryable.
