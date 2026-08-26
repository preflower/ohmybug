# Codex App Server Shared Terminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-turn Codex SDK process with one Runtime-owned Codex App Server and add an Issue-detail action that opens macOS Terminal.app on the same native Codex thread, allowing Terminal input to steer the Runtime-owned active turn.

**Architecture:** `agent-codex` owns the version-pinned Codex binary, generated protocol contract, Unix-socket JSON-RPC transport, App Server supervisor, and `CodexClient` adapter. The Runtime owns that host's lifecycle and exposes one renderer-safe availability operation plus one main-only launch-target operation. Electron main validates the sender and launches a fixed AppleScript with argument-safe values; the renderer receives no thread ID, socket path, executable path, or command.

**Tech Stack:** TypeScript 6, Node.js child processes and Unix sockets, `ws` 8, Zod 4, Codex CLI/App Server 0.148.0, Electron 43, React 19, Vitest 4, Playwright.

---

## Implementation map

New `agent-codex` files:

- `packages/agent-codex/src/app-server/protocol.ts` — focused JSON-RPC and App Server types/parsers.
- `packages/agent-codex/src/app-server/rpc-client.ts` — one initialized WebSocket client over a Unix socket.
- `packages/agent-codex/src/app-server/supervisor.ts` — child process, owned socket, readiness, one restart, shutdown.
- `packages/agent-codex/src/app-server/codex-client.ts` — `CodexClient` implementation and notification normalization.
- `packages/agent-codex/src/app-server/runtime-host.ts` — plugin/lifecycle/terminal-target facade used by Runtime composition.
- `packages/agent-codex/src/codex-binary.ts` — resolution and exact-version verification for `@openai/codex`.
- `packages/agent-codex/protocol/codex_app_server_protocol.schemas.json` — generated schema bundle from the pinned executable.
- `packages/agent-codex/protocol/version.json` — generated exact CLI version metadata.
- `packages/agent-codex/test/app-server/*.test.ts` — protocol, transport, supervisor, adapter, and real-binary gates.

New desktop files:

- `apps/desktop/src/electron/agent-terminal-launcher.ts` — validated Terminal.app launcher.
- `apps/desktop/test/electron/agent-terminal-launcher.test.ts` — escaping/platform/failure tests.

Existing files changed:

- Package manifests and lockfile replace `@openai/codex-sdk` with exact `@openai/codex` and add `ws`/`@types/ws`.
- `packages/agent-codex/src/codex-client.ts` keeps only provider-neutral interfaces/errors.
- `packages/agent-codex/src/codex-agent-adapter.ts` defaults to the App Server client supplied by its runtime host and filters results by `threadId + turnId`.
- Runtime composition/lifecycle/service/protocol files own the host and resolve availability/private launch targets.
- Desktop IPC/API/transport/UI files add the safe click path.
- Packaging scripts copy and verify both the executable and generated schema/version assets.

## Task 1: Pin the executable and generate the protocol contract

**Files:**

- Modify: `package.json`
- Modify: `apps/desktop/package.json`
- Modify: `packages/agent-codex/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `scripts/generate-codex-app-server-protocol.ts`
- Create: `packages/agent-codex/src/codex-binary.ts`
- Create: `packages/agent-codex/protocol/codex_app_server_protocol.schemas.json`
- Create: `packages/agent-codex/protocol/version.json`
- Modify: `packages/core/test/architecture-boundary.test.ts`
- Modify: `apps/desktop/test/electron/packaged-runtime.test.ts`

- [ ] Write failing manifest/architecture tests requiring exact `@openai/codex: "0.148.0"`, `ws: "8.21.3"`, direct `zod`, a direct Desktop build-script dependency on `@oh-my-bug/agent-codex`, and both generated assets in `ohMyBug.runtimeAssets`. Keep the SDK dependency only in `agent-codex` until Task 4 so every intermediate commit remains buildable; Task 4 removes it.

- [ ] Run:

```bash
pnpm vitest run packages/core/test/architecture-boundary.test.ts apps/desktop/test/electron/packaged-runtime.test.ts
```

Expected: FAIL because the SDK is still imported and no generated App Server assets exist.

- [ ] Add `resolveCodexBinary()` without importing SDK internals. Keep the native package/triple mapping currently in `apps/desktop/scripts/packaged-runtime.ts`, but resolve from `@openai/codex/package.json`:

```ts
export const EXPECTED_CODEX_VERSION = "0.148.0";

