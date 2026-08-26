# Issue Pause, Unified Actions, and Contextual Duplicate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make active Agent work pausable and resumable, centralize all Issue actions, and expose duplicate closure only for an Agent-suggested target.

**Architecture:** Core owns a validated `PAUSED + pauseContext` state and dynamic pause/resume transitions. Runtime persists pause before aborting the Agent, resumes by re-enqueuing the recorded operation, and exposes explicit protocol commands. Desktop routes every state through one Issue action component while review renderers remain responsible only for stage-specific input.

**Tech Stack:** TypeScript 6, Zod 4, Vitest 4, React 19, Testing Library, Electron IPC, SQLite RuntimeStore, pnpm workspaces.

---

## File Structure

- `packages/core/src/issue/types.ts`: define `PAUSED` and `IssuePauseContext`.
- `packages/core/src/issue/schema.ts`: validate pause context and its status/operation pairing.
- `packages/core/src/issue/workflow.ts`: implement `PAUSE`, dynamic `RESUME`, and terminal cancel cleanup.
- `packages/core/src/agent/adapter.ts`: distinguish `USER_PAUSED` interruption and `USER_RESUMED` continuation.
- `packages/agent-codex/src/prompts.ts`: tell resumed Assessment, Repair, and evidence turns to continue preserved work.
- `packages/agent-codex/src/finalization-recovery-prompt.ts`: give the same continuation semantics to recovery turns.
- `apps/runtime/src/orchestration/commands.ts`: persist pause/resume/cancel commands and events.
- `apps/runtime/src/orchestration/worker.ts`: derive `USER_RESUMED` continuation from the resume event.
- `apps/runtime/src/orchestration/recovery.ts`: keep paused Issues idle after restart.
- `apps/runtime/src/orchestration/reviews.ts`: conditionally generate and validate duplicate choices.
- `packages/core/src/issue/legacy-review.ts`: conditionally generate duplicate choices for migrated legacy reviews.
- `apps/runtime/src/{runtime.ts,service.ts,protocol/types.ts,protocol/operations.ts}`: expose pause and resume through Runtime protocol.
- `apps/desktop/src/electron/desktop-api.ts`: expose fixed IPC methods.
- `apps/desktop/src/web/api/{transport.ts,desktop-transport.ts,browser-development-transport.ts,client.ts}`: expose ProductTransport pause/resume methods.
- `apps/desktop/src/web/issues/issue-actions.tsx`: own the state-to-action matrix in one location.
- `apps/desktop/src/web/issues/cancel-issue-button.tsx`: own terminal-cancel confirmation and error UI.
- `apps/desktop/src/web/issues/{issue-detail.tsx,review-panel.tsx,capability-request-panel.tsx,review-renderers.tsx}`: delegate actions and keep stage-specific data entry.
- `apps/desktop/src/{shared/issue-status.ts,web/issues/issue-status.tsx,web/issues/agent-activity.tsx,electron/tray-task-model.ts}`: represent pause in status and activity surfaces.
- `apps/desktop/src/web/app.tsx`: connect pause, resume, cancel, retry, review, and permission callbacks to the unified action component.
- Focused tests beside each layer prove red/green behavior before implementation.

## Task 1: Add the Core pause state and workflow

**Files:**
- Modify: `packages/core/src/issue/types.ts`
- Modify: `packages/core/src/issue/schema.ts`
- Modify: `packages/core/src/issue/workflow.ts`
- Test: `packages/core/test/issue/schema.test.ts`
- Test: `packages/core/test/issue/workflow.test.ts`

- [ ] **Step 1: Write failing schema tests**

Add tests that accept only a valid pause context and reject missing, mismatched, or leaked context:

```ts
it("round-trips a paused Repair Issue", () => {
  const paused = {
    ...issue,
    status: "PAUSED" as const,
    pauseContext: {
      operation: "REPAIR" as const,
      resumeStatus: "REPAIRING" as const,
      pausedAt: issue.updatedAt,
    },
  };
  expect(issueSchema.parse(paused)).toEqual(paused);
});

it.each([
  [{ ...issue, status: "PAUSED" }],
  [{ ...issue, pauseContext: {
    operation: "REPAIR",
    resumeStatus: "REPAIRING",
    pausedAt: issue.updatedAt,
  } }],
  [{ ...issue, status: "PAUSED", pauseContext: {
    operation: "ASSESS",
    resumeStatus: "REPAIRING",
    pausedAt: issue.updatedAt,
  } }],
])("rejects invalid pause state %#", (value) => {
  expect(() => issueSchema.parse(value)).toThrow();
});
```

- [ ] **Step 2: Run the schema tests and verify RED**

Run: `pnpm --filter @oh-my-bug/core test -- test/issue/schema.test.ts`

Expected: FAIL because `PAUSED` and `pauseContext` are not part of the schema.

- [ ] **Step 3: Add the pause types and Zod invariant**

Add the exact types:

```ts
export type IssuePauseOperation =
  | "ASSESS"
  | "REPAIR"
  | "CAPTURE_EVIDENCE"
  | "RECOVER_FINALIZATION";

export interface IssuePauseContext {
  operation: IssuePauseOperation;
  resumeStatus:
    | "ASSESSING"
    | "REPAIRING"
    | "EVIDENCE_CAPTURE"
    | "FINALIZATION_RECOVERY";
  pausedAt: string;
}
```

Add `"PAUSED"` to `IssueStatus` and `pauseContext?: IssuePauseContext` to `Issue`. Add a strict `pauseContextSchema`, then refine `issueSchema` with this pairing table:

```ts
const pausePairs = new Set([
  "ASSESS:ASSESSING",
  "REPAIR:REPAIRING",
  "CAPTURE_EVIDENCE:EVIDENCE_CAPTURE",
  "RECOVER_FINALIZATION:FINALIZATION_RECOVERY",
]);

.superRefine((value, context) => {
  if (value.status === "PAUSED" && !value.pauseContext) {
    context.addIssue({ code: "custom", path: ["pauseContext"], message: "PAUSE_CONTEXT_REQUIRED" });
  }
  if (value.status !== "PAUSED" && value.pauseContext) {
    context.addIssue({ code: "custom", path: ["pauseContext"], message: "PAUSE_CONTEXT_NOT_ALLOWED" });
  }
  if (value.pauseContext && !pausePairs.has(
    `${value.pauseContext.operation}:${value.pauseContext.resumeStatus}`,
  )) {
    context.addIssue({ code: "custom", path: ["pauseContext"], message: "PAUSE_CONTEXT_MISMATCH" });
  }
});
```

