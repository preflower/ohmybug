# Restart-Safe Agent Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Runtime stop, development hot reload, and crash recovery resume active Agent work without producing false Assessment or Repair failures.

**Architecture:** Core owns a typed Agent-interruption contract and one additional durable `EVIDENCE` operation. Runtime claims work with optimistic revisions, restores the same pending operation on restart, and stops its worker loop before requeueing interrupted work. Codex preserves the interruption reason and receives a continuation hint while the existing logical/provider session, workspace, Repair iteration, and delivery remain unchanged.

**Tech Stack:** TypeScript 6, Zod 4, Vitest 4, SQLite/better-sqlite3, React 19, pnpm workspaces, Codex SDK

---

## File map

- `packages/core/src/agent/adapter.ts`: typed cancellation reason, interruption error, and continuation input.
- `packages/core/src/runtime/types.ts`: durable `EVIDENCE` pending operation.
- `packages/agent-codex/src/codex-agent-adapter.ts`: abort active turns with the typed reason.
- `packages/agent-codex/src/prompts.ts`: append the restart-continuation instruction.
- `apps/runtime/src/orchestration/worker.ts`: claim attempt metadata, durable evidence inspection, interruption requeue, and shutdown gate.
- `apps/runtime/src/orchestration/recovery.ts`: requeue abandoned active states instead of failing them.
- `apps/runtime/src/orchestration/commands.ts`: persist user cancellation before aborting the turn.
- `apps/runtime/src/runtime.ts`: distinguish Runtime shutdown from user cancellation and stop redispatch during drain.
- `apps/desktop/src/web/issues/agent-activity.tsx`: present restart as recovery rather than failure.

### Task 1: Define the typed Agent interruption contract

**Files:**
- Modify: `packages/core/src/agent/adapter.ts`
- Modify: `packages/core/test/agent/adapter.test.ts`
- Modify: `apps/runtime/src/testing/demo-agent.ts`
- Modify: `apps/runtime/test/helpers/fakes.ts`
- Modify: `apps/runtime/test/composition.test.ts`
- Modify: `apps/runtime/test/testing/demo-agent.test.ts`

- [ ] **Step 1: Add failing Core contract tests**

Add these imports and cases to `packages/core/test/agent/adapter.test.ts`:

```ts
import {
  AgentTurnInterruptedError,
  isAgentTurnInterruptedError,
  type AgentAdapter,
  type AgentInterruptionReason,
} from "../../src/index.js";

it.each(["RUNTIME_STOPPING", "USER_CANCELED"] as const)(
  "preserves the typed %s interruption reason",
  (reason) => {
    const error = new AgentTurnInterruptedError(reason);

    expect(error).toMatchObject({
      name: "AgentTurnInterruptedError",
      code: "AGENT_TURN_INTERRUPTED",
      reason,
      message: `AGENT_TURN_INTERRUPTED:${reason}`,
    });
    expect(isAgentTurnInterruptedError(error)).toBe(true);
    expect(isAgentTurnInterruptedError(new Error(error.message))).toBe(false);
  },
);

it("passes an explicit reason to Agent cancellation", async () => {
  let canceledWith: AgentInterruptionReason | undefined;
  const adapter: AgentAdapter = {
    async createSession() { return ref; },
    async assess() { return assessment; },
    async repair() { return repair; },
    async cancel(_session, reason) { canceledWith = reason; },
  };

  await adapter.cancel(ref, "USER_CANCELED");
  expect(canceledWith).toBe("USER_CANCELED");
});
```

Use the existing `ref`, `assessment`, and Repair result fixtures already declared by that test file.

- [ ] **Step 2: Run the Core test and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/core exec vitest run test/agent/adapter.test.ts
```

Expected: FAIL because the interruption exports and two-argument `cancel` contract do not exist.

- [ ] **Step 3: Add the Core types and continuation input**

Insert this complete contract in `packages/core/src/agent/adapter.ts` before `ProjectCommands`:

```ts
export type AgentInterruptionReason = "RUNTIME_STOPPING" | "USER_CANCELED";

export class AgentTurnInterruptedError extends Error {
  readonly code = "AGENT_TURN_INTERRUPTED" as const;

  constructor(readonly reason: AgentInterruptionReason) {
    super(`AGENT_TURN_INTERRUPTED:${reason}`);
    this.name = "AgentTurnInterruptedError";
  }
}

export function isAgentTurnInterruptedError(
  value: unknown,
): value is AgentTurnInterruptedError {
  return value instanceof AgentTurnInterruptedError;
}