export interface ResolvedCodexBinary {
  executablePath: string;
  packageVersion: string;
}

export function resolveCodexBinary(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): ResolvedCodexBinary;

export async function verifyCodexBinary(
  resolved: ResolvedCodexBinary,
  execFile: typeof import("node:child_process").execFile,
): Promise<void>;

export async function verifyGeneratedProtocolContract(
  schemaPath: string,
  expectedVersionPath: string,
): Promise<void>;
```

`verifyCodexBinary` must accept only stdout matching `codex-cli 0.148.0`; any other version throws `CODEX_PROTOCOL_VERSION_MISMATCH`. `verifyGeneratedProtocolContract` must strict-parse `version.json`, then assert that the bundled schema contains `initialize`, `thread/start`, `thread/resume`, `thread/read`, `turn/start`, `turn/steer`, and `turn/interrupt`; a missing method throws `CODEX_PROTOCOL_METHOD_MISSING:<method>`.

- [ ] Implement `scripts/generate-codex-app-server-protocol.ts` to resolve the pinned binary, execute `app-server generate-json-schema --out <mkdtemp>`, copy only `codex_app_server_protocol.schemas.json`, and write:

```json
{
  "codexCliVersion": "0.148.0",
  "schemaFile": "codex_app_server_protocol.schemas.json"
}
```

Use `mkdtemp`, explicit validated paths, and `rm(..., { recursive: true, force: true })` in `finally`. Add root script `generate:codex-protocol` and package the two files via:

```json
"ohMyBug": {
  "runtimeAssets": [
    "protocol/codex_app_server_protocol.schemas.json",
    "protocol/version.json"
  ]
}
```

- [ ] Install/update dependencies and generate assets:

```bash
pnpm remove @openai/codex-sdk -w
pnpm --filter @oh-my-bug/desktop remove @openai/codex-sdk
pnpm add @openai/codex@0.148.0 -w
pnpm --filter @oh-my-bug/desktop add '@oh-my-bug/agent-codex@workspace:*'
pnpm --filter @oh-my-bug/agent-codex add @openai/codex@0.148.0 ws@8.21.3 zod@4.4.3
pnpm generate:codex-protocol
```

Expected: lockfile resolves one Codex CLI version and generation exits 0.

- [ ] Run the focused tests again; expected PASS.

- [ ] Commit:

```bash
git add package.json apps/desktop/package.json packages/agent-codex/package.json pnpm-lock.yaml scripts/generate-codex-app-server-protocol.ts packages/agent-codex/src/codex-binary.ts packages/agent-codex/protocol packages/core/test/architecture-boundary.test.ts apps/desktop/test/electron/packaged-runtime.test.ts
git commit -m "build: pin Codex App Server protocol"
```

## Task 2: Build and test the Unix-socket JSON-RPC client

**Files:**

- Create: `packages/agent-codex/src/app-server/protocol.ts`
- Create: `packages/agent-codex/src/app-server/rpc-client.ts`
- Create: `packages/agent-codex/test/app-server/rpc-client.test.ts`
- Modify: `packages/agent-codex/src/index.ts`

- [ ] Write a fake `WebSocketServer({ noServer: true })` test served through `node:http` on a Unix socket. Cover initialize-first ordering, numeric request IDs, out-of-order responses, error responses, notifications, unsupported server requests, disconnect rejection, and abort.

- [ ] Run:

```bash
pnpm --filter @oh-my-bug/agent-codex test -- test/app-server/rpc-client.test.ts
```

Expected: FAIL because the transport does not exist.

- [ ] Define only the focused wire boundary in `protocol.ts`; transport-specific types stay here:

```ts
export type JsonRpcId = number;
export type JsonRpcRequest = { id: JsonRpcId; method: string; params: unknown };
export type JsonRpcResponse =
  | { id: JsonRpcId; result: unknown }
  | { id: JsonRpcId; error: { code: number; message: string; data?: unknown } };