- [ ] **Step 4: Run the schema tests and verify GREEN**

Run: `pnpm --filter @oh-my-bug/core test -- test/issue/schema.test.ts`

Expected: PASS with no Zod warnings.

- [ ] **Step 5: Write failing workflow tests**

Add table-driven tests for all four pause/resume pairs, preservation, cancellation, and illegal transitions:

```ts
it.each([
  ["ASSESSING", "ASSESS"],
  ["REPAIRING", "REPAIR"],
  ["EVIDENCE_CAPTURE", "CAPTURE_EVIDENCE"],
  ["FINALIZATION_RECOVERY", "RECOVER_FINALIZATION"],
] as const)("pauses and resumes %s", (status, operation) => {
  const approvedAssessment = {
    revision: 1,
    contentHash: "a".repeat(64),
    verdict: "BUG" as const,
    suggestedTitle: "修复支付页",
    reasoning: "路由缺失",
    rootCause: "路由被删除",
    solution: "恢复路由",
  };
  const active = {
    ...issueAt(status),
    agentSession: { agent: "fake", sessionId: "session-1" },
    assessment: status === "ASSESSING" ? undefined : approvedAssessment,
    repair: status === "ASSESSING" ? undefined : { iteration: 2 },
  };
  const paused = transitionIssue(active, "PAUSE", now);
  expect(paused).toMatchObject({
    status: "PAUSED",
    pauseContext: { operation, resumeStatus: status, pausedAt: now },
  });
  const resumed = transitionIssue(paused, "RESUME", now);
  expect(resumed).toMatchObject({
    status,
    agentSession: active.agentSession,
    repair: active.repair,
  });
  expect(resumed.pauseContext).toBeUndefined();
});

it("cancels paused and finalization-failed Issues", () => {
  const paused = transitionIssue(issueAt("REPAIRING"), "PAUSE", now);
  expect(transitionIssue(paused, "CANCEL", now)).toMatchObject({
    status: "CANCELED",
    resolution: "CANCELED",
  });
  expect(transitionIssue(issueAt("FINALIZATION_FAILED"), "CANCEL", now).status)
    .toBe("CANCELED");
});

it.each([
  "RECEIVED",
  "ASSESSMENT_FAILED",
  "EVIDENCE_CHECK",
  "EVIDENCE_FAILED",
  "REPAIR_FAILED",
  "PERMISSION_REQUIRED",
  "REVIEW_REQUIRED",
  "FINALIZATION_FAILED",
] as const)("allows terminal cancellation from passive %s", (status) => {
  expect(transitionIssue(issueAt(status), "CANCEL", now)).toMatchObject({
    status: "CANCELED",
    resolution: "CANCELED",
  });
});

it.each(["ASSESSING", "REPAIRING", "EVIDENCE_CAPTURE", "FINALIZATION_RECOVERY"] as const)(
  "requires pause instead of terminal cancellation while %s is active",
  (status) => expect(() => transitionIssue(issueAt(status), "CANCEL", now))
    .toThrow(/Illegal Issue transition/),
);
```

- [ ] **Step 6: Run workflow tests and verify RED**

Run: `pnpm --filter @oh-my-bug/core test -- test/issue/workflow.test.ts`

Expected: FAIL because `PAUSE` and `RESUME` are unknown actions.

- [ ] **Step 7: Implement minimal dynamic pause/resume transitions**

Add `PAUSE | RESUME` to `IssueAction`. Replace active-state `CANCEL` entries with `PAUSE`, add cancel to every passive/recoverable state from the design, and add `PAUSED: { CANCEL: "CANCELED" }`. Resolve resume dynamically:

```ts
const pauseByStatus = {
  ASSESSING: { operation: "ASSESS", resumeStatus: "ASSESSING" },
  REPAIRING: { operation: "REPAIR", resumeStatus: "REPAIRING" },
  EVIDENCE_CAPTURE: { operation: "CAPTURE_EVIDENCE", resumeStatus: "EVIDENCE_CAPTURE" },
  FINALIZATION_RECOVERY: {
    operation: "RECOVER_FINALIZATION",
    resumeStatus: "FINALIZATION_RECOVERY",
  },
} as const;

function transitionTarget(issue: Issue, action: IssueAction): IssueStatus | undefined {
  if (action === "RESUME") return issue.status === "PAUSED"
    ? issue.pauseContext?.resumeStatus
    : undefined;
  return transitions[issue.status][action];
}
```

When applying `PAUSE`, set `pauseContext` from `pauseByStatus` plus `pausedAt`. When applying `RESUME`, delete `pauseContext`. Existing terminal cleanup must also delete it. Do not change `repair.iteration` for either action.

- [ ] **Step 8: Run Core tests and typecheck**

Run: `pnpm --filter @oh-my-bug/core test`

Expected: all Core tests PASS.

Run: `pnpm --filter @oh-my-bug/core typecheck`

Expected: exit 0.

- [ ] **Step 9: Commit the Core state model**

```bash
git add packages/core/src/issue/types.ts packages/core/src/issue/schema.ts packages/core/src/issue/workflow.ts packages/core/test/issue/schema.test.ts packages/core/test/issue/workflow.test.ts
git commit -m "feat(core): add resumable issue pause state"
```

## Task 2: Distinguish paused Agent turns from canceled Issues

**Files:**
- Modify: `packages/core/src/agent/adapter.ts`
- Modify: `packages/agent-codex/src/prompts.ts`
- Modify: `packages/agent-codex/src/finalization-recovery-prompt.ts`
- Test: `packages/agent-codex/test/cancellation.test.ts`
- Test: `packages/agent-codex/test/assessment.test.ts`
- Test: `packages/agent-codex/test/finalization-recovery.test.ts`

- [ ] **Step 1: Write failing Agent interruption and continuation tests**

Extend cancellation coverage to `USER_PAUSED`, then add prompt assertions:

```diff
-  it.each(["RUNTIME_STOPPING", "USER_CANCELED"] as const)(
+  it.each(["RUNTIME_STOPPING", "USER_CANCELED", "USER_PAUSED"] as const)(
     "aborts the active turn with the %s reason",
```

