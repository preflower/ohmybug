# Codex App Server Shared Terminal Design

## Goal

Let a user open the native Codex CLI for an active Oh My Bug Issue and interact with the same Codex thread and active turn that the Runtime is already driving.

Oh My Bug and the CLI remain simultaneous clients of one long-lived Codex App Server. CLI input joins the current turn through App Server steering. The feature does not pause the Issue, interrupt the turn, transfer ownership, or require a later hand-back action.

## Product behavior

The Issue detail metadata rail adds an `在 Terminal 中打开` action beside the Agent session. The action is available only for a Codex-backed Issue whose native provider thread has been established.

Selecting the action opens macOS Terminal.app and resumes the Issue thread through the App Server endpoint owned by the current Oh My Bug Runtime:

```text
codex resume <threadId> --remote unix://<socket-path>
```

If the Oh My Bug turn is active, input entered in the CLI is appended to that same turn. App Server serializes the input; this is one turn with multiple clients, not two concurrent turns. Oh My Bug continues to receive the complete event stream and remains responsible for interpreting the structured result of the turn it started.

Closing the Terminal window has no Issue lifecycle effect. If a user remains in the CLI after the Runtime-owned turn completes, the CLI may continue the native Codex thread. Any later CLI-owned turn is external activity and is not interpreted as an Oh My Bug workflow result.

The first increment supports macOS Terminal.app only. Configurable terminal applications, embedded terminals, tray-menu launch actions, non-Codex agents, and remote-machine App Servers are outside scope.

## Chosen approach

Run one long-lived Codex App Server per Oh My Bug Runtime and connect both Oh My Bug and the native Codex CLI to it over a local Unix socket.

This replaces the current SDK-owned headless Codex process model. Keeping the SDK and launching an independent `codex resume` process would reopen persisted history but would not reliably attach to the in-memory active turn. Building an embedded terminal would require PTY lifecycle and terminal rendering without providing the native Codex TUI.

Codex App Server is designed for rich clients, supports Unix-socket transports and CLI `--remote` connections, and exposes `thread/start`, `thread/resume`, `turn/start`, and `turn/steer`. The implementation must pin the Codex binary and protocol schema to the same version. Relevant official documentation: <https://learn.chatgpt.com/docs/app-server>.

## Architecture

```text
Electron main process
  |-- Runtime utility process
  |     |-- CodexAppServerSupervisor
  |     |-- AppServerCodexClient
  |     |-- CodexAgentAdapter
  |     `-- Issue Worker
  |
  `-- AgentTerminalLauncher
          `-- Terminal.app
                `-- codex resume <threadId> --remote unix://<socket>
```

### CodexAppServerSupervisor

The supervisor owns one bundled Codex App Server child process for the Runtime. It:

- resolves the bundled, version-pinned Codex executable;
- creates the Runtime-owned Unix socket beneath the Oh My Bug data root;
- verifies that any stale socket is inside that exact owned location before removing it;
- waits for the App Server transport to accept connections before declaring the Agent available;
- performs one bounded restart after an unexpected exit;
- terminates the App Server and removes its socket during Runtime shutdown; and
- exposes the active endpoint only to trusted Runtime and Electron-main callers.

The socket is local-only and its parent directory is private to the current user. The supervisor must reject an endpoint that exceeds the platform Unix-socket path limit rather than silently switching to a network listener.

### AppServerCodexClient

`AppServerCodexClient` implements the existing `CodexClient` boundary using App Server JSON-RPC instead of `@openai/codex-sdk`. It keeps a long-lived initialized connection, starts or resumes threads, starts turns, requests interruption for existing cancellation flows, and normalizes App Server notifications into the existing `CodexClientEvent` model consumed by `CodexAgentAdapter`.

The current adapter, activity reporter, Worker, stage prompts, output schemas, capability behavior, and SQLite workflow state remain authoritative. Protocol-specific types and parsing stay inside `agent-codex`.

Every Runtime-started turn records both its `threadId` and returned `turnId`. Notification routing uses both identifiers. This correlation is required even when only one Runtime operation is active for an Issue.

### AgentTerminalLauncher

The renderer sends only an `issueId`. It never receives a socket path, provider thread ID, executable path, or shell command.

The Electron main process uses a trusted, non-renderer Runtime operation to resolve an `AgentTerminalLaunchTarget` containing the validated Agent kind, provider thread ID, App Server endpoint, and Issue worktree. It then opens Terminal.app with the bundled Codex executable and fixed argument positions. User-controlled values are passed as arguments and escaped by the macOS launcher; they are not concatenated into an executable shell fragment.