export type JsonRpcNotification = { method: string; params: unknown };

export interface AppServerMethods {
  initialize: { input: InitializeParams; output: InitializeResponse };
  "thread/start": { input: ThreadStartParams; output: ThreadStartResponse };
  "thread/resume": { input: ThreadResumeParams; output: ThreadResumeResponse };
  "thread/read": { input: ThreadReadParams; output: ThreadReadResponse };
  "turn/start": { input: TurnStartParams; output: TurnStartResponse };
  "turn/steer": { input: TurnSteerParams; output: TurnSteerResponse };
  "turn/interrupt": { input: TurnInterruptParams; output: Record<string, never> };
}
```

Use Zod parsers for every request result and notification consumed by Oh My Bug. Unknown notifications are ignored; malformed known notifications fail the owning turn with `CODEX_PROTOCOL_INVALID_MESSAGE`. `initialize()` sends the `initialize` request exactly once and then the required `initialized` client notification before allowing thread requests. Any server request is answered immediately with JSON-RPC `-32601` because Runtime turns use approval policy `never` and do not expose interactive App Server tools.

- [ ] Implement the public transport API:

```ts
export class AppServerRpcClient {
  static connect(endpoint: UnixAppServerEndpoint, options?: RpcClientOptions): Promise<AppServerRpcClient>;
  initialize(): Promise<void>;
  request<Name extends keyof AppServerMethods>(
    method: Name,
    params: AppServerMethods[Name]["input"],
    options?: { signal?: AbortSignal },
  ): Promise<AppServerMethods[Name]["output"]>;
  notifications(): AsyncIterable<JsonRpcNotification>;
  close(): Promise<void>;
}
```

Connect `ws` using the fixed URL `ws://localhost` and `createConnection: () => net.connect(socketPath)`; never construct a TCP listener or accept renderer input as a socket path.

- [ ] Run the focused test and `pnpm --filter @oh-my-bug/agent-codex typecheck`; expected PASS.

- [ ] Commit:

```bash
git add packages/agent-codex/src/app-server packages/agent-codex/test/app-server/rpc-client.test.ts packages/agent-codex/src/index.ts
git commit -m "feat(agent): add App Server RPC transport"
```

## Task 3: Add the App Server supervisor and process lifecycle

**Files:**

- Create: `packages/agent-codex/src/app-server/supervisor.ts`
- Create: `packages/agent-codex/test/app-server/supervisor.test.ts`
- Modify: `packages/agent-codex/src/index.ts`

- [ ] Write failing tests with injected `spawn`, `connect`, filesystem, and clock functions. Cover exact argv, private directory mode, stale owned socket removal, rejection of non-socket/unowned paths, socket path-length failure, readiness timeout, exact version check, one restart only, in-flight generation invalidation, and idempotent shutdown.

- [ ] Run the supervisor test; expected FAIL.

- [ ] Implement this boundary:

```ts
export type UnixAppServerEndpoint = Readonly<{
  transport: "unix";
  socketPath: string;
  remoteUrl: string;
}>;

export class CodexAppServerSupervisor {
  constructor(options: {
    dataRoot: string;
    binary?: ResolvedCodexBinary;
    restartLimit?: 1;
    startupTimeoutMs?: number;
  });
  start(): Promise<AppServerRpcClient>;
  client(): AppServerRpcClient;
  endpoint(): UnixAppServerEndpoint;
  executablePath(): string;
  generation(): number;
  stop(): Promise<void>;
}
```