export interface AgentContinuation {
  reason: "RUNTIME_INTERRUPTED";
  previousAttemptId?: string;
}
```

Add `continuation?: AgentContinuation` to both `AssessInput` and `RepairInput`, and replace the adapter cancellation signature with:

```ts
cancel(
  session: AgentSessionRef,
  reason: AgentInterruptionReason,
): Promise<void>;
```

- [ ] **Step 4: Update all non-Codex adapters and fakes to compile**

Use this implementation shape in `apps/runtime/src/testing/demo-agent.ts` and every inline adapter in `apps/runtime/test/composition.test.ts`:

```ts
async cancel(
  session: AgentSessionRef,
  _reason: AgentInterruptionReason,
): Promise<void> {
  this.assertSession(session);
}
```

In `apps/runtime/test/helpers/fakes.ts`, preserve both values for assertions:

```ts
cancellations: Array<{
  sessionId: string;
  reason: AgentInterruptionReason;
}> = [];

async cancel(
  session: AgentSessionRef,
  reason: AgentInterruptionReason,
): Promise<void> {
  this.canceledSessions.push(session.sessionId);
  this.cancellations.push({ sessionId: session.sessionId, reason });
}
```

Update direct test calls in `packages/core/test/agent/adapter.test.ts` and `apps/runtime/test/testing/demo-agent.test.ts` to pass `"USER_CANCELED"`.

- [ ] **Step 5: Run contract and fake-adapter tests**

Run:

```bash
pnpm --filter @oh-my-bug/core exec vitest run test/agent/adapter.test.ts
pnpm --filter @oh-my-bug/runtime exec vitest run test/testing/demo-agent.test.ts test/composition.test.ts
```

Expected: PASS; TypeScript accepts every `AgentAdapter` implementation.

- [ ] **Step 6: Commit the contract**

```bash
git add packages/core/src/agent/adapter.ts packages/core/test/agent/adapter.test.ts apps/runtime/src/testing/demo-agent.ts apps/runtime/test/helpers/fakes.ts apps/runtime/test/composition.test.ts apps/runtime/test/testing/demo-agent.test.ts
git commit -m "feat(core): type agent turn interruptions"
```

### Task 2: Preserve interruption reasons in the Codex adapter

**Files:**
- Modify: `packages/agent-codex/src/codex-agent-adapter.ts`
- Modify: `packages/agent-codex/test/cancellation.test.ts`

- [ ] **Step 1: Replace cancellation expectations with typed errors**

In `packages/agent-codex/test/cancellation.test.ts`, import `AgentTurnInterruptedError` and replace the simple `RUN_CANCELED` assertion with:

```ts
const result = adapter.assess(session, input);
await started;
await adapter.cancel(session, "RUNTIME_STOPPING");

await expect(result).rejects.toMatchObject({
  code: "AGENT_TURN_INTERRUPTED",
  reason: "RUNTIME_STOPPING",
});
```

Add a second case using `"USER_CANCELED"` and assert the same shape with that reason. Update the existing long-running cancellation loop to pass `"USER_CANCELED"`.

- [ ] **Step 2: Run the cancellation test and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/agent-codex exec vitest run test/cancellation.test.ts
```

Expected: FAIL because `CodexAgentAdapter.cancel` accepts one argument and aborts with the string `cancel`.

- [ ] **Step 3: Abort the active turn with the typed error**

Import the Core types and replace `cancel` with:

```ts
async cancel(
  session: AgentSessionRef,
  reason: AgentInterruptionReason,
): Promise<void> {
  this.assertRef(session);
  const active = this.active.get(session.sessionId);
  if (!active) return;
  active.abort.abort(new AgentTurnInterruptedError(reason));
  await active.done;
}
```

Keep `canceledError` as the single abort conversion point:

```ts
function canceledError(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  return new Error("RUN_CANCELED");
}
```

This preserves the typed object supplied by Runtime while retaining a defensive fallback for foreign AbortSignals.

- [ ] **Step 4: Run Codex tests and type checking**

Run:

```bash
pnpm --filter @oh-my-bug/agent-codex exec vitest run test/cancellation.test.ts
pnpm --filter @oh-my-bug/agent-codex typecheck
```

Expected: PASS; neither interruption is reported as a generic Codex failure.

- [ ] **Step 5: Commit the adapter behavior**

```bash
git add packages/agent-codex/src/codex-agent-adapter.ts packages/agent-codex/test/cancellation.test.ts
git commit -m "fix(agent-codex): preserve interruption reasons"
```

### Task 3: Make evidence inspection a durable operation

**Files:**
- Modify: `packages/core/src/runtime/types.ts`
- Modify: `apps/runtime/src/orchestration/worker.ts`
- Modify: `apps/runtime/test/repair-worker.test.ts`
- Modify: `packages/storage/test/sqlite/recovery-store.test.ts`

- [ ] **Step 1: Write failing dispatch and persistence tests**

Add this assertion after the first `drainOne()` of a successful Repair in `apps/runtime/test/repair-worker.test.ts`:

```ts
expect(store.getIssue(issue.id)).toMatchObject({
  status: "EVIDENCE_CHECK",
  repair: { delivery },
});
expect(store.listPendingOperations()).toEqual([{
  issue: expect.objectContaining({ id: issue.id }),
  operation: "EVIDENCE",
}]);

await worker.drainOne();
expect(store.getIssue(issue.id)?.status).toBe("ACCEPTANCE_REVIEW");
```

In `packages/storage/test/sqlite/recovery-store.test.ts`, persist an `EVIDENCE_CHECK` Issue with operation `EVIDENCE`, reopen the database, and assert:

```ts
expect(reopened.listPendingOperations()).toEqual([{
  issue: evidenceChecking,
  operation: "EVIDENCE",
}]);
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/runtime exec vitest run test/repair-worker.test.ts
pnpm --filter @oh-my-bug/storage exec vitest run test/sqlite/recovery-store.test.ts
```

Expected: FAIL because `EVIDENCE` is not a `PendingOperation` and Repair currently inspects evidence inline.

- [ ] **Step 3: Extend the durable operation union and worker dispatch**

Change `PendingOperation` in `packages/core/src/runtime/types.ts` to:

```ts
export type PendingOperation =
  | "PREPARE"
  | "ASSESS"
  | "REPAIR"
  | "EVIDENCE"
  | "FINALIZE";
```

Add this branch to `RuntimeWorker.drainOne()`:

```ts
if (pending.operation === "EVIDENCE") return this.inspectEvidence(pending.issue);
```

Widen `complete` to accept the Core type:

```ts
private complete(
  previous: Issue,
  next: Issue,
  type: string,
  pending: PendingOperation | null = null,
): boolean {
  return this.dependencies.store.transaction((tx) => {
    const current = this.dependencies.store.getIssue(previous.id);
    if (!current || current.revision !== previous.revision) return false;
    tx.updateIssue(next, previous.revision, pending);
    tx.appendEvent(this.event(next.id, type, "AGENT"));
    return true;
  });
}
```

- [ ] **Step 4: Persist Delivery before inspecting it**

In `repair`, stop after importing and recording the Delivery:

```ts
const delivery = deliverySchema.parse({ summary: result.summary, evidence });
const delivered = recordDelivery(claimed, delivery, this.dependencies.now());
if (this.complete(claimed, delivered, "DELIVERY_READY", "EVIDENCE")) {
  this.emitLifecycle("repair.after", { issue: delivered, project });
}
```

Move the inspection block into this complete method:

```ts
private async inspectEvidence(pending: Issue): Promise<void> {
  const claimed = this.dependencies.store.transaction((tx) => {
    const current = this.dependencies.store.getIssue(pending.id);
    if (!current || current.status !== "EVIDENCE_CHECK" || !current.repair?.delivery) {
      return undefined;
    }
    tx.updateIssue(current, current.revision, null);
    tx.appendEvent(this.event(current.id, "EVIDENCE_CHECK_STARTED"));
    return current;
  });
  if (!claimed?.repair?.delivery) return;

  try {
    const delivery = claimed.repair.delivery;
    const inspections = await Promise.all(delivery.evidence.map((item) =>
      this.dependencies.evidence.inspect(
        claimed.id,
        claimed.repair!.iteration,
        item.evidenceId,
      )));
    const gate = reviewVisualEvidence(delivery, claimed.repair.iteration, inspections);
    if (gate.reviewable) {
      this.complete(
        claimed,
        recordEvidenceAcceptance(claimed, this.dependencies.now()),
        "EVIDENCE_ACCEPTED",
      );
    } else {
      this.requeueEvidence(
        claimed,
        gate.reasons.map((reason) => reason.message).join("\n"),
      );
    }
  } catch (error) {
    this.requeueEvidence(claimed, publicEvidenceFailure(error));
  }
}
```

Delete the old inline inspection block. Keep evidence import and intake cleanup inside `repair`.

- [ ] **Step 5: Run Runtime and Storage tests**

Run:

```bash
pnpm --filter @oh-my-bug/runtime exec vitest run test/repair-worker.test.ts
pnpm --filter @oh-my-bug/storage exec vitest run test/sqlite/recovery-store.test.ts
```

Expected: PASS; `drainOne` exposes the durable boundary and `drain` still reaches human acceptance.

- [ ] **Step 6: Commit durable inspection**

```bash
git add packages/core/src/runtime/types.ts apps/runtime/src/orchestration/worker.ts apps/runtime/test/repair-worker.test.ts packages/storage/test/sqlite/recovery-store.test.ts
git commit -m "refactor(runtime): persist evidence inspection work"
```

### Task 4: Requeue interrupted Agent turns without failed transitions

**Files:**
- Modify: `apps/runtime/src/orchestration/worker.ts`
- Modify: `apps/runtime/test/assessment-worker.test.ts`
- Modify: `apps/runtime/test/repair-worker.test.ts`

