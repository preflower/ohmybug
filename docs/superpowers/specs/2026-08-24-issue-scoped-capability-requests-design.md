# Issue-Scoped Capability Requests Design

## Goal

Keep Assessment and Repair at their existing least-privilege defaults while allowing an Agent or project Skill to request additional execution capabilities only when no lower-privilege alternative can complete the current work.

Capability requests pause the current Issue without treating the pause as an Agent or implementation failure. A human may later grant the requested capabilities and continue the same stage, Agent session, and workspace. Grants belong only to the current Issue and remain effective until that Issue completes, closes, or is canceled.

Evidence retains its existing unrestricted execution and network access by default.

## Motivation

The current permissions are fixed when a Codex turn starts:

- Assessment uses `read-only` with network disabled.
- Repair uses `workspace-write` with network disabled.
- Evidence uses `danger-full-access` with network enabled.

This protects ordinary analysis and implementation work, but it gives Assessment and Repair no recoverable path when a project Skill or an acceptance-related task genuinely needs host execution or network access. Today the Agent either keeps trying unsuitable workarounds or returns a generic failure.

OHMYBUG-14 also exposed a separate lifecycle defect. Codex completed the Repair turn, but private temporary-directory cleanup raised `ENOTEMPTY`. The cleanup exception escaped the streamed turn and replaced the valid implementation result with `REPAIR_FAILED / AGENT_FAILURE`. Cleanup is secondary lifecycle work and must not override a completed Agent result.

## Principles

- Default permissions remain stage-specific and minimal where they are minimal today.
- Any Agent-backed stage or project Skill may request capabilities.
- A Skill may explain or declare a requirement, but it cannot authorize itself.
- Only an explicit human action grants capabilities.
- Grants are Issue-scoped, persisted, and automatically expire at an Issue terminal state.
- Permission insufficiency is a recoverable pause, not a failure.
- The UI describes the real enforcement boundary and never presents unrestricted host execution as GUI-only access.
- Cleanup failures remain observable without replacing primary Agent results.

## Capability Model

The first version supports only capabilities that map honestly onto the current Codex SDK controls:

```ts
type AgentCapability = "HOST_EXECUTION" | "NETWORK_ACCESS";
```

### `NETWORK_ACCESS`

Enables network access for an otherwise unchanged Assessment or Repair sandbox. It does not broaden filesystem access.

### `HOST_EXECUTION`

Changes an Assessment or Repair turn to `danger-full-access`. This permits host-level command execution, including GUI and Electron launch, process control, and filesystem access outside the workspace. It does not implicitly enable network access.

The approval UI must describe this as unrestricted host execution. The request reason may identify a narrower purpose such as visual acceptance, but the product must not claim to enforce a GUI-only boundary that the SDK does not provide.

Fine-grained GUI, process, and directory capabilities require a future host broker and are outside this design.

## Stage Defaults and Effective Permissions

Stage defaults remain:

| Stage | Sandbox | Network |
|---|---|---|
| Assessment | `read-only` | Disabled |
| Repair | `workspace-write` | Disabled |
| Evidence | `danger-full-access` | Enabled |

Evidence never needs a capability request to obtain its default permissions.

For each new Assessment or Repair turn, the Agent Adapter combines the stage default with the current Issue grants:

- `NETWORK_ACCESS` sets `networkAccessEnabled` to `true` without changing the sandbox.
- `HOST_EXECUTION` sets `sandboxMode` to `danger-full-access` without changing network access.
- Both grants produce `danger-full-access` with network enabled.

Permissions cannot change inside a running turn. Granting capabilities always resumes work in a new turn on the existing logical and provider Agent session.

## Structured Agent Outcome

The Agent is not expected to infer an undocumented protocol. Assessment, Repair, and Evidence output schemas explicitly include a shared capability-request branch alongside their normal result:

```ts
interface CapabilityRequiredOutcome {
  outcome: "CAPABILITY_REQUIRED";
  capabilities: AgentCapability[];
  reason: string;
  blockedCommand?: string;
  requestedBy?: {
    type: "AGENT" | "SKILL";
    id?: string;
  };
}
```

Stage prompts instruct the Agent to:

1. use an available lower-privilege alternative when practical;
2. request a capability before execution when a project Skill explicitly requires it;
3. stop repeated workarounds after a sandbox, permission, or network denial when no lower-privilege alternative remains;
4. return `CAPABILITY_REQUIRED` instead of an ordinary stage failure;
5. request only capabilities that have not already been granted.

The Adapter parses the structured branch and emits a typed `AgentCapabilityRequired` control signal. It is not reported as `AGENT_ERROR` and is not returned as an Assessment, Repair, or Evidence result.

If a command appears permission-blocked but the Agent returns a generic failure, the Adapter may make one bounded corrective continuation on the same session. That continuation asks the Agent to choose between a lower-privilege alternative and a structured capability request. Runtime never guesses or automatically grants the requested capability from an `EPERM`, `EACCES`, sandbox, or network error.

## Persisted State

An Issue may contain active grants and one pending request:

```ts
interface CapabilityGrant {
  capability: AgentCapability;
  grantedAt: string;
  requestId: string;
}

interface PendingCapabilityRequest {
  id: string;
  operation: "ASSESS" | "REPAIR" | "CAPTURE_EVIDENCE";
  stage: "ASSESSMENT" | "REPAIR" | "EVIDENCE";
  capabilities: AgentCapability[];
  reason: string;
  blockedCommand?: string;
  requestedBy?: {
    type: "AGENT" | "SKILL";
    id?: string;
  };
  requestedAt: string;
}
```

The Issue also records the originating status needed to resume the operation. Capability names are allow-listed, de-duplicated, and must exclude already-granted capabilities. Reason text is required and bounded. Command and requester metadata are sanitized and bounded before persistence or display.

These fields are optional in the persisted Issue JSON, so existing database rows remain readable without rewriting historical Issues.

## Runtime State Flow

Add the recoverable Issue status `PERMISSION_REQUIRED`, displayed as “权限不足”.

When a claimed Assessment, Repair, or Evidence operation receives `AgentCapabilityRequired`, Runtime atomically:

1. validates and sanitizes the request;
2. stores the pending request and originating operation/status;
3. clears the claimed pending operation;
4. transitions the Issue to `PERMISSION_REQUIRED`;
5. appends `CAPABILITY_REQUESTED` with safe request metadata.

The Issue remains paused indefinitely. It is not automatically retried and does not consume an existing Assessment, Repair, or Evidence retry budget.

### Grant and Continue

When the user selects “授权并继续”, Runtime atomically:

1. verifies the Issue revision and active request;
2. adds the requested capabilities to the Issue grants;
3. clears the pending request;
4. restores the originating active status and pending operation;
5. appends `CAPABILITY_GRANTED`;
6. wakes the Worker.

The resumed turn uses the same Agent session and workspace. Its continuation reason is `CAPABILITY_GRANTED`, and the prompt includes the newly effective grants and instructs the Agent to inspect existing work and continue without redoing completed steps.

### Cancel Issue

The permission card offers the existing Issue cancellation action as “取消 Issue”. Cancellation:

- aborts any active Agent turn;
- clears the pending request;
- revokes all Issue grants;
- attempts to stop Issue-owned acceptance processes and clean private temporary directories;
- follows the existing cancellation policy for preserving or releasing the Issue workspace.

There is no “暂不授权” action. Leaving the Issue in `PERMISSION_REQUIRED` already represents deferring the decision.

### Restart and Terminal States

Application restart preserves `PERMISSION_REQUIRED` without queuing work. A later grant resumes the recorded operation.

`COMPLETED`, `CLOSED`, and `CANCELED` revoke all effective capability grants. Grants never carry to another Issue or become project defaults.

## User Interface

Permission requests use an inline Issue-detail card rather than a blocking global dialog. Other Issues and application areas remain usable while one Issue is paused.

