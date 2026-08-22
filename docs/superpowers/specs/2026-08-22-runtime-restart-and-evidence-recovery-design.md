# Runtime Restart and Evidence Recovery Design

## Goal

Prevent an intentional Runtime restart, development hot reload, or process crash from being reported as an Agent implementation failure. Preserve completed implementation work across interruption, and retry visual-evidence collection without asking the Agent to implement the feature again.

The work ships as two independently useful increments:

1. restart-safe Agent operation recovery;
2. a distinct evidence-capture stage with a host-managed capture path.

The first increment fixes the OHMYBUG-9 failure mode on its own. The second removes the evidence-loop pressure that kept OHMYBUG-9 running when the restart occurred.

## Problem

OHMYBUG-9 completed its product-code change and passed its focused Web verification. It remained in `REPAIRING` because visual evidence could not be imported. Two evidence retries re-entered the full Repair prompt. During the third retry, the development Electron process restarted and Runtime canceled the active Codex turn.

Current behavior loses the distinction between an operational interruption and an Agent failure:

- `OhMyBugRuntime.stop()` cancels every active Agent session.
- `CodexAgentAdapter` converts an aborted turn into `RUN_CANCELED`.
- `RuntimeWorker` maps every error except two named availability/configuration errors to `AGENT_FAILURE`.
- startup reconciliation converts an abandoned `REPAIRING` Issue into `REPAIR_FAILED`.

Current evidence handling also conflates implementation and proof:

- a Repair result must include visual evidence;
- missing or rejected evidence transitions back to `REPAIRING`;
- `EVIDENCE_REJECTED` increments the Repair iteration;
- the next prompt says to implement the approved change again, even when the code is already complete.

The resulting `REPAIR_FAILED / AGENT_FAILURE` status is therefore misleading. It describes neither the completed implementation nor the actual interruption.

## Confirmed Design Decisions

- Runtime restart is recoverable and must not create `ASSESSMENT_FAILED` or `REPAIR_FAILED` by itself.
- User cancellation remains terminal and must not auto-resume.
- A genuine Agent or output failure retains the existing failed states.
- Recovery reuses the persisted logical Agent session, provider session, Issue workspace, Repair iteration, delivery draft, and retry counters.
- Operational recovery does not increment the Repair iteration.
- Evidence rejection does not rerun implementation work.
- Real visual evidence remains mandatory; this design does not weaken the existing provenance contract.
- Development hot reload remains enabled. Correct recovery is preferred over suppressing reloads.
- Existing optimistic Issue revisions remain the authority for rejecting stale worker writes.
- The two increments receive separate implementation plans and may ship separately.

## Increment 1: Restart-Safe Agent Operations

### Typed interruption reason

Introduce a typed interruption classification at the Agent boundary:

```ts
type AgentInterruptionReason =
  | "RUNTIME_STOPPING"
  | "USER_CANCELED";

class AgentTurnInterruptedError extends Error {
  readonly code = "AGENT_TURN_INTERRUPTED";
  constructor(readonly reason: AgentInterruptionReason) {
    super(`AGENT_TURN_INTERRUPTED:${reason}`);
  }
}
```

Runtime shutdown calls Agent cancellation with `RUNTIME_STOPPING`. The explicit Issue cancellation command uses `USER_CANCELED`. `CodexAgentAdapter` preserves that reason instead of reducing every abort to `RUN_CANCELED`.

The generic public error sanitizer must not translate `RUNTIME_STOPPING` into `AGENT_FAILURE`.

### Graceful shutdown data flow

When Runtime stops during Assessment or Repair:

1. Runtime stops accepting commands and tells the worker it is draining for restart.
2. Runtime cancels the active Agent turn with `RUNTIME_STOPPING`.
3. The worker catches `AgentTurnInterruptedError`.
4. In one store transaction, the worker leaves the Issue in its active status and restores its durable pending operation:
   - `ASSESSING` gets `pending_operation = ASSESS`;
   - `REPAIRING` gets `pending_operation = REPAIR`.
5. The worker appends `RUNTIME_INTERRUPTED` with the stage, iteration, session ID, and reason.
6. Runtime finishes cleanup and closes the store.

No failed transition, retry transition, Repair iteration increment, or Agent-session replacement occurs.

### Crash recovery data flow