Use `<dataRoot>/run` with mode `0700` and `<dataRoot>/run/codex-app-server.sock`. Spawn exactly:

```ts
["app-server", "--strict-config", "--listen", `unix://${socketPath}`]
```

Before spawning, verify the executable and generated protocol contract from Task 1. Readiness means the socket accepts a WebSocket connection and `initialize` succeeds. A child exit rejects all clients for that generation; restart is bounded to one and does not pretend an in-flight turn survived.

- [ ] Run focused tests and typecheck; expected PASS.

- [ ] Commit:

```bash
git add packages/agent-codex/src/app-server/supervisor.ts packages/agent-codex/test/app-server/supervisor.test.ts packages/agent-codex/src/index.ts
git commit -m "feat(agent): supervise one Codex App Server"
```

## Task 4: Replace `SdkCodexClient` with the App Server adapter

**Files:**

- Modify: `packages/agent-codex/src/codex-client.ts`
- Create: `packages/agent-codex/src/app-server/codex-client.ts`
- Modify: `packages/agent-codex/src/codex-agent-adapter.ts`
- Modify: `packages/agent-codex/test/codex-client.test.ts`
- Modify: `packages/agent-codex/test/helpers.ts`
- Modify: `packages/agent-codex/test/session.test.ts`
- Create: `packages/agent-codex/test/app-server/codex-client.test.ts`

- [ ] First update fixtures so turn events carry correlation:

```ts
export type CodexClientEvent =
  | { type: "thread.started"; threadId: string }
  | { type: "turn.started"; threadId: string; turnId: string }
  | { type: "turn.completed"; threadId: string; turnId: string }
  | { type: "turn.failed"; threadId: string; turnId: string; message: string }
  | { type: "item.started" | "item.updated" | "item.completed"; threadId: string; turnId: string; item: CodexClientItem }
  | { type: "error" | "cleanup.failed"; message: string };