```ts
it("instructs a user-resumed stage to preserve completed work", async () => {
  const content = {
    verdict: "FEATURE",
    suggestedTitle: "Add CSV export",
    reasoning: "CSV export is a new capability.",
    rootCause: null,
    solution: "Add an export action and CSV serializer.",
    suspectedDuplicateOf: null,
  } as const;
  const sessions = new MemorySessions();
  const client = new FixtureClient([JSON.stringify(content)]);
  const adapter = new CodexAgentAdapter({ client, sessions, id: () => "logical-resume" });
  const current = issue();
  const session = await adapter.createSession({ issue: current, project });
  await bindSession(sessions, "logical-resume");
  await adapter.assess(session, {
    issue: current,
    project,
    continuation: { reason: "USER_RESUMED" },
  });
  expect(client.prompts[0]).toContain("paused by the user");
  expect(client.prompts[0]).toContain("Do not redo completed work");
});

it("instructs resumed finalization recovery to inspect the preserved workspace", () => {
  const prompt = finalizationRecoveryPrompt({
    ...recoveryInput(),
    continuation: { reason: "USER_RESUMED" },
  });
  expect(prompt).toContain("paused by the user");
  expect(prompt).toContain("preserved recovery workspace");
});
```

- [ ] **Step 2: Run focused Agent tests and verify RED**

Run: `pnpm --filter @oh-my-bug/agent-codex test -- test/cancellation.test.ts test/assessment.test.ts test/finalization-recovery.test.ts`

Expected: FAIL because the new reason values are not assignable or rendered.

- [ ] **Step 3: Add the exact reason variants and prompt copy**

Update the public contracts:

```ts
export type AgentInterruptionReason =
  | "RUNTIME_STOPPING"
  | "USER_CANCELED"
  | "USER_PAUSED";

export type AgentContinuation =
  | { reason: "USER_RESUMED" }
  | { reason: "RUNTIME_INTERRUPTED"; previousAttemptId?: string }
  | { reason: "CAPABILITY_GRANTED"; requestId: string; capabilities: AgentCapability[] }
  | {
      reason: "REVIEW_SUBMITTED";
      requestId: string;
      kind: string;
      choiceId: string;
      feedback?: string;
      data?: ReviewJson;
    };
```

Add this branch before the other continuation branches in both prompt builders:

```ts
if (continuation?.reason === "USER_RESUMED") {
  return [
    "The previous Agent turn was paused by the user and is now being continued.",
    "Inspect the preserved workspace and prior verification. Do not redo completed work; finish only the remaining requirements for this stage.",
  ];
}
```

For finalization recovery, specialize the second sentence to “Inspect the preserved recovery workspace...” and retain all existing Git restrictions.

- [ ] **Step 4: Run Agent tests and typecheck**

Run: `pnpm --filter @oh-my-bug/agent-codex test -- test/cancellation.test.ts test/assessment.test.ts test/finalization-recovery.test.ts`

Expected: all focused tests PASS.

Run: `pnpm --filter @oh-my-bug/agent-codex typecheck`

Expected: exit 0.

- [ ] **Step 5: Commit Agent semantics**

```bash
git add packages/core/src/agent/adapter.ts packages/agent-codex/src/prompts.ts packages/agent-codex/src/finalization-recovery-prompt.ts packages/agent-codex/test/cancellation.test.ts packages/agent-codex/test/assessment.test.ts packages/agent-codex/test/finalization-recovery.test.ts
git commit -m "feat(agent): distinguish pause and resume turns"
```

## Task 3: Implement Runtime pause, resume, and restart behavior

**Files:**
- Modify: `apps/runtime/src/orchestration/commands.ts`
- Modify: `apps/runtime/src/orchestration/worker.ts`
- Modify: `apps/runtime/src/orchestration/recovery.ts`
- Modify: `apps/runtime/src/runtime.ts`
- Test: `apps/runtime/test/commands.test.ts`
- Test: `apps/runtime/test/recovery.test.ts`
- Test: `apps/runtime/test/repair-worker.test.ts`

- [ ] **Step 1: Write failing command tests**

Cover persistence ordering, exact resume queue, iteration preservation, and cancellation failure:

```ts
it("persists pause before aborting the active Agent turn", async () => {
  const agent = new FakeAgent();
  const { commands, store } = createHarness(agent);
  const active = reviewedIssue({
    status: "REPAIRING",
    revision: 7,
    repair: { iteration: 2 },
    agentSession: { agent: "fake", sessionId: "session-active" },
  });
  store.transaction((tx) => tx.insertIssue(active, "REPAIR"));
  agent.cancel = async (_session, reason) => {
    expect(reason).toBe("USER_PAUSED");
    expect(store.getIssue(active.id)).toMatchObject({ status: "PAUSED" });
  };

  await expect(commands.pauseIssue(active.id)).resolves.toMatchObject({
    status: "PAUSED",
    pauseContext: { operation: "REPAIR", resumeStatus: "REPAIRING" },
  });
  expect(store.listPendingOperations()).toEqual([]);
});

it("resumes the recorded operation without incrementing Repair iteration", async () => {
  const { commands, store, wakes } = createHarness();
  const active = reviewedIssue({ status: "REPAIRING", repair: { iteration: 2 } });
  store.transaction((tx) => tx.insertIssue(active, "REPAIR"));
  const paused = await commands.pauseIssue(active.id);
  const resumed = commands.resumeIssue(paused.id);

  expect(resumed).toMatchObject({ status: "REPAIRING", repair: { iteration: 2 } });
  expect(resumed.pauseContext).toBeUndefined();
  expect(store.listPendingOperations()).toEqual([{ issue: resumed, operation: "REPAIR" }]);
  expect(wakes()).toBe(1);
});
```

Add this cancellation-failure test:

```ts
it("keeps the Issue paused when Agent interruption fails", async () => {
  const agent = new FakeAgent();
  agent.cancel = async () => { throw new Error("private pause detail"); };
  const { commands, store } = createHarness(agent);
  const active = reviewedIssue({
    status: "REPAIRING",
    agentSession: { agent: "fake", sessionId: "session-active" },
    repair: { iteration: 1 },
  });
  store.transaction((tx) => tx.insertIssue(active, "REPAIR"));

  await expect(commands.pauseIssue(active.id)).resolves.toMatchObject({ status: "PAUSED" });
  expect(store.getIssue(active.id)?.status).toBe("PAUSED");
  expect(store.readEvents(active.id)).toContainEqual(expect.objectContaining({
    type: "AGENT_PAUSE_FAILED",
    data: { message: expect.any(String) },
  }));
});
```

- [ ] **Step 2: Run command tests and verify RED**