A process crash cannot run the graceful-shutdown transaction. On startup, reconciliation handles an active Issue with no pending operation:

1. `ASSESSING` is requeued as `ASSESS`.
2. `REPAIRING` is requeued as `REPAIR`.
3. `EVIDENCE_CHECK` is requeued for evidence inspection without discarding its delivery.
4. `RUNTIME_INTERRUPTED` is appended once for the recovered revision.

The current behavior that converts these states directly to failed states is removed.

### Resume prompt

The resumed Codex provider session receives a continuation prompt rather than the original implementation prompt verbatim:

> The previous turn was interrupted by a Runtime restart. Continue the existing work in the supplied workspace. Inspect current files and prior verification before making changes. Do not redo completed implementation work. Complete only the remaining stage requirements.

Assessment continuation retains the Assessment output schema. Repair continuation retains the current Repair output schema until Increment 2 ships.

### Stale-write protection

The existing Issue revision check remains the primary concurrency guard. Every worker completion must compare the claimed revision before writing.

Add an operation-attempt identifier to activity events, but not to the Core Issue schema. It is diagnostic metadata used to correlate one claim, interruption, and resumed claim. It must not become a second state machine or bypass revision checks.

### User cancellation

User cancellation remains distinct:

1. transition the Issue to `CANCELED` durably;
2. cancel the Agent turn with `USER_CANCELED`;
3. ignore the canceled turn's later completion through the revision check;
4. do not create a pending operation or auto-resume on startup.

## Increment 2: Independent Evidence Capture

### State model

Separate implementation output from evidence acquisition:

```text
REPAIRING
  -> EVIDENCE_CAPTURE
  -> EVIDENCE_CHECK
  -> ACCEPTANCE_REVIEW

EVIDENCE_CAPTURE
  -> EVIDENCE_CAPTURE       evidence retry
  -> EVIDENCE_FAILED        retry limit or non-recoverable capture error
  -> CANCELED
```

`REPAIR_FAILED` is reserved for implementation or Agent-output failures. `EVIDENCE_FAILED` means the implementation delivery is preserved but proof could not be captured.

### Delivery draft

The implementation turn produces and persists a delivery draft before evidence capture:

```ts
interface DeliveryDraft {
  summary: string;
  repairIteration: number;
  implementationCompletedAt: string;
}
```

The draft stays under `Issue.repair` and survives restart. Evidence acceptance converts the draft plus imported evidence into the existing final `Delivery`.

The first implementation may still return evidence. Valid returned evidence skips directly to `EVIDENCE_CHECK`. Missing, inaccessible, or rejected evidence enters `EVIDENCE_CAPTURE` without discarding the draft.

### Evidence-only Agent turn

Add a dedicated Agent operation and prompt for evidence retries:

```ts
interface AgentAdapter {
  captureEvidence(
    session: AgentSessionRef,
    input: EvidenceCaptureInput,
  ): Promise<EvidenceCaptureResult>;
}
```

The evidence-only prompt includes the accepted Assessment, persisted delivery draft, current workspace, previous inspection feedback, and a fresh intake directory. It states:

- do not reimplement or refactor the product change;
- inspect the existing work and verification first;
- modify product code only if the acceptance run exposes a real defect;
- return only real screenshots or recordings from the acceptance run.

Evidence retry count is separate from Repair iteration. A successful evidence-only turn does not change the implementation iteration.

### Host-managed evidence runner

Introduce a host-side `EvidenceCaptureProvider` owned by Runtime composition:

```ts
interface EvidenceCaptureProvider {
  capture(input: EvidenceCaptureRequest): Promise<{
    type: "screenshot" | "recording";
    label: string;
    path: string;
  }>;
}
```

The first provider supports configured project acceptance commands and browser or Electron launch parameters. It runs outside the restricted Codex workspace sandbox but writes only into the prepared intake directory.

Provider responsibilities:

- start and stop the configured acceptance process;
- bind approved localhost ports;
- launch the configured browser or Electron entry point;
- wait on explicit readiness conditions rather than fixed sleeps;
- capture a real screenshot or recording;
- return the exact artifact path and diagnostics;
- clean up only processes it created.

Codex chooses or supplies the configured acceptance target; it does not receive unrestricted host process access. Projects without a configured capture target may continue using Agent-driven evidence tools, but failures remain in `EVIDENCE_CAPTURE` rather than rerunning implementation.