```

Add a test where notifications for `turn-external` arrive between notifications for `turn-runtime`; the adapter must parse only `turn-runtime` and may report the other events only as external activity.

- [ ] Add failing client tests for `thread/start`, `thread/resume`, `turn/start`, `turn/interrupt`, notification normalization, resume-not-found mapping, output schema forwarding, and disconnect-before-completion.

- [ ] Add failing private-temp tests asserting exact start/resume config:

```ts
config: {
  sandbox_workspace_write: {
    exclude_slash_tmp: true,
    exclude_tmpdir_env_var: true,
  },
  shell_environment_policy: {
    inherit: "all",
    set: { TMPDIR: privateTemp, TMP: privateTemp, TEMP: privateTemp },
  },
}
```

Also assert that a following non-`workspace-write` resume explicitly restores the supervisor's captured baseline `TMPDIR`/`TMP`/`TEMP`, and that the owned temp is removed with the existing three retries/100 ms delay.

- [ ] Run the focused tests; expected FAIL.

- [ ] Implement `AppServerCodexClient` behind the existing `CodexClient` boundary. `runStreamed()` must:

1. Create and mark the private temp when required.
2. call `thread/start` or `thread/resume` with stage config;
3. emit `thread.started` using the response thread ID;
4. call `turn/start`, record its returned turn ID, and emit `turn.started`;
5. route only matching `threadId + turnId` notifications into the owning stream;
6. on abort, issue exactly one `turn/interrupt` after a turn ID exists;
7. end only on matching `turn/completed`; and
8. clean up the private temp without masking a primary failure.

Keep `NativeThreadUnavailableError`, provider-neutral interfaces, item normalization, and cleanup helpers in `codex-client.ts`; delete all SDK imports and `SdkCodexClient` code.

Make `CodexAgentAdapterOptions.client` required and remove the adapter's implicit process-spawning default. Make `codexAgent({ client })` require that client as well; only `CodexAppServerRuntimeHost.plugin` constructs the production plugin.

- [ ] Update `CodexAgentAdapter.turn()` to remember the `turn.started` pair and reject a mismatched correlated completion/result with `AGENT_SESSION_MISMATCH`. Preserve all existing Assessment, Repair, Evidence, capability, cancellation, activity, and rebuild behavior.

- [ ] Run:

```bash
pnpm --filter @oh-my-bug/agent-codex test
pnpm --filter @oh-my-bug/agent-codex typecheck
```

Expected: all package tests PASS and no source import of `@openai/codex-sdk` remains.

- [ ] Commit:

```bash
git add packages/agent-codex/src packages/agent-codex/test
git commit -m "feat(agent): run Codex turns through App Server"
```

## Task 5: Prove the exact binary's shared-turn and environment semantics

**Files:**

- Create: `packages/agent-codex/test/app-server/bundled-app-server.integration.test.ts`
- Modify: `packages/agent-codex/vitest.config.ts`
- Modify: `package.json`

- [ ] Add `test:codex-app-server` as an explicit release-gate script. The test must use `resolveCodexBinary()`, a temporary data root, a temporary git repository, and the real Unix-socket supervisor. It must skip only when `OMB_CODEX_APP_SERVER_INTEGRATION` is not `1`.

- [ ] Add these tests before changing any fallback behavior:

1. Client A starts a thread and turn; client B resumes the same thread and sends `turn/steer` with the exact active turn ID; client A observes the steered user item and completion of that same turn.
2. A later client-B-owned turn cannot complete client A's waiter.
3. A workspace-write command observes all three temp variables inside the marked worktree temp, while a subsequent read-only turn observes the captured baseline rather than the deleted prior temp.
4. A thread created using the former SDK-compatible rollout format either resumes successfully or maps deterministically to `NATIVE_THREAD_UNAVAILABLE` without rewriting its ID.

Use a deterministic prompt such as “wait until a second user message arrives, then return the two messages as JSON” and a bounded 60-second per-test timeout. Do not use production credentials in fixtures or logs.

- [ ] Run:

```bash
OMB_CODEX_APP_SERVER_INTEGRATION=1 pnpm test:codex-app-server
```

Expected: PASS. If shared steer or per-thread environment replacement fails, stop the migration and revise the design; do not weaken sandboxing or emulate sharing with a second turn.

- [ ] Commit:

```bash
git add packages/agent-codex/test/app-server/bundled-app-server.integration.test.ts packages/agent-codex/vitest.config.ts package.json
git commit -m "test(agent): gate shared App Server turns"
```

## Task 6: Own the host in Runtime and add safe/private operations

**Files:**

- Create: `packages/agent-codex/src/app-server/runtime-host.ts`
- Modify: `packages/agent-codex/src/index.ts`
- Modify: `apps/runtime/src/composition.ts`
- Modify: `apps/runtime/src/runtime.ts`
- Modify: `apps/runtime/src/service.ts`
- Modify: `apps/runtime/src/protocol/types.ts`
- Modify: `apps/runtime/src/protocol/schema-definitions.ts`
- Modify: `apps/runtime/src/protocol/operations.ts`
- Modify: `apps/runtime/test/composition.test.ts`
- Modify: `apps/runtime/test/shutdown.test.ts`
- Modify: `apps/runtime/test/protocol/operations.test.ts`
- Modify: `apps/runtime/test/protocol/service.test.ts`

- [ ] Write failing tests for lifecycle order, demo-agent bypass, unavailable reasons, target validation, non-disclosure, and renderer allowlisting. The registry order must add `agentTerminalAvailability` near Issue reads and `resolveAgentTerminalLaunchTarget` with `renderer: false`.

- [ ] Define the public/private DTOs exactly:

```ts
export type AgentTerminalUnavailableReason =
  | "UNSUPPORTED_AGENT"
  | "SESSION_NOT_READY"
  | "WORKSPACE_NOT_READY"
  | "APP_SERVER_UNAVAILABLE";