Run: `pnpm --filter @oh-my-bug/runtime test -- test/commands.test.ts`

Expected: FAIL because `pauseIssue` and `resumeIssue` do not exist.

- [ ] **Step 3: Implement RuntimeCommands pause and resume**

Use explicit transactions so event metadata and pending operations are atomic:

```ts
async pauseIssue(issueId: string): Promise<Issue> {
  this.assertAccepting();
  const paused = this.dependencies.store.transaction((tx) => {
    const current = this.getIssue(issueId);
    const next = transitionIssue(current, "PAUSE", this.dependencies.now());
    tx.updateIssue(next, current.revision, null);
    tx.appendEvent(this.event(issueId, "ISSUE_PAUSED", {
      operation: next.pauseContext!.operation,
      resumeStatus: next.pauseContext!.resumeStatus,
      revision: next.revision,
    }));
    return next;
  });
  if (!paused.agentSession) return paused;
  try {
    await this.dependencies.agents.forSession(paused.agentSession)
      .cancel(paused.agentSession, "USER_PAUSED");
  } catch (error) {
    this.dependencies.store.transaction((tx) => tx.appendEvent(this.event(
      issueId,
      "AGENT_PAUSE_FAILED",
      { message: publicModuleError(error) },
    )));
  }
  return paused;
}

resumeIssue(issueId: string): Issue {
  this.assertAccepting();
  const resumed = this.dependencies.store.transaction((tx) => {
    const current = this.getIssue(issueId);
    const operation = current.pauseContext?.operation;
    if (!operation) throw new Error("PAUSE_CONTEXT_REQUIRED");
    const next = transitionIssue(current, "RESUME", this.dependencies.now());
    tx.updateIssue(next, current.revision, operation);
    tx.appendEvent(this.event(issueId, "ISSUE_RESUMED", {
      operation,
      resumeStatus: next.status,
      revision: next.revision,
    }));
    return next;
  });
  this.dependencies.wake();
  return resumed;
}
```

Expose both methods from `OhMyBugRuntime`. Keep `cancelIssue` for terminal cancellation and let Core reject active-state cancellation.

- [ ] **Step 4: Write failing continuation and recovery tests**

In `repair-worker.test.ts`, insert a resumed `REPAIRING` Issue with an `ISSUE_RESUMED` event at its current revision and assert the Fake Agent receives:

```ts
expect(agent.repairs.at(-1)?.continuation).toEqual({ reason: "USER_RESUMED" });
```

In `recovery.test.ts`, insert a valid `PAUSED` Issue without a pending operation, run `reconcileInterruptedIssues`, and assert the Issue, revision, event list, and empty pending-operation list are unchanged.

- [ ] **Step 5: Run continuation/recovery tests and verify RED**

Run: `pnpm --filter @oh-my-bug/runtime test -- test/repair-worker.test.ts test/recovery.test.ts`

Expected: FAIL because resume events are not converted into continuation context or typed as paused Issues.

- [ ] **Step 6: Teach the worker about explicit user resume**

At the start of `RuntimeWorker.continuation`, before capability and review continuations, add:

```ts
const resumed = events.findLast((event) =>
  event.type === "ISSUE_RESUMED" &&
  event.data.operation === operation &&
  event.data.revision === issue.revision);
if (resumed) return { reason: "USER_RESUMED" };
```

Do not add `PAUSED` to `interruptedOperation`; this explicitly keeps paused Issues idle after restart.

- [ ] **Step 7: Run all Runtime tests and typecheck**

Run: `pnpm --filter @oh-my-bug/runtime test`

Expected: all Runtime tests PASS.

Run: `pnpm --filter @oh-my-bug/runtime typecheck`

Expected: exit 0.

- [ ] **Step 8: Commit Runtime orchestration**

```bash
git add apps/runtime/src/orchestration/commands.ts apps/runtime/src/orchestration/worker.ts apps/runtime/src/orchestration/recovery.ts apps/runtime/src/runtime.ts apps/runtime/test/commands.test.ts apps/runtime/test/recovery.test.ts apps/runtime/test/repair-worker.test.ts
git commit -m "feat(runtime): pause and resume issue operations"
```

## Task 4: Expose pause and resume through Runtime and Desktop transports

**Files:**
- Modify: `apps/runtime/src/service.ts`
- Modify: `apps/runtime/src/protocol/types.ts`
- Modify: `apps/runtime/src/protocol/operations.ts`
- Modify: `apps/runtime/test/protocol/operations.test.ts`
- Modify: `apps/runtime/test/protocol/service.test.ts`
- Modify: `apps/desktop/src/electron/desktop-api.ts`
- Modify: `apps/desktop/src/web/api/transport.ts`
- Modify: `apps/desktop/src/web/api/desktop-transport.ts`
- Modify: `apps/desktop/src/web/api/browser-development-transport.ts`
- Modify: `apps/desktop/src/web/api/client.ts`
- Modify: `apps/desktop/test/electron/desktop-api.test.ts`
- Modify: `test/e2e/runtime-protocol-fixture.ts`

- [ ] **Step 1: Write failing protocol registry and service tests**

Insert `pauseIssue` and `resumeIssue` immediately before `cancelIssue` in the expected registry order. Parse `{ id: "issue-1" }` through both input schemas. In the service harness, bind the new Runtime methods and assert:

```ts
await expect(service.pauseIssue({ id: active.id })).resolves.toMatchObject({ status: "PAUSED" });
await expect(service.resumeIssue({ id: active.id })).resolves.toMatchObject({ status: "REPAIRING" });
```

- [ ] **Step 2: Run protocol tests and verify RED**

Run: `pnpm --filter @oh-my-bug/runtime test -- test/protocol/operations.test.ts test/protocol/service.test.ts`

Expected: FAIL because neither operation is registered.

- [ ] **Step 3: Add Runtime API and operation definitions**

Add to `RuntimeFacade` and `RuntimeApi`:

```ts
pauseIssue(id: string): Promise<Issue>; // RuntimeFacade
resumeIssue(id: string): Issue;         // RuntimeFacade

pauseIssue(input: { id: string }): Promise<Issue>; // RuntimeApi
resumeIssue(input: { id: string }): Promise<Issue>; // RuntimeApi
```

Add service delegates and renderer-visible operations using `projectIdSchema` and `outputSchemas.issue`:

```ts
pauseIssue: operation({
  input: projectIdSchema,
  output: outputSchemas.issue,
  renderer: true,
  invoke: (service, input) => service.pauseIssue(input),
}),
resumeIssue: operation({
  input: projectIdSchema,
  output: outputSchemas.issue,
  renderer: true,
  invoke: (service, input) => service.resumeIssue(input),
}),
```

- [ ] **Step 4: Write failing Desktop API mapping tests**

Add `pauseIssue` and `resumeIssue` to the frozen API key expectation, invoke both with `issue-1`, and assert fixed request payloads:

```ts
expect(ipc.invoke).toHaveBeenCalledWith("oh-my-bug:request", {
  operation: "pauseIssue",
  payload: { id: "issue-1" },
});
expect(ipc.invoke).toHaveBeenCalledWith("oh-my-bug:request", {
  operation: "resumeIssue",
  payload: { id: "issue-1" },
});
```

- [ ] **Step 5: Run Desktop API test and verify RED**

Run: `pnpm --filter @oh-my-bug/desktop test -- test/electron/desktop-api.test.ts`

Expected: FAIL because the bridge does not expose the methods.

- [ ] **Step 6: Wire every Desktop transport**

Add bridge methods:

```ts
pauseIssue(id: string): Promise<RuntimeOperationOutput<"pauseIssue">>;
resumeIssue(id: string): Promise<RuntimeOperationOutput<"resumeIssue">>;
```

Map them to fixed `request("pauseIssue", { id })` and `request("resumeIssue", { id })` calls. Add ProductTransport methods named `pause(id)` and `resume(id)`, map them in `desktop-transport.ts`, and map both to `readOnly`/`unavailable` in browser and unavailable transports. Add equivalent fixture methods to `test/e2e/runtime-protocol-fixture.ts` so Electron tests satisfy `RuntimeApi`.

- [ ] **Step 7: Run protocol, Desktop API, and type checks**

Run: `pnpm --filter @oh-my-bug/runtime test -- test/protocol/operations.test.ts test/protocol/service.test.ts`

Expected: PASS.

Run: `pnpm --filter @oh-my-bug/desktop test -- test/electron/desktop-api.test.ts`

Expected: PASS.

Run: `pnpm --filter @oh-my-bug/runtime --filter @oh-my-bug/desktop typecheck`

Expected: exit 0.

- [ ] **Step 8: Commit transport support**

```bash
git add apps/runtime/src/service.ts apps/runtime/src/protocol/types.ts apps/runtime/src/protocol/operations.ts apps/runtime/test/protocol/operations.test.ts apps/runtime/test/protocol/service.test.ts apps/desktop/src/electron/desktop-api.ts apps/desktop/src/web/api/transport.ts apps/desktop/src/web/api/desktop-transport.ts apps/desktop/src/web/api/browser-development-transport.ts apps/desktop/src/web/api/client.ts apps/desktop/test/electron/desktop-api.test.ts test/e2e/runtime-protocol-fixture.ts
git commit -m "feat(protocol): expose issue pause and resume"
```

## Task 5: Make duplicate closure conditional and prefilled

**Files:**
- Modify: `apps/runtime/src/orchestration/reviews.ts`
- Modify: `apps/runtime/src/orchestration/commands.ts`
- Modify: `packages/core/src/issue/legacy-review.ts`
- Modify: `apps/runtime/test/assessment-worker.test.ts`
- Modify: `apps/runtime/test/commands.test.ts`
- Modify: `apps/runtime/test/acceptance/restart-flow.test.ts`
- Modify: `apps/desktop/src/web/issues/review-panel.tsx`
- Modify: `apps/desktop/src/web/issues/review-renderers.tsx`
- Modify: `apps/desktop/test/web/review-panel.test.tsx`

- [ ] **Step 1: Write failing Runtime duplicate-choice tests**

Add this table-driven Assessment worker case and extend the existing fake import to include `fakeAssessment`:

```ts
it.each([
  [undefined, ["implement", "reassess"]],
  ["OMB-9", ["implement", "duplicate", "reassess"]],
] as const)("generates contextual duplicate choice for %s", async (candidate, choiceIds) => {
  const agent = new FakeAgent();
  agent.nextAssessment = {
    ...fakeAssessment,
    ...(candidate ? { suspectedDuplicateOf: candidate } : {}),
  };
  const { commands, store, agents, evidence, workspaces } = createHarness(agent);
  const created = await commands.submitManual(project.id, {
    commandId: `duplicate-${candidate ?? "none"}`,
    content: "Checkout fails",
  });
  if (created.kind !== "CREATED") throw new Error("CREATED_REQUIRED");
  await new RuntimeWorker({
    store,
    agents,
    evidence,
    workspaces,
    id: eventIds("duplicate-choice"),
    now: () => "2026-08-25T08:00:00.000Z",
  }).drain();
  expect(store.getIssue(created.issue.id)?.review?.choices.map(({ id }) => id))
    .toEqual(choiceIds);
});
```

Add a command regression for a persisted legacy choice:

```ts
it("rejects a persisted duplicate choice without an Agent candidate", () => {
  const { commands, store } = createHarness();
  const issue = reviewedIssue();
  const legacy = {
    ...issue,
    review: {
      ...issue.review!,
      choices: [...issue.review!.choices, {
        id: "duplicate",
        label: "确认为重复 Issue",
        continuation: { resumeStatus: "CLOSED" as const, resolution: "DUPLICATE" as const },
      }],
    },
  };
  store.transaction((tx) => tx.insertIssue(legacy, null));
  expect(() => commands.submitReview(legacy.id, {
    expectedRevision: legacy.revision,
    requestId: legacy.review.id,
    choiceId: "duplicate",
    data: { duplicateOf: "OMB-9" },
  })).toThrow("DUPLICATE_NOT_SUGGESTED");
  expect(store.getIssue(legacy.id)).toEqual(legacy);
  expect(store.readEvents(legacy.id)).toEqual([]);
});
```

- [ ] **Step 2: Run Runtime duplicate tests and verify RED**

Run: `pnpm --filter @oh-my-bug/runtime test -- test/assessment-worker.test.ts test/commands.test.ts`

Expected: FAIL because `duplicate` is unconditional and legacy submission is accepted.

- [ ] **Step 3: Conditionally generate and validate the choice**

In both `assessmentChoices` functions, replace the unconditional push with:

```ts
if (issue.assessment?.suspectedDuplicateOf?.trim()) {
  choices.push({
    id: "duplicate",
    label: "确认为重复 Issue",
    continuation: { resumeStatus: "CLOSED", resolution: "DUPLICATE" },
  });
}
```