- [ ] **Step 1: Add failing Assessment and Repair interruption tests**

In each worker test file, configure the fake operation to throw:

```ts
new AgentTurnInterruptedError("RUNTIME_STOPPING")
```

After `drainOne()`, assert the relevant active status, unchanged Repair iteration, pending operation, and event metadata:

```ts
expect(store.getIssue(issue.id)).toMatchObject({
  status: "REPAIRING",
  repair: { iteration: 1 },
  revision: issue.revision + 1,
});
expect(store.getIssue(issue.id)).not.toHaveProperty("lastFailure");
expect(store.listPendingOperations()[0]?.operation).toBe("REPAIR");
expect(store.readEvents(issue.id)).toContainEqual(expect.objectContaining({
  type: "RUNTIME_INTERRUPTED",
  data: expect.objectContaining({
    stage: "REPAIR",
    reason: "RUNTIME_STOPPING",
    iteration: 1,
    sessionId: "session-1",
    attemptId: expect.any(String),
    revision: issue.revision + 1,
  }),
}));
```

Use the analogous `ASSESSING`/`ASSESS`/`ASSESSMENT` assertions in `assessment-worker.test.ts`.

- [ ] **Step 2: Run the worker tests and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/runtime exec vitest run test/assessment-worker.test.ts test/repair-worker.test.ts
```

Expected: FAIL with `ASSESSMENT_FAILED` or `REPAIR_FAILED` and no pending operation.

- [ ] **Step 3: Attach one attempt ID to each claim**

Generate `attemptId` immediately before each Assessment or Repair claim and include it in the started event:

```ts
const attemptId = this.dependencies.id();
// inside the claim transaction
tx.appendEvent(this.event(next.id, "ASSESSMENT_STARTED", "SYSTEM", { attemptId }));
```

Use the same shape for `REPAIR_STARTED`. Do not add `attemptId` to `Issue` or SQLite tables.

- [ ] **Step 4: Add the interruption requeue transaction**

Import `isAgentTurnInterruptedError` and `PendingOperation`, then add:

```ts
private requeueInterrupted(
  claimed: Issue,
  error: unknown,
  operation: "ASSESS" | "REPAIR",
  attemptId: string,
): boolean {
  if (
    !isAgentTurnInterruptedError(error) ||
    error.reason !== "RUNTIME_STOPPING"
  ) return false;

  return this.dependencies.store.transaction((tx) => {
    const current = this.dependencies.store.getIssue(claimed.id);
    if (!current || current.revision !== claimed.revision) return true;
    const resumable = {
      ...current,
      revision: current.revision + 1,
      updatedAt: this.dependencies.now(),
    };
    tx.updateIssue(resumable, current.revision, operation);
    tx.appendEvent(this.event(resumable.id, "RUNTIME_INTERRUPTED", "SYSTEM", {
      stage: operation === "ASSESS" ? "ASSESSMENT" : "REPAIR",
      reason: error.reason,
      operation,
      attemptId,
      revision: resumable.revision,
      ...(resumable.agentSession
        ? { sessionId: resumable.agentSession.sessionId }
        : {}),
      ...(operation === "REPAIR" && resumable.repair
        ? { iteration: resumable.repair.iteration }
        : {}),
    }));
    return true;
  });
}
```

Call it first in both Agent-operation catch blocks:

```ts
} catch (error) {
  if (this.requeueInterrupted(claimed, error, "REPAIR", attemptId)) return;
  // Existing genuine-failure handling follows unchanged.
}
```

- [ ] **Step 5: Run worker tests and verify GREEN**

Run:

```bash
pnpm --filter @oh-my-bug/runtime exec vitest run test/assessment-worker.test.ts test/repair-worker.test.ts
```

Expected: PASS; genuine Agent errors still reach their existing failed states.

- [ ] **Step 6: Commit interruption requeue**

```bash
git add apps/runtime/src/orchestration/worker.ts apps/runtime/test/assessment-worker.test.ts apps/runtime/test/repair-worker.test.ts
git commit -m "fix(runtime): requeue interrupted agent work"
```

### Task 5: Stop redispatch during shutdown and persist user cancellation first

**Files:**
- Modify: `apps/runtime/src/orchestration/worker.ts`
- Modify: `apps/runtime/src/runtime.ts`
- Modify: `apps/runtime/src/orchestration/commands.ts`
- Modify: `apps/runtime/test/shutdown.test.ts`
- Modify: `apps/runtime/test/commands.test.ts`

- [ ] **Step 1: Write the shutdown-loop and explicit-cancel regressions**

In `apps/runtime/test/shutdown.test.ts`, block Assessment until fake cancellation rejects it with `AgentTurnInterruptedError("RUNTIME_STOPPING")`. Assert after `runtime.stop()`:

```ts
expect(agent.cancellations).toContainEqual({
  sessionId: "session-1",
  reason: "RUNTIME_STOPPING",
});
expect(store.getIssue(created.issue.id)?.status).toBe("ASSESSING");
expect(store.listPendingOperations()[0]?.operation).toBe("ASSESS");
expect(agent.assessSessions).toEqual(["session-1"]);
```

In `apps/runtime/test/commands.test.ts`, start a blocked Repair, call `cancelIssue`, then assert:

```ts
expect(store.getIssue(issue.id)).toMatchObject({
  status: "CANCELED",
  resolution: "CANCELED",
});
expect(agent.cancellations.at(-1)).toEqual({
  sessionId: "session-1",
  reason: "USER_CANCELED",
});
expect(store.listPendingOperations()).toEqual([]);
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/runtime exec vitest run test/shutdown.test.ts test/commands.test.ts
```

Expected: FAIL because shutdown redispatches requeued work and cancellation aborts before the durable state change.

- [ ] **Step 3: Add the worker shutdown gate**

Use this complete lifecycle in `RuntimeWorker`:

```ts
private running?: Promise<void>;
private accepting = true;