A renderer-safe availability operation returns only whether the selected Issue can be opened and a bounded reason when it cannot. This lets the UI hide or disable the action until the provider thread exists without exposing launch details.

## Runtime data flow

1. Runtime startup starts `CodexAppServerSupervisor` and initializes `AppServerCodexClient`.
2. The first Agent stage for an Issue calls `thread/start` with the stage working directory, model, sandbox, network, approval, and instruction options.
3. The returned App Server `thread.id` is saved in the existing `providerSessionId` field. No database schema migration is required.
4. Later stages call `thread/resume` with that provider thread ID before starting their turn.
5. `turn/start` returns a `turnId`; the client records it as the only turn whose terminal result belongs to the current adapter invocation.
6. Notifications matching the Runtime-owned `threadId` and `turnId` are normalized and reported through the existing Issue activity stream. This includes user input steered from Terminal and the Agent work that follows it.
7. The adapter accepts the final structured Agent message only from its recorded `turnId`. A CLI-owned turn on the same thread cannot satisfy or fail the Runtime invocation.
8. Clicking the UI action asks Electron main to resolve the private launch target and open Terminal.app with `codex resume ... --remote unix://...`.
9. The CLI connects to the same App Server and resumes the same thread. While the Runtime turn is active, CLI input is steered into it by the native TUI/App Server behavior.
10. CLI connection and disconnection do not alter Issue status or enqueue Runtime operations.

## Turn and activity semantics

One Issue may still have at most one Runtime-owned Agent operation and one Runtime-owned active turn. The shared-terminal feature does not weaken the existing per-Issue Worker serialization.

Multiple clients may contribute input to that turn, but App Server determines the total order. Oh My Bug does not create a second turn in response to Terminal input and does not introduce a terminal-control state.

Runtime-owned events continue through the existing activity reporter. Items added after a Terminal steer appear in the same Codex turn group. A later CLI-owned turn may be recorded as external Agent activity when observed, but it must be labeled as external and excluded from stage-result parsing. The first increment does not add new Issue statuses for external activity.

The active stage's existing `outputSchema` remains attached to the Runtime-started turn. User steering may still change the Agent's behavior enough to produce invalid structured output. That condition follows the existing invalid-output failure and retry behavior; the shared-terminal feature does not repair or reinterpret it.

## Compatibility and migration

Existing logical Agent sessions and `providerSessionId` values are retained. The App Server client first attempts `thread/resume` for a thread created by the current SDK integration. Direct compatibility must be proven against the bundled Codex version before release.

If an existing native thread cannot be resumed, the operation reports the current `AGENT_SESSION_UNAVAILABLE` failure and leaves the existing explicit Agent-session rebuild action available. The migration does not silently replace a provider thread or rewrite persisted session history.

The `CodexClient` interface may gain turn correlation and lifecycle methods needed by App Server, but App Server transport types must not leak into Core, Runtime orchestration, Desktop DTOs, or other Agent providers.

### Private temporary-directory compatibility

The current SDK client gives every `workspace-write` turn a private temporary directory inside the Issue worktree and excludes the global temporary directories from the sandbox. The App Server migration must preserve that behavior.

Before starting or resuming a thread for a `workspace-write` stage, the client creates the existing marked private-temp directory and applies a thread-scoped shell-environment override for `TMPDIR`, `TMP`, and `TEMP`. It also preserves the current workspace-write exclusions for global temporary directories. A later stage replaces or clears those thread-scoped values before its turn starts, and turn cleanup removes the owned directory with the existing bounded cleanup behavior.

The exact configuration keys are taken from the generated schema and configuration reference for the pinned Codex build. Equivalent isolation is a migration gate: if the pinned App Server cannot express a per-thread environment override without weakening the sandbox, the implementation must retain an isolated execution boundary rather than silently falling back to the App Server process environment.

## Failure handling

### App Server startup failure

The Runtime reports the Codex Agent as unavailable and preserves all Issue and session records. The desktop remains usable for non-Agent inspection and settings. Startup errors exposed to the renderer are bounded and do not include environment variables, credentials, or raw transport messages.

### Unexpected App Server exit

The supervisor performs one bounded restart. After reconnecting, the client resumes persisted threads as needed. An in-flight Runtime turn whose owning App Server process exited is treated as an interruption, not as a valid completion. Existing Runtime interruption and recovery rules decide whether its operation is resumed.

If restart or thread resume fails, the Issue reaches the existing unavailable-session path. There is no unbounded restart loop.

### Terminal launch failure

Failure to open Terminal.app produces a user-facing error and leaves the active turn untouched. It does not pause, cancel, retry, or revise the Issue.