Before resolving a submitted duplicate in `submitReview`, enforce the same invariant:

```ts
if (!before.assessment?.suspectedDuplicateOf?.trim()) {
  throw new Error("DUPLICATE_NOT_SUGGESTED");
}
```

Update existing Runtime duplicate tests and restart acceptance fixtures to set a real `suspectedDuplicateOf` candidate when duplicate is intended.

- [ ] **Step 4: Write failing Desktop filtering and prefill tests**

Create two Assessment review fixtures. The first deliberately contains a persisted legacy `duplicate` choice without a candidate and asserts no duplicate radio exists. The second includes `suspectedDuplicateOf: "CHK-9"`, selects duplicate, and asserts:

```ts
expect(screen.getByRole("textbox", { name: "重复 Issue" })).toHaveValue("CHK-9");
fireEvent.click(screen.getByRole("button", { name: "确认为重复 Issue" }));
expect(onSubmit).toHaveBeenCalledWith({
  expectedRevision: assessmentIssue.revision,
  requestId: "review-assessment-duplicate",
  choiceId: "duplicate",
  data: { duplicateOf: "CHK-9" },
});
```

Switch from duplicate to implement and assert the implementation submission contains only `{ title: ... }`, never `duplicateOf`.

- [ ] **Step 5: Run Desktop review tests and verify RED**

Run: `pnpm --filter @oh-my-bug/desktop test -- test/web/review-panel.test.tsx`

Expected: FAIL because legacy duplicate choices remain visible and the candidate is not defaulted.

- [ ] **Step 6: Filter legacy choices and keep per-choice response state**

Inside `ReviewPanelContent`, derive visible choices and selected choice from the candidate invariant:

```ts
const choices = useMemo(() => review.choices.filter((choice) =>
  choice.id !== "duplicate" || Boolean(issue.assessment?.suspectedDuplicateOf?.trim())),
  [issue.assessment?.suspectedDuplicateOf, review.choices],
);
```

Replace the single `data` state with per-choice state so values never leak across choices:

```ts
const [dataByChoice, setDataByChoice] = useState<Record<string, ReviewSubmissionInput["data"]>>({});
const data = dataByChoice[choiceId];
const defaultData = review.kind === "assessment"
  ? choiceId === "implement"
    ? { title: issue.assessment?.suggestedTitle ?? issue.title }
    : choiceId === "duplicate" && issue.assessment?.suspectedDuplicateOf
      ? { duplicateOf: issue.assessment.suspectedDuplicateOf }
      : undefined
  : undefined;
const response = data ?? defaultData;
```

Pass `response` to `ReviewRenderer` and update only the current choice:

```tsx
<ReviewRenderer
  issue={issue}
  choiceId={choiceId}
  data={response}
  onDataChange={(next) => setDataByChoice((current) => ({
    ...current,
    [choiceId]: next,
  }))}
/>
```

Initialize `choiceId` from `choices[0]` and render `choices`, not the raw persisted list.

Translate duplicate failures before rendering the existing destructive alert:

```ts
function reviewError(error: unknown): string {
  const message = error instanceof Error ? error.message : "审核提交失败";
  if (message.includes("DUPLICATE_TARGET_SELF")) return "不能把 Issue 标记为自身的重复项。";
  if (message.includes("DUPLICATE_TARGET_NOT_FOUND")) return "找不到该项目中的目标 Issue，请检查编号。";
  if (message.includes("DUPLICATE_NOT_SUGGESTED")) return "当前 Assessment 没有提供疑似重复目标。";
  return message;
}
```

Extend the invalid-candidate Desktop test to reject with `DUPLICATE_TARGET_NOT_FOUND` and assert the actionable Chinese message remains inside the review panel while its controls stay enabled.

- [ ] **Step 7: Run Runtime and Desktop duplicate suites**

Run: `pnpm --filter @oh-my-bug/runtime test -- test/assessment-worker.test.ts test/commands.test.ts test/acceptance/restart-flow.test.ts`

Expected: PASS.

Run: `pnpm --filter @oh-my-bug/desktop test -- test/web/review-panel.test.tsx`

Expected: PASS.

- [ ] **Step 8: Commit contextual duplicate behavior**

```bash
git add apps/runtime/src/orchestration/reviews.ts apps/runtime/src/orchestration/commands.ts packages/core/src/issue/legacy-review.ts apps/runtime/test/assessment-worker.test.ts apps/runtime/test/commands.test.ts apps/runtime/test/acceptance/restart-flow.test.ts apps/desktop/src/web/issues/review-panel.tsx apps/desktop/src/web/issues/review-renderers.tsx apps/desktop/test/web/review-panel.test.tsx
git commit -m "fix(review): show duplicate only for agent candidates"
```

## Task 6: Build the unified Issue action area

**Files:**
- Create: `apps/desktop/src/web/issues/issue-actions.tsx`
- Create: `apps/desktop/src/web/issues/cancel-issue-button.tsx`
- Modify: `apps/desktop/src/web/issues/issue-detail.tsx`
- Modify: `apps/desktop/src/web/issues/review-panel.tsx`
- Modify: `apps/desktop/src/web/issues/capability-request-panel.tsx`
- Modify: `apps/desktop/src/web/app.tsx`
- Modify: `apps/desktop/src/web/styles/global.css`
- Modify: `apps/desktop/src/shared/issue-status.ts`
- Modify: `apps/desktop/src/web/issues/issue-status.tsx`
- Modify: `apps/desktop/src/web/issues/agent-activity.tsx`
- Modify: `apps/desktop/src/electron/tray-task-model.ts`
- Test: `apps/desktop/test/web/issues.test.tsx`
- Test: `apps/desktop/test/web/review-panel.test.tsx`
- Test: `apps/desktop/test/web/agent-activity.test.tsx`
- Test: `apps/desktop/test/electron/tray-task-model.test.ts`
- Test: `apps/desktop/test/web/app-workbench.test.tsx`

- [ ] **Step 1: Write the failing action-matrix tests**

Replace active-cancel expectations with pause and add paused/passive/finalizing cases:

```ts
it("pauses an active Agent without canceling the Issue", async () => {
  const onPause = vi.fn(async () => undefined);
  const onCancel = vi.fn(async () => undefined);
  render(<IssueDetail
    issue={{ ...issue, status: "REPAIRING" }}
    onPause={onPause}
    onCancel={onCancel}
    onRefresh={async () => undefined}
  />);
  fireEvent.click(screen.getByRole("button", { name: "暂停 Agent" }));
  await vi.waitFor(() => expect(onPause).toHaveBeenCalledOnce());
  expect(onCancel).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "取消 Issue" })).not.toBeInTheDocument();
});

it("continues or cancels a paused Issue from one action area", () => {
  render(<IssueDetail
    issue={{
      ...issue,
      status: "PAUSED",
      pauseContext: {
        operation: "REPAIR",
        resumeStatus: "REPAIRING",
        pausedAt: timestamp,
      },
    }}
    onResume={async () => undefined}
    onCancel={async () => undefined}
    onRefresh={async () => undefined}
  />);
  const actions = screen.getByRole("region", { name: "Issue 操作" });
  expect(within(actions).getByRole("button", { name: "继续执行" })).toBeVisible();
  expect(within(actions).getByRole("button", { name: "取消 Issue" })).toBeVisible();
});
```

For `ASSESSMENT_FAILED`, assert retry/rebuild and cancel share the same `Issue 操作` region. For `FINALIZING`, `COMPLETED`, `CLOSED`, and `CANCELED`, assert the region is absent.

- [ ] **Step 2: Write the failing cancel-confirmation test**

Click “取消 Issue”, assert a dialog named “确认取消 Issue？” opens, assert the callback has not run, then click “确认取消” and wait for exactly one callback and one refresh. Reject the callback once and assert the dialog remains actionable with an accessible destructive error.

- [ ] **Step 3: Run Issue UI tests and verify RED**

Run: `pnpm --filter @oh-my-bug/desktop test -- test/web/issues.test.tsx test/web/review-panel.test.tsx`

Expected: FAIL because active actions still terminal-cancel and no paused UI exists.

- [ ] **Step 4: Implement the shared cancel button**

Create `CancelIssueButton` with a secondary trigger and confirmation dialog:

```tsx
export function CancelIssueButton({ disabled, onCancel }: {
  disabled?: boolean;
  onCancel(): Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const confirm = async () => {
    setBusy(true);
    setError("");
    try {
      await onCancel();
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "取消失败");
    } finally {
      setBusy(false);
    }
  };
  return <>
    <Button disabled={disabled || busy} type="button" variant="secondary" onClick={() => setOpen(true)}>
      取消 Issue
    </Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>确认取消 Issue？</DialogTitle>
          <DialogDescription>Issue 将进入“已取消”终态，不能继续执行。</DialogDescription>
        </DialogHeader>
        {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
        <DialogFooter>
          <DialogClose render={<Button disabled={busy} type="button" variant="secondary" />}>返回</DialogClose>
          <Button disabled={busy} type="button" variant="destructive" onClick={() => void confirm()}>
            {busy ? "取消中…" : "确认取消"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
```

Use this component in review and permission panels instead of their direct cancel buttons.

- [ ] **Step 5: Implement one state router for Issue actions**

Create `IssueActions` with these exact sets:

```ts
const pauseable = new Set<IssueDto["status"]>([
  "ASSESSING", "REPAIRING", "EVIDENCE_CAPTURE", "FINALIZATION_RECOVERY",
]);
const terminalOrPublishing = new Set<IssueDto["status"]>([
  "FINALIZING", "COMPLETED", "CLOSED", "CANCELED",
]);
```

The component returns one `<section aria-label="Issue 操作" className="issue-actions">` and selects contents in this order:

1. terminal/publishing: return `null`;
2. `REVIEW_REQUIRED`: render `ReviewPanel` plus shared terminal cancel;
3. `PERMISSION_REQUIRED`: render `CapabilityRequestPanel` plus shared terminal cancel;
4. pauseable: render “暂停 Agent” with copy that it can continue later;
5. `PAUSED`: render “继续执行” and shared terminal cancel;
6. failure status: render existing retry/rebuild/finalization-repair action and shared terminal cancel;
7. every other interruptible state: render shared terminal cancel.

Own asynchronous pause/resume/retry/rebuild errors inside this component and keep the buttons visible after failure. Move the existing action-state logic out of `IssueDetail`; render `IssueActions` exactly once after the Issue document content.

- [ ] **Step 6: Connect ProductTransport callbacks**

In `app.tsx`, pass:

```tsx
onPause={() => action(api.pause(selected.id))}
onResume={() => action(api.resume(selected.id))}
onCancel={() => action(api.cancel(selected.id))}
```

Keep refresh behavior in the Issue action boundary so each successful action refreshes once. Update the app workbench test to spy on `api.pause`, `api.resume`, and `api.cancel` independently.

- [ ] **Step 7: Add pause status, activity, and tray coverage first**

Update tests to expect:

```ts
expect(issueStatusLabels.PAUSED).toBe("已暂停");
expect(classifyTrayStatus("PAUSED")).toBe("attention");
expect(classifyTrayIndicator("PAUSED")).toBe("review");
expect(screen.getByText("Issue 已暂停")).toBeVisible();
expect(screen.getByText("Issue 已继续执行")).toBeVisible();
```

Also assert `ISSUE_PAUSED` closes the visible Agent turn as `interrupted`, not `canceled`, while `ISSUE_RESUMED` starts no fake command line by itself.

- [ ] **Step 8: Run status/activity tests and verify RED**

Run: `pnpm --filter @oh-my-bug/desktop test -- test/web/agent-activity.test.tsx test/electron/tray-task-model.test.ts`

Expected: FAIL because exhaustive status records and event labels do not include `PAUSED`.

- [ ] **Step 9: Implement pause presentation and styles**

Add `PAUSED: "已暂停"`, use a review/attention badge variant, add `PAUSED` to tray attention and review sets, and add event labels:

```ts
ISSUE_PAUSED: "Issue 已暂停",
ISSUE_RESUMED: "Issue 已继续执行",
AGENT_PAUSE_FAILED: "Agent 暂停请求未正常结束",
```

Teach activity grouping that `ISSUE_PAUSED` closes a running turn with `interrupted` status. Add `.issue-actions` styles by consolidating the existing approval/failure/capability action spacing; do not create multiple fixed or sticky docks.

- [ ] **Step 10: Run all Desktop tests and typecheck**

Run: `pnpm --filter @oh-my-bug/desktop test`

Expected: all Desktop tests PASS.

Run: `pnpm --filter @oh-my-bug/desktop typecheck`

Expected: exit 0.

- [ ] **Step 11: Commit the unified Desktop actions**