beginShutdown(): void {
  this.accepting = false;
}

kick(): void {
  if (!this.accepting) return;
  this.running ??= this.runUntilIdle().finally(() => {
    this.running = undefined;
  });
}

async drain(): Promise<void> {
  if (this.accepting) this.kick();
  await this.running;
}

private async runUntilIdle(): Promise<void> {
  while (
    this.accepting &&
    this.dependencies.store.listPendingOperations().length > 0
  ) await this.drainOne();
}
```

- [ ] **Step 4: Classify Runtime shutdown cancellation**

In `OhMyBugRuntime.stop()`, call the gate before canceling active sessions:

```ts
this.dependencies.commands.stopAccepting();
this.worker.beginShutdown();
await this.dependencies.integrations?.stop();
await Promise.allSettled(
  this.dependencies.store.listIssues().flatMap((issue) => issue.agentSession
    ? [this.dependencies.agents.forSession(issue.agentSession).cancel(
        issue.agentSession,
        "RUNTIME_STOPPING",
      )]
    : []),
);
await this.worker.drain();
```

- [ ] **Step 5: Make explicit cancellation durable before abort**

Replace `RuntimeCommands.cancelIssue` with:

```ts
async cancelIssue(issueId: string): Promise<Issue> {
  this.assertAccepting();
  const canceled = this.change(issueId, "ISSUE_CANCELED", null, (current, now) =>
    transitionIssue(current, "CANCEL", now));
  if (!canceled.agentSession) return canceled;

  try {
    await this.dependencies.agents.forSession(canceled.agentSession).cancel(
      canceled.agentSession,
      "USER_CANCELED",
    );
  } catch (error) {
    this.dependencies.store.transaction((tx) => tx.appendEvent({
      id: this.dependencies.id(),
      issueId,
      type: "AGENT_CANCEL_FAILED",
      actor: "SYSTEM",
      data: { message: publicModuleError(error) },
      occurredAt: this.dependencies.now(),
    }));
  }
  return canceled;
}
```

The revision increment from `CANCEL` makes every pre-cancel worker completion stale.

- [ ] **Step 6: Run shutdown and command tests**

Run:

```bash
pnpm --filter @oh-my-bug/runtime exec vitest run test/shutdown.test.ts test/commands.test.ts test/repair-worker.test.ts
```

Expected: PASS; Runtime stop leaves one durable pending operation and user cancel leaves none.

- [ ] **Step 7: Commit shutdown behavior**

```bash
git add apps/runtime/src/orchestration/worker.ts apps/runtime/src/runtime.ts apps/runtime/src/orchestration/commands.ts apps/runtime/test/shutdown.test.ts apps/runtime/test/commands.test.ts apps/runtime/test/repair-worker.test.ts
git commit -m "fix(runtime): separate restart from user cancellation"
```

### Task 6: Requeue crash-abandoned states exactly once

**Files:**
- Modify: `apps/runtime/src/orchestration/recovery.ts`
- Modify: `apps/runtime/test/recovery.test.ts`
- Modify: `apps/runtime/test/acceptance/restart-flow.test.ts`

- [ ] **Step 1: Replace failure-oriented recovery assertions**

Import `reconcileInterruptedIssues` and replace the recovery table in `apps/runtime/test/recovery.test.ts` with this direct reconciliation test:

```ts
it.each([
  ["ASSESSING", "ASSESS"],
  ["REPAIRING", "REPAIR"],
  ["EVIDENCE_CHECK", "EVIDENCE"],
] as const)("requeues interrupted %s as %s once", async (status, operation) => {
  const { store } = createHarness(new FakeAgent());
  const issue = {
    id: `interrupted-${status}`,
    projectId: project.id,
    projectPath: project.path,
    identifier: `OMB-${status}`,
    title: "Interrupted",
    titleSource: "user" as const,
    status,
    inputs: [],
    agentSession: { agent: "fake", sessionId: "session-1" },
    ...(status === "ASSESSING" ? {} : {
      assessment,
      repair: {
        iteration: 2,
        ...(status === "EVIDENCE_CHECK" ? { delivery } : {}),
      },
    }),
    revision: 3,
    createdAt: now,
    updatedAt: now,
  };
  store.transaction((tx) => tx.insertIssue(issue, "ASSESS"));
  store.transaction((tx) => tx.updateIssue(issue, issue.revision, null));

  const dependencies = {
    store,
    id: eventIds(`recovery-${status}`),
    now: () => now,
  };
  reconcileInterruptedIssues(dependencies);
  reconcileInterruptedIssues(dependencies);

  expect(store.getIssue(issue.id)).toMatchObject({
    status,
    revision: issue.revision + 1,
    ...(status === "REPAIRING" || status === "EVIDENCE_CHECK"
      ? { repair: { iteration: 2 } }
      : {}),
  });
  expect(store.getIssue(issue.id)).not.toHaveProperty("lastFailure");
  expect(store.listPendingOperations()[0]?.operation).toBe(operation);
  expect(store.readEvents(issue.id).filter(
    (event) => event.type === "RUNTIME_INTERRUPTED",
  )).toHaveLength(1);
});
```

Import `delivery` from `test/helpers/fakes.ts`. In the SQLite acceptance test, change the abandoned Assessment expectation from `ASSESSMENT_FAILED` to eventual `ASSESSMENT_REVIEW`, and assert exactly one recovery event.

- [ ] **Step 2: Run recovery tests and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/runtime exec vitest run test/recovery.test.ts test/acceptance/restart-flow.test.ts
```