The card shows:

- the blocked stage;
- the Agent or Skill that requested access, when known;
- requested capability names;
- a truthful description of their enforcement scope;
- the bounded request reason;
- the sanitized blocked command, when supplied.

It provides exactly two actions:

- “授权并继续”;
- “取消 Issue”.

The Issue list and detail status show “权限不足”. Granting host execution requires affirmative confirmation that it enables unrestricted host command execution for the current Issue until termination.

## Validation and Loop Protection

- Unknown capability names make the structured output invalid.
- Empty reasons and empty capability lists are invalid.
- A request containing granted and ungranted capabilities is normalized to only the ungranted subset.
- A request containing only already-granted capabilities triggers one corrective continuation.
- Repeating the same fully granted request after correction becomes `AGENT_CAPABILITY_REQUEST_INVALID` rather than an approval loop.
- Grant actions use optimistic Issue revision checks and are idempotent for an already-granted active request.
- Activity and event payloads use the existing secret redaction and diagnostic-length limits.

## Cleanup Result Isolation

Private temporary-directory cleanup must not be part of the primary success result of an Agent turn.

After the streamed turn produces a valid terminal result, the Adapter preserves that result before disposal and cleanup. Cleanup then runs as best-effort secondary work:

- success removes the private directory normally;
- failure appends `AGENT_TEMP_CLEANUP_FAILED` with a sanitized error;
- a bounded background reaper may retry only directories carrying the existing ownership marker;
- cleanup failure never changes Assessment, Repair, Evidence, or Delivery state;
- cleanup must not conceal a primary turn error when the turn itself failed.

Cancellation still attempts process termination and cleanup, but an unremovable directory remains a diagnostic and maintenance concern rather than a reason to replace the Issue's primary outcome.

## Testing

### Core

- Transition Assessment, Repair, and Evidence operations into `PERMISSION_REQUIRED`.
- Preserve the originating operation and status.
- Grant capabilities and restore the exact pending operation.
- Keep permission pauses outside existing retry budgets.
- Revoke grants on `COMPLETED`, `CLOSED`, and `CANCELED`.
- Parse existing Issue JSON without capability fields.

### Agent Adapter

- Accept normal stage outputs and the shared capability-request variant.
- Include request rules and current grants in prompts.
- Keep Assessment and Repair at their defaults without grants.
- Apply each grant combination correctly.
- Keep Evidence at `danger-full-access` with network enabled regardless of grants.
- Run at most one corrective continuation for a likely permission failure.
- Reject unknown, empty, and repeated already-granted requests.
- Preserve a valid turn result when private-temp cleanup throws `ENOTEMPTY`.

### Runtime

- Pause each Agent-backed operation without recording a stage failure.
- Persist a pending request across restart without waking the Worker.
- Grant and resume the same operation, session, and workspace.
- Prevent grants from affecting another Issue in the same project.
- Cancel a permission-blocked Issue and revoke its grants.
- Sanitize request events and UI DTOs.

### Desktop

- Show “权限不足” in Issue status surfaces.
- Render the inline request card without a global modal.
- Show only “授权并继续” and “取消 Issue”.
- Describe `HOST_EXECUTION` as unrestricted host execution.
- Handle stale revision and already-resumed requests safely.

### Regression

Reproduce the OHMYBUG-14 lifecycle boundary: a Repair turn emits a valid completed result, then cleanup of an owned private temporary directory fails with `ENOTEMPTY`. Assert that the implementation result advances to the next normal state, `AGENT_TEMP_CLEANUP_FAILED` is observable, and `REPAIR_FAILED` is not recorded.

## Non-Goals

- Per-command live approval.
- Project-wide, cross-Issue, or permanent grants.
- Automatic escalation based only on operating-system error text.
- Pretending unrestricted host execution is a granular GUI-only permission.
- A custom host execution broker.
- Changing Evidence's current default `danger-full-access` and network-enabled behavior.