```bash
git add apps/desktop/src/web/issues/issue-actions.tsx apps/desktop/src/web/issues/cancel-issue-button.tsx apps/desktop/src/web/issues/issue-detail.tsx apps/desktop/src/web/issues/review-panel.tsx apps/desktop/src/web/issues/capability-request-panel.tsx apps/desktop/src/web/app.tsx apps/desktop/src/web/styles/global.css apps/desktop/src/shared/issue-status.ts apps/desktop/src/web/issues/issue-status.tsx apps/desktop/src/web/issues/agent-activity.tsx apps/desktop/src/electron/tray-task-model.ts apps/desktop/test/web/issues.test.tsx apps/desktop/test/web/review-panel.test.tsx apps/desktop/test/web/agent-activity.test.tsx apps/desktop/test/electron/tray-task-model.test.ts apps/desktop/test/web/app-workbench.test.tsx
git commit -m "feat(desktop): unify issue lifecycle actions"
```

## Task 7: Prove restart, stale-result, and packaged Desktop behavior

**Files:**
- Modify: `apps/runtime/test/acceptance/restart-flow.test.ts`
- Modify: `apps/runtime/test/repair-worker.test.ts`
- Modify: `apps/runtime/test/evidence-worker.test.ts`
- Modify: `apps/runtime/test/finalization-recovery-worker.test.ts`
- Modify: `apps/desktop/test/electron/e2e/recovery-and-cancel.spec.ts`
- Modify: `docs/agent-core.md`

- [ ] **Step 1: Write failing acceptance coverage for pause across restart**

Create an active Repair fixture, pause it, close and reopen Runtime, and assert no pending operation is reconstructed. Resume it after reopen and assert exactly one `REPAIR` operation runs with `USER_RESUMED`, the same session ID, the same Repair iteration, and preserved workspace context.

- [ ] **Step 2: Write failing stale-result tests for every pausable worker stage**

Use a deferred Agent result in Assessment, Repair, evidence capture, and finalization recovery. Pause after the turn starts, resolve the deferred result, drain the worker, and assert the stored Issue remains equal to the paused snapshot. Events may be appended separately, but the old result must not add Assessment, Delivery, or finalization changes to the Issue.

- [ ] **Step 3: Run acceptance and worker tests and verify RED or expose gaps**

Run: `pnpm --filter @oh-my-bug/runtime test -- test/acceptance/restart-flow.test.ts test/assessment-worker.test.ts test/repair-worker.test.ts test/evidence-worker.test.ts test/finalization-recovery-worker.test.ts`

Expected: the pause/resume acceptance test passes after Tasks 1–6. Any stale-result failure identifies a worker completion path that lacks the required revision/status guard; already-protected paths may pass without further production changes.

- [ ] **Step 4: Add only the missing worker guards**

For any failing completion path, require both the claimed revision and original active status before mutation:

```ts
if (!current || current.revision !== claimed.revision || current.status !== claimed.status) {
  return;
}
```

Do not special-case `PAUSED` by overwriting or auto-resuming it.

- [ ] **Step 5: Update packaged Electron cancellation flow to pause/resume**

Change the active-turn E2E to click “暂停 Agent”, wait for “已暂停”, assert “继续执行” and “取消 Issue” are visible, then click “继续执行” and wait for the original stage to resume. Keep a separate passive-state test that confirms “取消 Issue” reaches “已取消” only after confirmation.

- [ ] **Step 6: Update architecture documentation**

In `docs/agent-core.md`, document:

```text
pauseIssue first persists PAUSED + pauseContext, then interrupts the current Agent turn.
resumeIssue consumes pauseContext and requeues the original operation with USER_RESUMED continuation.
cancelIssue is terminal and is not used to pause an Agent.
Duplicate closure is offered only for a human-confirmed suspectedDuplicateOf candidate.
```

- [ ] **Step 7: Run the focused acceptance and Electron tests**

Run: `pnpm --filter @oh-my-bug/runtime test -- test/acceptance/restart-flow.test.ts test/assessment-worker.test.ts test/repair-worker.test.ts test/evidence-worker.test.ts test/finalization-recovery-worker.test.ts`

Expected: PASS.

Run: `pnpm test:e2e:electron -- apps/desktop/test/electron/e2e/recovery-and-cancel.spec.ts`

Expected: packaged Electron pause/resume and terminal cancellation tests PASS.

- [ ] **Step 8: Commit acceptance coverage and docs**

```bash
git add apps/runtime/test/acceptance/restart-flow.test.ts apps/runtime/test/assessment-worker.test.ts apps/runtime/test/repair-worker.test.ts apps/runtime/test/evidence-worker.test.ts apps/runtime/test/finalization-recovery-worker.test.ts apps/desktop/test/electron/e2e/recovery-and-cancel.spec.ts docs/agent-core.md
git commit -m "test: verify paused issues resume safely"
```

## Task 8: Full verification and review

**Files:**
- Review all files changed by Tasks 1–7.

- [ ] **Step 1: Verify the design requirements against the diff**

Run: `git diff 66c3c626 --stat`

Expected: changes cover Core, Agent, Runtime, protocol, Desktop, tests, and `docs/agent-core.md`; no unrelated project settings or integration code appears.

Run: `git diff 66c3c626 --check`

Expected: no whitespace errors.

- [ ] **Step 2: Run full type checking**

Run: `pnpm typecheck`

Expected: exit 0 with all workspace and repository TypeScript checks passing.

- [ ] **Step 3: Run lint**

Run: `pnpm lint`

Expected: exit 0 with no Oxlint errors.

- [ ] **Step 4: Run the full automated test suite**

Run: `pnpm test`

Expected: all workspace and repository Vitest suites PASS with zero failures.

- [ ] **Step 5: Run the packaged Electron regression**

Run: `pnpm test:e2e:electron -- apps/desktop/test/electron/e2e/recovery-and-cancel.spec.ts`

Expected: exit 0 with pause, resume, and terminal cancellation scenarios passing.

- [ ] **Step 6: Inspect final history and status**

Run: `git status --short`

Expected: no uncommitted files.

Run: `git log --oneline --decorate -8`

Expected: the design commit plus focused Core, Agent, Runtime, protocol, duplicate-review, Desktop, and acceptance commits are present.

- [ ] **Step 7: Request code review**

Invoke `superpowers:requesting-code-review` against the range `66c3c626..HEAD`. Resolve every correctness issue, rerun the narrow affected test, then rerun Steps 2–5 before reporting completion.
