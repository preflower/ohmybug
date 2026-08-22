# Unrestricted Codex Evidence Capture Design

## Goal

Allow the Codex CLI to start local acceptance services, launch Chromium or Electron, interact with the running product, and write real screenshots or recordings during the dedicated evidence-capture turn.

## Decision

Run only the Codex `EVIDENCE` turn with:

```ts
{
  sandboxMode: "danger-full-access",
  networkAccessEnabled: true,
  approvalPolicy: "never",
}
```

Keep the existing boundaries for all other turns:

- Assessment remains `read-only` with network disabled.
- Repair remains `workspace-write` with network disabled.
- Only the independent `captureEvidence` operation receives unrestricted host access.

This deliberately gives the evidence turn authority to bind localhost ports, launch and stop child processes, use Playwright, and access host GUI facilities. The user has explicitly chosen this trade-off over a host-managed capture broker.

## Data Flow

1. Repair completes under the existing workspace-write sandbox and persists a delivery draft.
2. Runtime queues `CAPTURE_EVIDENCE`.
3. `CodexAgentAdapter.captureEvidence` resumes the existing native Codex thread with unrestricted sandbox and network access.
4. Codex runs the real acceptance target, captures a screenshot or recording beneath the prepared evidence intake directory, and returns a relative path.
5. Runtime imports and inspects the artifact through the existing scoped evidence store.
6. Invalid, missing, or unreviewable media follows the existing evidence retry and failure transitions.

No new Runtime state, database migration, project setting, or host capture service is introduced.

## Containment That Remains

The evidence turn has unrestricted host execution, but the product still enforces the following output boundary:

- returned evidence paths must be relative;
- paths must resolve beneath the per-attempt intake directory;
- symlinks and path escapes remain rejected;
- imported media remains content-addressed and inspected;
- real visual evidence remains mandatory;
- implementation work remains preserved when capture fails.

These checks protect the evidence store. They do not sandbox commands executed by Codex during the evidence turn; unrestricted command execution is intentional in this design.

## Failure Behavior

- A localhost or browser failure remains an evidence failure, not an implementation failure.
- Runtime interruption continues to resume the same evidence operation without incrementing the repair iteration.
- macOS privacy controls may still block OS-level screen recording. Codex should prefer Playwright page/window screenshots, which capture the rendered surface directly.
- The existing automatic evidence retry limit remains unchanged.

## Testing

Add focused adapter coverage proving:

1. `captureEvidence` starts or resumes Codex with `danger-full-access`, network enabled, and approval policy `never`.
2. Assessment remains read-only with network disabled.
3. Repair remains workspace-write with network disabled.
4. The existing relative evidence-path validation remains active.

Run the `@oh-my-bug/agent-codex` test, typecheck, and lint suites. Runtime behavior does not change beyond the options supplied to the evidence turn, so no schema or persistence tests are required.

## Non-goals

- Adding a browser or MCP capability broker.
- Configuring host-managed project capture commands.
- Granting unrestricted access to Assessment or Repair turns.
- Automatically changing macOS Screen Recording permissions.
- Weakening evidence provenance requirements.
