# Delivery Finalization Status Design

**Date:** 2026-08-24

## Problem

The Issue lifecycle currently stores both an active Git Workspace finalization and a failed finalization as `APPROVED`. The desktop UI labels that single state `发布中 / 待重试` and always exposes a retry action.

This is inaccurate in two ways:

- the UI cannot tell whether finalization is running or has already failed;
- `发布` suggests a Git remote push, while the operation may only commit the Issue branch and release its Worktree. Merge and remote push remain independent project settings.

OHMYBUG-14 demonstrates the ambiguity. Its delivery was approved, Workspace finalization failed during `git add`, and no `FINALIZE` operation remains pending. It is waiting for a retry, but the UI cannot distinguish that condition from an active finalization.

## Goals

- Represent active and failed delivery finalization as distinct, durable Issue statuses.
- Replace user-facing publication language with delivery-finalization language.
- Show a retry action only after finalization fails.
- Preserve the existing Git behavior and project settings.
- Migrate existing `APPROVED` records without losing their active-versus-failed meaning.

## Non-goals

- Change when Issue branches are committed, merged, pushed, or released.
- Add a new user-controlled publication workflow.
- Change the `pushToRemote` or `mergeToBaseBranch` project settings.
- Diagnose or repair the underlying `GIT_COMMAND_FAILED:add` failure for OHMYBUG-14.

## Status Model

Replace the ambiguous `APPROVED` lifecycle state with two statuses:

- `FINALIZING`: the delivery has been approved and a `FINALIZE` operation is queued or running. Display label: `交付处理中`.
- `FINALIZATION_FAILED`: the last finalization attempt failed and no attempt is running. Display label: `交付失败，待重试`.

The lifecycle becomes:

```text
ACCEPTANCE_REVIEW
  -> FINALIZING
  -> COMPLETED

FINALIZING
  -> FINALIZATION_FAILED
  -> FINALIZING (explicit retry)
```

The delivery resolution continues to be assigned when the user approves the delivery. A finalization failure does not discard that decision, the delivery, the Issue branch, or the Worktree.

## Runtime Behavior

Approving a delivery transitions the Issue from `ACCEPTANCE_REVIEW` to `FINALIZING`, persists a pending `FINALIZE` operation, and emits the existing user-approval lifecycle event.

The Workspace coordinator accepts only `FINALIZING` Issues for finalization. On success it records the released Workspace binding and transitions the Issue to `COMPLETED` atomically, as today. On failure it transitions the Issue to `FINALIZATION_FAILED`, clears the pending operation, and records `WORKSPACE_PUBLISH_FAILED`. The existing event name remains unchanged because it is an internal compatibility surface; user-facing copy does not expose it.

An explicit retry transitions `FINALIZATION_FAILED` back to `FINALIZING`, queues one `FINALIZE` operation, emits `DELIVERY_FINALIZATION_RETRIED`, and wakes the Runtime worker. Retrying does not repeat Assessment, Repair, evidence capture, or delivery approval.

Runtime recovery queues `FINALIZE` only for `FINALIZING`. A `FINALIZATION_FAILED` Issue remains idle until the user retries it.

## Existing Data Migration

Existing persisted `APPROVED` records are normalized when the database opens:

- `pending_operation = 'FINALIZE'` becomes `FINALIZING`;
- a missing pending operation becomes `FINALIZATION_FAILED`.

The migration changes only the stored status field. It preserves the Issue identifier, revision, timestamps, resolution, delivery, events, Workspace binding, and module state. The core schema no longer accepts `APPROVED` after migration.

This maps OHMYBUG-14 to `FINALIZATION_FAILED` because it has a `WORKSPACE_PUBLISH_FAILED` event and no pending finalization operation.

## Desktop Behavior and Copy

The Issue badge, list row, detail header, and metadata rail display the same status label:

- `FINALIZING`: `交付处理中`, using the active/default badge treatment.
- `FINALIZATION_FAILED`: `交付失败，待重试`, using the destructive badge treatment.

The detail page renders no retry control while the Issue is `FINALIZING`.

For `FINALIZATION_FAILED`, the detail page renders a recovery section:

- heading: `交付失败，待重试`;
- description: `代码和工作目录已保留，可安全重试交付收尾。`;
- action: `重试交付`;
- in-flight action label: `重试中…`;
- request failure fallback: `重试交付失败`.

The user interface no longer uses `发布中`, `待重试发布`, `重试发布`, or other wording that implies remote Git push.

## Error Handling

A finalization failure remains observable through both the durable Issue status and the existing `WORKSPACE_PUBLISH_FAILED` event. The Workspace binding stays `READY`, allowing the same Issue branch and Worktree to be reused.

If a retry request itself fails before it is accepted, the Issue remains `FINALIZATION_FAILED` and the desktop shows the request error locally. Concurrent or stale finalization results must not overwrite a newer Issue revision.

## Verification

Automated coverage will verify:

- core workflow transitions for approval, failure, retry, and completion;
- schema acceptance of the two new statuses and rejection of legacy `APPROVED` after migration;
- Runtime success, failure, explicit retry, and restart recovery behavior;
- migration of both pending and idle legacy `APPROVED` rows;
- Git Workspace publication accepts the active finalization state;
- desktop badge labels, variants, retry visibility, action copy, and callback behavior;
- existing Git merge and remote-push behavior remains unchanged.

