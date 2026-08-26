# Issue Pause, Unified Actions, and Contextual Duplicate Design

**Date:** 2026-08-25

## Context

The current product overloads `cancelIssue` with two different user intents. In an active Agent stage, the Desktop labels the action “取消 Agent 运行”, but Runtime first transitions the Issue to terminal `CANCELED` and then aborts the Agent turn. A user who intends to stop and continue later therefore loses the ability to resume the Issue.

Issue-level actions are also distributed across stage-specific panels. Assessment always offers “确认为重复 Issue”, even when the Agent did not report a suspected duplicate, and the duplicate target is not prefilled from `assessment.suspectedDuplicateOf`. This makes an exceptional outcome look like a required part of every Assessment decision.

## Goals

- Separate pausing an active Agent turn from canceling an Issue.
- Preserve enough state to continue a paused Issue from its original operation.
- Present every currently available Issue action in one unified action area.
- Keep Issue cancellation available in non-terminal, interruptible states without presenting it as an Assessment result.
- Offer duplicate closure only when the Agent reported `suspectedDuplicateOf`, and prefill that candidate.
- Preserve existing Assessment, Delivery, permission, retry, and cancellation behavior where their semantics do not change.

## Non-goals

- Deleting Issue records.
- Resuming a suspended operating-system process. Continue starts a new Agent turn for the same operation and session context.
- Pausing or canceling an in-progress `FINALIZING` publication.
- Automatically closing Issues solely from an Agent duplicate suggestion.

## State Model

Add `PAUSED` to `IssueStatus` and add an optional pause context to `Issue`:

```ts
interface IssuePauseContext {
  operation: "ASSESS" | "REPAIR" | "CAPTURE_EVIDENCE" | "RECOVER_FINALIZATION";
  resumeStatus:
    | "ASSESSING"
    | "REPAIRING"
    | "EVIDENCE_CAPTURE"
    | "FINALIZATION_RECOVERY";
  pausedAt: string;
}
```

The operation and resume status must be a valid pair:

| Operation | Resume status |
| --- | --- |
| `ASSESS` | `ASSESSING` |
| `REPAIR` | `REPAIRING` |
| `CAPTURE_EVIDENCE` | `EVIDENCE_CAPTURE` |
| `RECOVER_FINALIZATION` | `FINALIZATION_RECOVERY` |

An Issue in `PAUSED` must have a valid pause context. An Issue in any other state must not have one. Terminal transitions clear pause context. Pause does not increment a Repair iteration, discard an Assessment or Delivery draft, revoke the Agent session, or release the Issue workspace.

The pause context is transient state used to determine what to enqueue on continue. `resumeIssue` consumes it when returning the Issue to its original running state. Durable `ISSUE_PAUSED` and `ISSUE_RESUMED` events retain the audit history after the transient field is removed.

## Commands and Concurrency

### Pause

Add `pauseIssue(id)` throughout Runtime, protocol, Electron bridge, and Desktop transport.

Pause is legal only from `ASSESSING`, `REPAIRING`, `EVIDENCE_CAPTURE`, and `FINALIZATION_RECOVERY`. Runtime must:

1. Resolve the operation and resume status from the current Issue state.
2. Atomically transition the Issue to `PAUSED`, store its pause context, increment the revision, remove any pending operation, and append `ISSUE_PAUSED`.
3. After persistence succeeds, ask the session-selected Agent adapter to cancel the current turn with a pause-specific interruption reason.
4. If Agent cancellation fails, retain `PAUSED` and append `AGENT_PAUSE_FAILED`; do not restore or requeue the operation automatically.

Persisting first ensures a late Agent result cannot overwrite the pause. Existing revision and status checks must reject results produced from the pre-pause snapshot.

If an operation is queued but has not begun, removing its pending operation is sufficient. Runtime may still issue a best-effort Agent cancellation when a session exists; this must not change the persisted pause result.

### Continue

Add `resumeIssue(id)` throughout the same boundaries. Resume is legal only from `PAUSED`. Runtime must:

1. Validate the stored operation/resume-status pair.
2. Atomically restore `resumeStatus`, remove the pause context, increment the revision, enqueue the stored operation, and append `ISSUE_RESUMED`.
3. Wake the scheduler.

Continue reuses the Issue’s Agent session and preserved workspace/context, but starts a new turn for the stored operation. It is not a Repair retry and must not increment `repair.iteration`.

### Cancel

`cancelIssue(id)` remains the terminal user action and transitions to `CANCELED` with resolution `CANCELED`. It no longer serves as the implementation behind “暂停 Agent”.

Cancel is legal from passive and recoverable non-terminal states, including `RECEIVED`, all stage-specific failure states, `EVIDENCE_CHECK`, `PERMISSION_REQUIRED`, `REVIEW_REQUIRED`, `FINALIZATION_FAILED`, and `PAUSED`. While an Agent operation is active, the UI first offers pause; the user can cancel the Issue after it reaches `PAUSED`.

`FINALIZING`, `COMPLETED`, `CLOSED`, and `CANCELED` expose neither pause nor cancel. Publication remains non-interruptible because stopping between Git publication steps could leave an indeterminate external state.

### Restart Recovery