Expected: FAIL because startup reconciliation still records `RUNTIME_INTERRUPTED` as a failed Issue.

- [ ] **Step 3: Replace failure creation with operation recovery**

Replace `interruptedFailure` with:

```ts
export function interruptedOperation(
  issue: Issue,
): PendingOperation | undefined {
  if (issue.status === "ASSESSING") return "ASSESS";
  if (issue.status === "REPAIRING") return "REPAIR";
  if (issue.status === "EVIDENCE_CHECK" && issue.repair?.delivery) {
    return "EVIDENCE";
  }
  return undefined;
}
```

Change reconciliation to update the unchanged Issue with that pending operation:

```ts
const operation = interruptedOperation(issue);
if (!operation) continue;
dependencies.store.transaction((tx) => {
  const current = dependencies.store.getIssue(issue.id);
  if (!current || current.revision !== issue.revision) return;
  const resumable = {
    ...current,
    revision: current.revision + 1,
    updatedAt: dependencies.now(),
  };
  tx.updateIssue(resumable, current.revision, operation);
  tx.appendEvent({
    id: dependencies.id(),
    issueId: resumable.id,
    type: "RUNTIME_INTERRUPTED",
    actor: "SYSTEM",
    data: {
      from: resumable.status,
      to: resumable.status,
      operation,
      reason: "PROCESS_EXITED",
      revision: resumable.revision,
      ...(resumable.agentSession
        ? { sessionId: resumable.agentSession.sessionId }
        : {}),
      ...(resumable.repair ? { iteration: resumable.repair.iteration } : {}),
    },
    occurredAt: dependencies.now(),
  });
});
```

Keep the initial `pendingIds` guard; it makes recovery idempotent across repeated starts.

- [ ] **Step 4: Run recovery tests and verify GREEN**

Run:

```bash
pnpm --filter @oh-my-bug/runtime exec vitest run test/recovery.test.ts test/acceptance/restart-flow.test.ts
```

Expected: PASS; active status, session, workspace, iteration, and delivery survive reconciliation; Issue revision advances exactly once to fence stale pre-restart completions.

- [ ] **Step 5: Commit crash recovery**

```bash
git add apps/runtime/src/orchestration/recovery.ts apps/runtime/test/recovery.test.ts apps/runtime/test/acceptance/restart-flow.test.ts
git commit -m "fix(runtime): resume crash-interrupted operations"
```

### Task 7: Send a continuation prompt on the resumed provider session

**Files:**
- Modify: `apps/runtime/src/orchestration/worker.ts`
- Modify: `packages/agent-codex/src/prompts.ts`
- Modify: `packages/agent-codex/test/assessment.test.ts`
- Modify: `packages/agent-codex/test/repair.test.ts`
- Modify: `apps/runtime/test/assessment-worker.test.ts`
- Modify: `apps/runtime/test/repair-worker.test.ts`

- [ ] **Step 1: Add failing prompt assertions**