export type AgentTerminalAvailability =
  | { available: true }
  | { available: false; reason: AgentTerminalUnavailableReason };

export interface AgentTerminalLaunchTarget {
  agent: "codex";
  providerThreadId: string;
  executablePath: string;
  remoteUrl: string;
  workingDirectory: string;
}
```

The availability response is renderer-safe. The launch target is main-only and strict-parsed by the Runtime protocol.

- [ ] Implement `CodexAppServerRuntimeHost`:

```ts
export class CodexAppServerRuntimeHost {
  readonly plugin: AgentPlugin;
  start(): Promise<void>;
  stop(): Promise<void>;
  availability(context: TerminalSessionContext): AgentTerminalAvailability;
  resolveLaunchTarget(context: TerminalSessionContext): AgentTerminalLaunchTarget;
}
```

It constructs one `AppServerCodexClient` from one supervisor and gives that same client to every adapter created by `plugin`. It validates a non-empty UUID-like provider thread ID, absolute existing worktree, active supervisor generation, and supervisor-owned socket before returning a target.

`start()` is bounded but intentionally non-fatal to the wider Runtime: it records `APP_SERVER_UNAVAILABLE` when binary verification, socket creation, or initialization fails. Non-Agent inspection and settings remain usable; an Agent turn then fails through the existing unavailable path. `stop()` remains idempotent whether startup succeeded or failed.

- [ ] Extend `OhMyBugRuntimeDependencies` with optional `agentRuntime: { start(): Promise<void>; stop(): Promise<void> }`. Start it before reconciliation/worker kick. During shutdown, cancel/drain turns first, then stop the Agent host before closing storage. Keep demo tests host-free.

- [ ] In `createDesktopRuntimeComposition`, create the host only when no `agentPlugin` override and demo mode is false; pass its plugin, lifecycle, and terminal provider through the composition. Apply the same construction in `createRuntime()` when its caller does not inject an `AgentAdapter`, using the database directory as the data root. `RuntimeService` resolves the Issue from storage and supplies only trusted stored `agentSession`, `projectPath`, and project agent configuration to the provider.

- [ ] Run:

```bash
pnpm --filter @oh-my-bug/runtime test
pnpm --filter @oh-my-bug/runtime typecheck
```

Expected: PASS; `rendererOperationNames` contains availability but not launch-target resolution.

- [ ] Commit:

```bash
git add packages/agent-codex/src apps/runtime/src apps/runtime/test
git commit -m "feat(runtime): own shared Codex App Server"
```

## Task 7: Add the trusted Terminal.app launch path

**Files:**

- Create: `apps/desktop/src/electron/agent-terminal-launcher.ts`
- Create: `apps/desktop/test/electron/agent-terminal-launcher.test.ts`
- Modify: `apps/desktop/src/electron/desktop-api.ts`
- Modify: `apps/desktop/src/electron/main-ipc.ts`
- Modify: `apps/desktop/src/electron/main.ts`
- Modify: `apps/desktop/test/electron/desktop-api.test.ts`
- Modify: `apps/desktop/test/electron/main-ipc.test.ts`

- [ ] Write failing launcher tests for paths/thread IDs containing spaces, quotes, backslashes, and shell metacharacters; non-macOS rejection; malformed/non-absolute targets; failed `osascript`; and success without any Runtime mutation operation.

- [ ] Add dedicated IPC `oh-my-bug:open-agent-terminal`. The renderer invokes it with exactly `{ issueId }`. Main authorizes via `isTrustedIpcSender`, validates a strict non-empty identifier, then calls the main-only Runtime operation `resolveAgentTerminalLaunchTarget`.

Expose `agentTerminalAvailability(issueId)` through the existing renderer-safe Runtime request channel, and expose only `openAgentTerminal(issueId)` through the dedicated IPC. Add both methods to `DesktopApi`; neither method accepts or returns a launch target.

- [ ] Implement the launcher with `/usr/bin/osascript`, fixed script source, and values passed after `--` as argv:

```applescript
on run argv
  set codexPath to item 1 of argv
  set threadId to item 2 of argv
  set remoteUrl to item 3 of argv
  set workingDirectory to item 4 of argv
  set terminalCommand to "cd " & quoted form of workingDirectory & " && exec " & quoted form of codexPath & " resume " & quoted form of threadId & " --remote " & quoted form of remoteUrl
  tell application "Terminal"
    activate
    do script terminalCommand
  end tell