Startup recovery must never infer a pending operation for `PAUSED`. A paused Issue remains paused across Runtime and Desktop restarts until an explicit `resumeIssue` command succeeds.

## Unified Issue Action Area

Issue Detail renders one action area whose contents depend on current state. Stage-specific content panels explain context and collect data, but do not create separate lifecycle action bars.

| State/category | Actions |
| --- | --- |
| Assessment review | Assessment choices, `取消 Issue` |
| Delivery review | Delivery choices, `取消 Issue` |
| Permission request | Grant choices, `取消 Issue` |
| Active Agent operation | `暂停 Agent` |
| `PAUSED` | `继续执行`, `取消 Issue` |
| Recoverable failure | Stage-specific retry/rebuild action, `取消 Issue` |
| Other interruptible non-terminal state | `取消 Issue` |
| `FINALIZING` or terminal state | None |

The action area may adapt its form controls to the current review, but its placement and ownership remain Issue-level. “取消 Issue” is a normal lifecycle action in this area, not a hidden overflow action and not an Assessment result. A future “删除 Issue” action, if designed, belongs in destructive overflow controls and is outside this change.

Cancel requires confirmation that the Issue will enter terminal `CANCELED`. Pausing does not use terminal language. Its copy states that the current Agent turn will stop and can be continued later.

The status badge and activity timeline add user-facing labels for `PAUSED`, `ISSUE_PAUSED`, `ISSUE_RESUMED`, and `AGENT_PAUSE_FAILED`.

## Contextual Duplicate Closure

Assessment review generation includes the `duplicate` choice only when `issue.assessment.suspectedDuplicateOf` is a non-blank string. Reviews without a candidate do not display or accept this choice. For existing persisted reviews, Desktop filters an unconditional legacy duplicate choice from the visible choices, and Runtime rejects a `duplicate` submission when the current Assessment has no candidate. This makes the upgrade behavior explicit without rewriting stored Issue history.

When the choice exists, Desktop initializes its response with:

```ts
{ duplicateOf: issue.assessment.suspectedDuplicateOf }
```

The field remains editable. Submission retains the current Runtime checks: the target must exist, belong to the same project, and not be the source Issue. Runtime stores the target’s canonical Issue identifier. An invalid candidate leaves the Issue and review unchanged and returns a specific inline error so the user can correct the identifier or select another outcome.

The Agent suggestion never closes an Issue automatically. Human submission remains required.

## Error Handling

- Stale pause, continue, cancel, and review commands fail through existing revision/state guards without partially mutating the Issue.
- A missing or invalid pause context prevents resume and reports a bounded state error; Runtime must not guess the prior operation.
- Agent pause failure is diagnostic rather than a state rollback because the durable `PAUSED` revision protects against stale completion.
- Scheduler wake failure does not revert a successful resume; existing restart reconciliation can recover the restored running state and pending operation.
- Duplicate target errors remain non-mutating and are translated into actionable Desktop messages.

## Compatibility and Migration

- Core schema parsing accepts existing Issues without pause context.
- No database backfill is required for existing rows; new fields are optional except under the `PAUSED` invariant.
- Desktop hides persisted legacy duplicate choices unless their Assessment contains `suspectedDuplicateOf`, and Runtime applies the same condition at submission time.
- Existing `CANCELED` Issues remain terminal and are not migrated to `PAUSED`; historical intent cannot be inferred safely.
- Existing Agent adapter cancellation remains available. Its reason union gains a pause-specific reason so adapters and activity can distinguish pause from terminal Issue cancellation.

## Verification

### Core

- Each valid active state pauses to `PAUSED` with the correct operation/status pair.
- Resume restores the exact state and returns the exact pending operation.
- Pause/resume reject illegal states and malformed context.
- Pause preserves session, workspace-related Issue data, Assessment, Repair state, Delivery draft, and iteration.
- Cancel from `PAUSED` and all intended passive states reaches terminal `CANCELED` and clears pause context.

### Runtime

- `pauseIssue` persists before invoking Agent cancellation.
- Agent cancellation failure leaves the Issue paused and records a diagnostic event.
- A late pre-pause Agent result cannot mutate the paused Issue.
- `resumeIssue` queues the correct operation and wakes scheduling without incrementing Repair iteration.
- Restart reconciliation leaves paused Issues idle.
- Protocol schemas and service dispatch cover pause and resume.

### Desktop

- The unified action area exposes exactly the actions defined by the state matrix.
- Active Agent states show “暂停 Agent”, not “取消 Agent 运行”.
- `PAUSED` shows “继续执行” and “取消 Issue”.
- Cancel confirmation and asynchronous errors remain visible and accessible.
- Status and activity labels distinguish pause, resume, and terminal cancellation.

### Duplicate Review

- Assessment without `suspectedDuplicateOf` neither generates nor renders the duplicate choice.
- Assessment with a candidate renders the choice and prefilled target.
- Selecting another choice does not submit duplicate response data.
- Missing, self, cross-project, and unknown targets do not mutate the Issue.
- A valid same-project target closes the Issue as duplicate and stores its canonical identifier.

### Regression

Run focused Core, Runtime, Desktop web, Electron protocol, and acceptance suites, followed by repository type checking and the standard full test command.