### CLI connection loss

Closing Terminal or losing the CLI connection has no workflow effect. The Runtime connection remains authoritative for the turn it started.

### Protocol mismatch

The packaged application uses an explicit Codex binary and protocol schema from the same version. Startup verifies the executable version and required App Server methods. A mismatch fails closed before a turn starts.

### Unsafe or stale launch target

Electron main rejects non-Codex sessions, missing provider thread IDs, inactive App Server endpoints, non-absolute worktree paths, socket paths outside the supervisor-owned location, and malformed thread identifiers. Renderer input cannot override any launch-target field.

## Security

- The App Server listens on a private local Unix socket, not a TCP interface.
- The renderer never receives provider session IDs, socket paths, executable paths, or launch commands.
- Private launch-target resolution is excluded from the renderer Runtime-operation allowlist.
- The main process authorizes the IPC sender using the existing trusted-window checks.
- Terminal launching uses a fixed executable and validated arguments. Shell and AppleScript escaping are covered by focused tests.
- App Server output passes through the existing activity sanitization and bounded persistence paths.
- Existing stage sandbox, network, and approval policies remain attached to Runtime-started turns. The launcher does not add bypass flags.

## Testing

### Unit tests

- App Server initialization and JSON-RPC request/response correlation.
- `thread/start`, `thread/resume`, `thread/read`, `turn/start`, `turn/steer` observation, and `turn/interrupt` normalization.
- Notification routing by `threadId` and `turnId`.
- Acceptance of the Runtime-owned turn's final structured message and rejection of a different turn's result.
- Private temporary-directory creation, per-thread environment overrides, global-temp exclusions, stage-to-stage replacement, and bounded cleanup.
- Supervisor readiness, bounded restart, shutdown, version mismatch, socket ownership, and stale-socket behavior.
- Launch-target validation and safe macOS command construction.
- Renderer-safe availability without disclosure of private launch fields.

### Integration tests

- Two clients connect to the same bundled App Server over its Unix socket.
- Client A resumes or starts a thread and starts a turn; client B resumes the same thread and steers input; client A observes completion of the original `turnId`.
- A CLI-owned later turn cannot complete a waiting Runtime stage.
- An existing SDK-created provider thread resumes through App Server, or the test documents a deterministic unavailable-session result handled by the rebuild path.
- App Server exit during a turn reaches Runtime interruption recovery without accepting a stale completion.
- Parallel Issue threads receive distinct private temporary directories and cannot inherit another thread's temporary-directory environment.

The two-client same-active-turn test is a release gate. Official documentation exposes the required remote TUI and steering primitives but does not replace verification against the exact bundled Codex build.

### Existing contracts

All existing `agent-codex` Assessment, Repair, Evidence, finalization recovery, cancellation, capability, activity, and session tests continue to pass through the new client boundary. Runtime restart and recovery tests continue to use the same logical and provider session guarantees.

### Desktop and packaging tests

- Action visibility for openable and unavailable Codex sessions.
- Trusted IPC invocation and rejection of untrusted or malformed requests.
- Terminal launcher success and failure behavior with a stubbed platform launcher.
- No Issue mutation when Terminal opens or closes.
- Packaged runtime contains the pinned Codex executable and matching App Server protocol schema.
- Manual macOS verification opens Terminal.app on an active Issue, shows the same thread, steers the active turn, and reflects the resulting activity in Oh My Bug.

## Acceptance criteria

- An active Codex-backed Issue exposes `在 Terminal 中打开` after its provider thread is established.
- Clicking the action opens macOS Terminal.app in the same native Codex thread through the Runtime-owned App Server.
- Input entered in Terminal during a Runtime-owned active turn is applied to that turn without pausing or interrupting it.
- Oh My Bug displays the resulting activity and parses only the final result belonging to the turn it started.
- Closing Terminal causes no Issue state transition.
- Existing sessions remain resumable or fail through the existing explicit rebuild path.
- App Server failure, protocol mismatch, and terminal-launch failure are bounded and do not corrupt Issue or session persistence.
- No renderer-accessible API reveals or accepts private launch details.

## Non-goals

- Exclusive control transfer, handoff leases, pause-on-open, or hand-back actions.
- Two concurrently active turns for the same Issue.
- Protecting the Runtime workflow from intentional user steering that changes the structured result.
- Configurable terminal applications or Windows/Linux terminal launchers.
- An embedded terminal emulator.
- Tray-menu terminal launch actions.
- Generic terminal launch support for non-Codex Agent providers.
- Remote TCP/WebSocket exposure of the App Server.