end run
```

Do not accept a renderer-provided executable, socket, cwd, extra CLI argument, or AppleScript fragment. Return `{ opened: true }`; map errors to `AGENT_TERMINAL_OPEN_FAILED` without pausing, canceling, or retrying the Issue.

- [ ] Ensure `dispose()` removes the new handler and untrusted senders are rejected before any Runtime call.

- [ ] Run:

```bash
pnpm --filter @oh-my-bug/desktop test -- test/electron/agent-terminal-launcher.test.ts test/electron/main-ipc.test.ts test/electron/desktop-api.test.ts
pnpm --filter @oh-my-bug/desktop typecheck
```

Expected: PASS.

- [ ] Commit:

```bash
git add apps/desktop/src/electron apps/desktop/test/electron
git commit -m "feat(desktop): open Agent thread in Terminal"
```

## Task 8: Add the Issue-detail action without leaking private state

**Files:**

- Modify: `apps/desktop/src/web/api/transport.ts`
- Modify: `apps/desktop/src/web/api/desktop-transport.ts`
- Modify: `apps/desktop/src/web/api/browser-development-transport.ts`
- Modify: `apps/desktop/src/web/api/client.ts`
- Modify: `apps/desktop/src/web/app.tsx`
- Modify: `apps/desktop/src/web/styles/global.css`
- Modify: `apps/desktop/test/web/transport.test.ts`
- Modify: `apps/desktop/test/web/app-workbench.test.tsx`

- [ ] Write failing UI/transport tests for all four availability reasons, enabled action, loading de-duplication, success toast, launch error toast, and no sensitive target fields in renderer calls.

- [ ] Extend `ProductTransport` only with:

```ts
agentTerminalAvailability(issueId: string): Promise<AgentTerminalAvailability>;
openAgentTerminal(issueId: string): Promise<{ opened: true }>;
```

Browser development transport returns `{ available: false, reason: "APP_SERVER_UNAVAILABLE" }` and rejects opening; it must not invent a socket endpoint.

- [ ] In `IssueMetadataRail`, query availability when the selected Issue or its Agent session changes. Render `在 Terminal 中打开` beside `Agent 会话`; disable it with a bounded Chinese tooltip until available. On click, disable while pending, call `api.openAgentTerminal(issue.id)`, and use `sonner` for success/failure. Do not change Issue state or refresh solely because Terminal opened.

- [ ] Add focused CSS for a compact row action using existing Button/Tooltip primitives; preserve narrow metadata-rail layout and keyboard focus visibility.

- [ ] Run:

```bash
pnpm --filter @oh-my-bug/desktop test -- test/web/transport.test.ts test/web/app-workbench.test.tsx
pnpm --filter @oh-my-bug/desktop typecheck
```

Expected: PASS.

- [ ] Commit:

```bash
git add apps/desktop/src/web apps/desktop/test/web
git commit -m "feat(ui): expose shared Agent terminal action"
```

## Task 9: Finish packaging and restart/failure coverage

**Files:**

- Modify: `apps/desktop/scripts/packaged-runtime.ts`
- Modify: `apps/desktop/scripts/copy-runtime-assets.ts`
- Modify: `apps/desktop/scripts/verify-packaged-runtime.ts`
- Modify: `apps/desktop/test/electron/packaging.test.ts`
- Modify: `apps/desktop/test/electron/packaged-runtime.test.ts`
- Modify: `apps/desktop/test/electron/utility-runtime.test.ts`
- Modify: `apps/runtime/test/acceptance/restart-flow.test.ts`

- [ ] Write failing packaging tests requiring the generated schema and version metadata in the compiled workspace package and ASAR, the native executable unpacked/executable, and no SDK package dependency.

- [ ] Update `resolveRuntimeResources()` to use `resolveCodexBinary()` and add `codexProtocolSchema`/`codexProtocolVersion` paths. Update `desktopBuildLayout` with the copied package asset paths. `verifyPackagedArchive()` must compare `version.json.codexCliVersion` to the direct `@openai/codex` package version and fail `CODEX_PROTOCOL_VERSION_MISMATCH` before declaring the package valid.

- [ ] Add Runtime restart tests: App Server exit during an owned turn fails that turn, supervisor restarts once, a later operation resumes its persisted thread or follows `AGENT_SESSION_UNAVAILABLE`, and no stale completion is accepted.

- [ ] Run:

```bash
pnpm --filter @oh-my-bug/desktop test -- test/electron/packaging.test.ts test/electron/packaged-runtime.test.ts test/electron/utility-runtime.test.ts
pnpm --filter @oh-my-bug/runtime test -- test/acceptance/restart-flow.test.ts
pnpm build:electron
pnpm doctor:package
```

Expected: PASS and the verifier lists the executable plus both protocol assets.

- [ ] Commit:

```bash
git add apps/desktop/scripts apps/desktop/test/electron apps/runtime/test/acceptance/restart-flow.test.ts
git commit -m "build: package shared Codex App Server"
```

## Task 10: Full regression, security review, and macOS acceptance

**Files:**

- Modify: `README.md`

- [ ] Run source and generated-artifact scans:

```bash
rg -n "@openai/codex-sdk|SdkCodexClient" package.json pnpm-lock.yaml apps packages scripts
rg -n "remoteUrl|socketPath|providerThreadId|executablePath" apps/desktop/src/web
git diff --check
```

Expected: first two searches return no matches; `git diff --check` exits 0.

- [ ] Run all automated checks:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build:desktop
OMB_CODEX_APP_SERVER_INTEGRATION=1 pnpm test:codex-app-server
```