### Evidence failure reporting

Replace the current generic evidence message with structured public codes:

- `EVIDENCE_FILE_MISSING`
- `EVIDENCE_MEDIA_INVALID`
- `EVIDENCE_NOT_REVIEWABLE`
- `EVIDENCE_TARGET_UNREACHABLE`
- `EVIDENCE_CAPTURE_PERMISSION_DENIED`
- `EVIDENCE_CAPTURE_PROCESS_FAILED`
- `EVIDENCE_RETRY_LIMIT_REACHED`

Diagnostics remain sanitized but include the failed capture mode and target. The UI shows that implementation work is preserved and offers `Retry evidence` separately from `Retry implementation`.

## Persistence and Compatibility

Increment 1 does not require a schema migration. It reuses `pending_operation`, Issue status, revision, persisted Agent sessions, and Workspace bindings.

Increment 2 extends the Core Issue schema with the new evidence statuses and optional delivery draft. Existing persisted Issues migrate as follows:

- `REPAIR_FAILED` with `lastFailure.code = RUNTIME_INTERRUPTED` becomes `REPAIRING` with `pending_operation = REPAIR` during startup reconciliation.
- `REPAIR_FAILED` with evidence-specific failure codes and an existing delivery becomes `EVIDENCE_FAILED`.
- other `REPAIR_FAILED` Issues remain unchanged.

The migration is idempotent and appends a single migration/recovery event per changed Issue.

## UI Behavior

Active Issue activity distinguishes these conditions:

- `Runtime restarted; resuming analysis`
- `Runtime restarted; resuming implementation`
- `Implementation complete; capturing evidence`
- `Evidence capture failed; implementation preserved`

`Retry evidence` appears only when a delivery draft exists. `Retry implementation` remains available for genuine Repair failures or human delivery rejection.

Development hot reload needs no special blocking UI. A short reconnect/resume state replaces the current failure state.

## Testing

### Increment 1 acceptance tests

- Stop Runtime during Assessment, reopen it, and complete Assessment in the same logical and provider session.
- Stop Runtime during Repair, reopen it, and complete Repair without incrementing the Repair iteration.
- Seed abandoned `ASSESSING` and `REPAIRING` Issues with no pending operation and verify startup requeues them once.
- Restart repeatedly and verify only one pending operation runs.
- Verify a stale pre-restart completion cannot overwrite the resumed revision.
- Cancel an Issue explicitly and verify restart does not resume it.
- Return a genuine Codex turn failure and verify it still becomes `REPAIR_FAILED`.
- Verify interruption activity exposes `RUNTIME_INTERRUPTED`, not `AGENT_FAILURE`.

### Increment 2 acceptance tests

- Complete implementation without evidence and verify the Issue enters `EVIDENCE_CAPTURE` with a persisted delivery draft.
- Reject evidence twice and verify implementation is not rerun and Repair iteration is unchanged.
- Restart during evidence capture and verify the same draft and evidence retry resume.
- Capture valid browser, Electron, and command evidence through the host provider.
- Verify provider cleanup does not terminate unrelated processes.
- Exhaust evidence retries and verify `EVIDENCE_FAILED` retains the draft and worktree.
- Retry evidence successfully from `EVIDENCE_FAILED` and reach `ACCEPTANCE_REVIEW`.
- Migrate existing interruption and evidence failures idempotently.

## Rollout

1. Ship typed interruption handling and restart requeue behavior behind no feature flag; it corrects failure classification without changing successful flows.
2. Observe `RUNTIME_INTERRUPTED`, resumed operations, duplicate-claim prevention, and completion outcomes in development.
3. Add evidence states and the evidence-only Agent operation.
4. Add the host-managed capture provider for configured projects.
5. Remove the legacy path that sends evidence rejection back through the full Repair prompt after persisted Issues have migrated.

## Non-Goals

- Disabling development hot reload globally.
- Weakening the requirement for real visual evidence.
- Automatically accepting tests as visual evidence without a real captured artifact.
- Rebuilding unavailable Codex sessions without the existing explicit session-rebuild rules.
- Publishing, committing, or deleting an Issue worktree during recovery.
- Building a general remote execution platform or third-party capture-provider marketplace.