For both Assessment and Repair prompt tests, pass:

```ts
continuation: {
  reason: "RUNTIME_INTERRUPTED",
  previousAttemptId: "attempt-before-restart",
},
```

Assert the prompt contains:

```ts
expect(client.prompts.at(-1)).toContain(
  "The previous turn was interrupted by a Runtime restart.",
);
expect(client.prompts.at(-1)).toContain(
  "Do not redo completed implementation work.",
);
```

- [ ] **Step 2: Run prompt tests and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/agent-codex exec vitest run test/assessment.test.ts test/repair.test.ts
```

Expected: FAIL because prompts ignore `continuation`.

- [ ] **Step 3: Add one shared continuation paragraph**

Add this helper to `packages/agent-codex/src/prompts.ts`:

```ts
function continuationPrompt(
  continuation: AssessInput["continuation"] | RepairInput["continuation"],
): string[] {
  return continuation?.reason === "RUNTIME_INTERRUPTED"
    ? [
        "The previous turn was interrupted by a Runtime restart. Continue the existing work in the supplied workspace. Inspect current files and prior verification before making changes. Do not redo completed implementation work. Complete only the remaining stage requirements.",
      ]
    : [];
}
```

Spread `...continuationPrompt(input.continuation)` immediately after the first instruction in both exported prompt builders.

- [ ] **Step 4: Derive continuation from the durable event**

Add this worker helper:

```ts
private continuation(
  issue: Issue,
  operation: "ASSESS" | "REPAIR",
): AgentContinuation | undefined {
  const interrupted = this.dependencies.store.readEvents(issue.id).findLast((event) =>
    event.type === "RUNTIME_INTERRUPTED" &&
    event.data.operation === operation &&
    event.data.revision === issue.revision);
  if (!interrupted) return undefined;
  return {
    reason: "RUNTIME_INTERRUPTED",
    ...(typeof interrupted.data.attemptId === "string"
      ? { previousAttemptId: interrupted.data.attemptId }
      : {}),
  };
}
```

Compute it before each claim and pass it into the corresponding Agent input:

```ts
continuation: this.continuation(pending, "REPAIR"),
```

Add worker assertions that normal work receives `undefined` and recovered work receives `RUNTIME_INTERRUPTED` without changing `sessionId` or Repair iteration.

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm --filter @oh-my-bug/agent-codex exec vitest run test/assessment.test.ts test/repair.test.ts
pnpm --filter @oh-my-bug/runtime exec vitest run test/assessment-worker.test.ts test/repair-worker.test.ts
```

Expected: PASS; the existing output schemas and provider thread-resume behavior remain unchanged.

- [ ] **Step 6: Commit continuation prompting**

```bash
git add packages/agent-codex/src/prompts.ts packages/agent-codex/test/assessment.test.ts packages/agent-codex/test/repair.test.ts apps/runtime/src/orchestration/worker.ts apps/runtime/test/assessment-worker.test.ts apps/runtime/test/repair-worker.test.ts
git commit -m "feat(runtime): continue agent work after restart"
```

### Task 8: Present restart recovery and prove end-to-end behavior

**Files:**
- Modify: `apps/desktop/src/web/issues/agent-activity.tsx`
- Modify: `apps/desktop/test/web/agent-activity.test.tsx`
- Modify: `apps/runtime/test/acceptance/restart-flow.test.ts`
- Modify: `apps/runtime/test/acceptance/manual-full-flow.test.ts`

- [ ] **Step 1: Add failing activity-copy assertions**

Render `RUNTIME_INTERRUPTED` events with `data.operation` values `ASSESS` and `REPAIR`, then assert:

```ts
expect(screen.getByText("Runtime 已重启，正在恢复分析")).toBeVisible();
expect(screen.getByText("Runtime 已重启，正在恢复实现")).toBeVisible();
expect(screen.queryByText("任务意外中断")).not.toBeInTheDocument();
```

