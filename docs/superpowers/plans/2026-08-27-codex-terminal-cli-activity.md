# Codex Terminal CLI Activity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the read-only Codex Terminal surface the public messages, progress states, semantic exploration actions, waits, plans, and streaming command output that the pinned Codex CLI protocol already exposes.

**Architecture:** Normalize the pinned App Server's typed lifecycle and delta notifications into a small public `CodexClientItem` vocabulary, then translate those items into persisted Agent activity events. Preserve the existing terminal renderer and session boundaries, but teach it to merge command-output deltas into the correlated running command and to style CLI-like status/message lines. Only commentary, reasoning summaries, and public tool metadata cross the boundary; raw reasoning content and the structured final answer stay private.

**Tech Stack:** TypeScript 6, Zod 4, React 19, Vitest 4, Testing Library, Codex App Server protocol 0.148.0.

---

### Task 1: Normalize the public App Server event stream

**Files:**
- Modify: `packages/agent-codex/test/app-server/codex-client.test.ts`
- Modify: `packages/agent-codex/src/codex-client.ts`
- Modify: `packages/agent-codex/src/app-server/codex-client.ts`

- [x] **Step 1: Write a failing protocol test**

Emit representative `item/started`, `item/commandExecution/outputDelta`, `item/completed`, and `turn/plan/updated` notifications. Assert that command actions, commentary phase, reasoning summary without raw content, collaboration waits, plans, and output deltas reach the owned turn.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/agent-codex exec vitest run test/app-server/codex-client.test.ts -t "normalizes public CLI activity"
```

Expected: FAIL because the current client ignores typed deltas and plan updates and discards item metadata.

- [x] **Step 3: Implement the minimal protocol normalization**

Extend `CodexClientItem` with public status/message/plan/output variants and preserve IDs, message phase, command actions, and public tool status. Parse only schema-backed notifications correlated to an owned turn. Normalize reasoning from `summary` only, never `content` or `item/reasoning/textDelta`.

- [x] **Step 4: Verify GREEN**

Run the same focused test and require it to pass.

### Task 2: Persist safe CLI-equivalent activities

**Files:**
- Modify: `packages/agent-codex/test/activity.test.ts`
- Modify: `packages/agent-codex/src/codex-agent-adapter.ts`

- [x] **Step 1: Write failing activity tests**

Feed the adapter a turn containing commentary, a reasoning summary, semantic read/search/list actions, a streamed command delta, a wait tool, a plan update, and final structured JSON. Require `Started`, `Working`, `Exploring`/`Explored`, `Waiting`, public messages, and command output activities while asserting that raw reasoning, secrets, and final JSON are absent.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/agent-codex exec vitest run test/activity.test.ts -t "reports CLI-equivalent public activity"
```

Expected: FAIL because `publicActivity` currently returns at most one event and drops messages, reasoning summaries, plans, waits, and updates.

- [x] **Step 3: Implement the minimal activity fan-out**

Replace the one-to-zero mapper with a one-to-many mapper. Keep the existing lifecycle and command events, add correlated public status/message/output events, and sanitize every public detail before persistence. Treat `phase: "commentary"` as displayable and treat unknown/final answer messages as result transport only.

- [x] **Step 4: Verify GREEN**

Run the complete Agent Codex activity and App Server client test files.

### Task 3: Render statuses and live output in Codex Terminal

**Files:**
- Modify: `apps/desktop/test/web/agent-activity.test.tsx`
- Modify: `apps/desktop/src/web/issues/agent-activity.tsx`
- Modify: `apps/desktop/src/web/styles/global.css`

- [x] **Step 1: Write failing UI tests**

Render a current-session sequence containing `Started`, `Working`, `Explored`, `Waiting`, a normal Codex message, a running command, and correlated output deltas. Require every status/message to be visible, deltas to appear beneath the running command without duplicate command rows, and private reasoning/final JSON to remain absent.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/web/agent-activity.test.tsx -t "renders CLI-equivalent statuses"
```

Expected: FAIL because command-output events render as separate generic lines and status lines have no CLI-specific presentation.

- [x] **Step 3: Implement the minimal renderer**

Merge `AGENT_COMMAND_OUTPUT` by correlation ID into the pending command's output. Render `AGENT_STATUS` and `AGENT_MESSAGE` with stable icons/classes, preserving chronological order, horizontal scrolling, autoscroll, current-session filtering, and the read-only boundary.

- [x] **Step 4: Verify GREEN**

Run the full desktop Agent activity test file and typecheck the two affected workspaces.

### Task 4: Acceptance evidence, verification, and integration commit

**Files:**
- Create: `.oh-my-bug-tmp-evidence-tqrB1g/codex-terminal-cli-activity.png`
- Verify: all modified source, test, and plan files.

- [x] **Step 1: Run focused and full verification**

Run:

```bash
pnpm --filter @oh-my-bug/agent-codex test
pnpm --filter @oh-my-bug/desktop test
pnpm --filter @oh-my-bug/agent-codex typecheck
pnpm --filter @oh-my-bug/desktop typecheck
pnpm test
pnpm typecheck
git diff --check
```

Require zero failures.

- [x] **Step 2: Capture a real acceptance run**

Launch the built Electron application with a real Codex App Server and an isolated runtime database, create an actual Assessment, capture the running Codex Terminal showing the implemented statuses/messages/output, and save the screenshot beneath the required Issue evidence directory. The screenshot must come from the running application, not a generated image.

- [x] **Step 3: Review scope and commit**

Inspect the complete diff and status, stage only the plan plus intended source/tests, and commit on `ohmybug/ohmybug-33` without touching the base worktree, remotes, hooks, or Git configuration.
