# Issue Worktree Default Network Design

## Context

Oh My Bug ?! creates an isolated workspace for each Issue and starts Codex through
`@openai/codex-sdk`. The implementation/repair stage currently uses
`workspace-write` while explicitly setting `networkAccessEnabled: false`. As a
result, ordinary dependency installation is treated as an Issue capability
escalation even though network access is a normal requirement of implementation.

This behavior must be owned by the application. Users must not be required to
change `~/.codex/config.toml` or create a global permission profile.

## Decision

Enable network access by default only for the Codex implementation/repair stage:

- assessment remains `read-only` with network disabled;
- repair remains `workspace-write` and enables network;
- evidence capture keeps its existing `danger-full-access` and network-enabled
  behavior;
- `HOST_EXECUTION` remains an explicit Issue-scoped capability request.

The setting is passed through the existing per-thread SDK option
`networkAccessEnabled`. The SDK translates it into the sandbox-specific Codex
configuration for that thread, so the policy ships with the application and
applies independently to every user's Issue worktree.

Both permission calculation and prompt generation must use the same
stage-baseline helper. That helper treats `NETWORK_ACCESS` as already available
during repair, ensuring the Agent is not told to request a capability the SDK
thread already has. Persisted grants are then added on top of the stage baseline.

## Alternatives Considered

1. Keep network disabled and ask for `NETWORK_ACCESS` on demand. This preserves
   the strictest default but creates repeated approval friction for standard
   package-manager operations.
2. Detect and install dependencies before starting Codex. This adds
   ecosystem-specific setup logic, cannot cover arbitrary repositories, and
   moves project commands outside the Agent's implementation context.
3. Enable network for every Codex stage. This grants more access than needed;
   assessment does not install dependencies and should remain read-only/offline.

## Capability Semantics

`NETWORK_ACCESS` remains in the shared capability model for stages or future
policies where networking is not already available. During repair it is an
already-available baseline capability, so a repair result requesting only
`NETWORK_ACCESS` is redundant rather than a user-facing approval request.

This decision supersedes only the Repair network-default rows in the earlier
Issue-scoped capability-request design; the rest of that capability flow remains
unchanged.

No UI, project schema, database migration, or global Codex configuration is
needed.

## Verification

- Add an adapter-level test proving an ungranted repair turn starts/resumes with
  `sandboxMode: "workspace-write"` and `networkAccessEnabled: true`.
- Prove the Repair prompt advertises `NETWORK_ACCESS` as already available and a
  redundant Repair network request does not pause the Issue.
- Preserve tests proving assessment remains offline and evidence capture remains
  unrestricted.
- Run the focused `agent-codex` test suite, then the repository's broader checks
  appropriate to the changed package.