Expected: every command exits 0.

- [ ] Perform the macOS acceptance flow against a disposable Issue/worktree:

1. Start a long-running Runtime-owned turn.
2. Confirm the metadata action becomes enabled only after provider thread persistence.
3. Click `在 Terminal 中打开` and confirm Terminal.app shows the same thread.
4. Enter a steering instruction before the turn ends.
5. Confirm Oh My Bug shows the resulting items under the same active turn and parses its matching final JSON.
6. Close Terminal and confirm Issue status/revision are unchanged by closing.
7. Start a later CLI-only turn and confirm it cannot complete a waiting Runtime stage.
8. Quit the app and confirm the owned socket is removed and no App Server child remains.

- [ ] Document the macOS-only action, the requirement that the provider session already exists, shared-turn steering semantics, and the fact that closing Terminal does not pause or cancel the Issue. Commit it with the verified behavior:

```bash
git add README.md
git commit -m "docs: document shared Agent terminal"
```

- [ ] Review the final branch for these invariants before integration:

- one Runtime-owned App Server, one bounded restart;
- one Runtime-owned active turn per Issue;
- result matching by both thread and turn ID;
- renderer sends only Issue ID and receives only bounded availability/open result;
- private temp isolation is preserved and cleaned;
- opening/closing Terminal makes no Issue transition;
- exact Codex executable and schema versions match.