- [ ] **Step 2: Run the UI test and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run test/web/agent-activity.test.tsx
```

Expected: FAIL because the current label says `任务意外中断`.

- [ ] **Step 3: Make the event message data-aware**

Add this branch before the generic label lookup in `AgentActivity`:

```ts
const message = (event: AgentEventDto) => {
  if (typeof event.data.message === "string") return event.data.message;
  if (event.type === "RUNTIME_INTERRUPTED") {
    if (event.data.operation === "ASSESS") return "Runtime 已重启，正在恢复分析";
    if (event.data.operation === "REPAIR") return "Runtime 已重启，正在恢复实现";
    if (event.data.operation === "EVIDENCE") return "Runtime 已重启，正在恢复证据检查";
  }
  return eventLabels[event.type] ?? "状态已更新";
};
```

Change the fallback `RUNTIME_INTERRUPTED` label to `Runtime 已重启，正在恢复任务`.

- [ ] **Step 4: Complete acceptance coverage**

In `restart-flow.test.ts`, add the following SQLite-backed Repair-resume case (using the file's existing `temporaryDatabase`, `runtimeOptions`, `project`, `assessment`, and `FakeAgent` fixtures):

```ts
it("resumes interrupted Repair in the same logical session and iteration", async () => {
  const databasePath = temporaryDatabase("omb-runtime-repair-resume-");
  const projectRoot = join(dirname(databasePath), "project");
  mkdirSync(projectRoot);
  const seededStore = new SqliteRuntimeStore(openRuntimeDatabase(databasePath));
  seededStore.registerProject({ ...project, path: projectRoot });
  const interrupted = {
    id: "interrupted-repair",
    projectId: project.id,
    projectPath: projectRoot,
    identifier: "OMB-RESTART-REPAIR",
    title: "Interrupted repair",
    titleSource: "user" as const,
    status: "REPAIRING" as const,
    inputs: [],
    agentSession: { agent: "fake", sessionId: "session-1" },
    assessment,
    repair: { iteration: 2 },
    revision: 5,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  seededStore.transaction((tx) => tx.insertIssue(interrupted, "REPAIR"));
  seededStore.transaction((tx) => tx.updateIssue(
    interrupted,
    interrupted.revision,
    null,
  ));
  seededStore.close();

  const agent = new FakeAgent();
  const runtime = createRuntime(runtimeOptions(databasePath, agent));
  await runtime.start();
  await runtime.drain();

  expect(runtime.getIssue(interrupted.id)).toMatchObject({
    status: "ACCEPTANCE_REVIEW",
    agentSession: interrupted.agentSession,
    repair: { iteration: 2 },
  });
  expect(agent.repairSessions).toEqual(["session-1"]);
  expect(runtime.readIssueEvents(interrupted.id).filter(
    (event) => event.type === "RUNTIME_INTERRUPTED",
  )).toHaveLength(1);
  await runtime.stop();
});
```

Retain the existing `does not persist a stale Delivery after human cancellation` worker regression as the stale-write proof, and add this assertion to it:

```ts
expect(store.readEvents(issue.id).filter(
  (event) => event.type === "DELIVERY_READY",
)).toHaveLength(0);
```

Add this concrete non-resume assertion to the existing cancellation command test after recreating Runtime around the same SQLite database:

```ts
await reopened.start();
await reopened.drain();
expect(reopened.getIssue(issue.id).status).toBe("CANCELED");
expect(store.listPendingOperations()).toEqual([]);
expect(agent.repairSessions).toEqual(["session-1"]);
```

Keep `manual-full-flow.test.ts` as the genuine-failure control: inject `new Error("provider failed")` and assert `REPAIR_FAILED / AGENT_FAILURE` still occurs.

- [ ] **Step 5: Run UI and Runtime acceptance tests**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run test/web/agent-activity.test.tsx
pnpm --filter @oh-my-bug/runtime exec vitest run test/acceptance/restart-flow.test.ts test/acceptance/manual-full-flow.test.ts
```

Expected: PASS; interruption events never appear as `AGENT_ERROR` or `AGENT_FAILURE`.

- [ ] **Step 6: Commit product behavior**

```bash
git add apps/desktop/src/web/issues/agent-activity.tsx apps/desktop/test/web/agent-activity.test.tsx apps/runtime/test/acceptance/restart-flow.test.ts apps/runtime/test/acceptance/manual-full-flow.test.ts
git commit -m "test: cover restart-safe agent recovery"
```

### Task 9: Run the complete verification gate

**Files:**
- Verify only; no new product files.

- [ ] **Step 1: Run affected package suites**

```bash
pnpm --filter @oh-my-bug/core test
pnpm --filter @oh-my-bug/storage test
pnpm --filter @oh-my-bug/agent-codex test
pnpm --filter @oh-my-bug/runtime test
pnpm --filter @oh-my-bug/desktop test
```

Expected: every suite exits zero.

- [ ] **Step 2: Run repository type checking and lint**

```bash
pnpm typecheck
pnpm lint
```

Expected: both commands exit zero with no TypeScript or Oxlint errors.

- [ ] **Step 3: Audit the recovery invariants**

Run:

```bash
rg -n 'RUNTIME_INTERRUPTED|RUNTIME_STOPPING|USER_CANCELED|operation: "EVIDENCE"' packages apps
git diff --check
git status --short
```

Expected: Runtime interruption is handled before generic failure mapping; cancellation callers always pass a reason; `git diff --check` is silent; only intentional changes are present.

- [ ] **Step 4: Finish with a clean verification state**

If any verification command fails, return to the task that owns the failing file, add a failing regression there, implement the smallest correction, rerun that task's focused command, and repeat this complete gate. Do not create an empty verification commit.
