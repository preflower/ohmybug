# Async Delivery Finalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept delivery approval immediately, run Git finalization in the existing background Worker, and restore completed branch details from durable Issue events.

**Architecture:** `RuntimeCommands.approveDelivery()` already persists `FINALIZE` and wakes the Worker, so `OhMyBugRuntime.approveDelivery()` will stop draining the Worker inside the request. The Desktop will keep refreshing Issue snapshots through subscriptions and derive `BranchInfo` from the durable `ISSUE_COMPLETED` event instead of relying on a long-lived approval response.

**Tech Stack:** TypeScript 6, Zod 4, Vitest 4, React 19, Testing Library, Electron IPC

---

## File structure

- Modify `apps/runtime/src/runtime.ts`: return accepted `FINALIZING` state without awaiting Worker completion.
- Modify `apps/runtime/test/workspace-finalization.test.ts`: prove approval resolves while publication is still blocked and update synchronous-result assumptions.
- Modify `apps/runtime/test/acceptance/git-workspace-restart.test.ts`: explicitly drain background work before asserting final state.
- Create `apps/desktop/src/web/issues/completed-branch.ts`: parse the latest valid completed branch from durable events.
- Create `apps/desktop/test/web/completed-branch.test.ts`: unit-test safe event parsing.
- Modify `apps/desktop/src/web/app.tsx`: use durable event branch information after background completion or refresh.
- Modify `apps/desktop/test/web/app-workbench.test.tsx`: cover an immediate `FINALIZING` response followed by an `ISSUE_COMPLETED` event.

### Task 1: Make delivery approval non-blocking

**Files:**
- Modify: `apps/runtime/test/workspace-finalization.test.ts`
- Modify: `apps/runtime/src/runtime.ts`
- Modify: `apps/runtime/test/acceptance/git-workspace-restart.test.ts`

- [ ] **Step 1: Write the failing deferred-publication test**

Add a Workspace finalization test whose provider does not resolve `publish()` until the test releases it:

```ts
it("returns FINALIZING before background publication settles", async () => {
  const fixture = createHarness();
  let releasePublish!: () => void;
  const publishing = new Promise<void>((resolve) => { releasePublish = resolve; });
  fixture.workspaceRegistry.register({
    id: "deferred",
    manifest: { id: "deferred", name: "Deferred", configFields: [] },
    validate() {},
    create() {
      return {
        id: "deferred",
        async acquire({ issue, project }) {
          return { projectPath: project.path, resourceId: `deferred:${issue.id}` };
        },
        async publish() {
          await publishing;
          return { name: "ohmybug/omb-1", commit: "abc123" };
        },
        async release() {},
      };
    },
  });
  fixture.workspacePersistence.setProjectConfiguration(project.id, {
    provider: "deferred",
    config: {},
  });
  const runtime = new OhMyBugRuntime({
    commands: fixture.commands,
    store: fixture.store,
    agents: fixture.agents,
    evidence: fixture.evidence,
    workspaces: fixture.workspaces,
    hooks: fixture.hooks,
    id: eventIds("async-finalize"),
    now: () => "2026-08-24T10:00:00.000Z",
  });
  await runtime.start();
  const created = await fixture.commands.submitManual(project.id, {
    commandId: "async-finalize",
    content: "Checkout fails",
  });
  if (created.kind !== "CREATED") throw new Error("CREATED_REQUIRED");
  await runtime.drain();
  fixture.commands.approveAssessment(created.issue.id, {
    assessmentRevision: assessment.revision,
    assessmentContentHash: assessment.contentHash,
    title: assessment.suggestedTitle,
  });
  await runtime.drain();
  const ready = fixture.store.getIssue(created.issue.id)!;
  expect(ready.status).toBe("ACCEPTANCE_REVIEW");

  const approval = runtime.approveDelivery(ready.id);
  let accepted: Awaited<typeof approval> | undefined;
  void approval.then((value) => { accepted = value; });
  await Promise.resolve();
  try {
    expect(accepted).toEqual({
      issue: expect.objectContaining({ status: "FINALIZING" }),
    });
    expect(fixture.store.getIssue(ready.id)?.status).toBe("FINALIZING");
  } finally {
    releasePublish();
  }
  await approval;
  await runtime.drain();
  expect(fixture.store.getIssue(ready.id)?.status).toBe("COMPLETED");
});
```

Import the existing `assessment` and `project` fixtures used elsewhere in the file. Do not use timers to prove non-blocking behavior.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/runtime exec vitest run test/workspace-finalization.test.ts -t "returns FINALIZING before background publication settles"
```

Expected: FAIL because `accepted` is still `undefined` after the microtask checkpoint while `OhMyBugRuntime.approveDelivery()` awaits `worker.drain()`; the `finally` block releases publication so the test exits cleanly.

- [ ] **Step 3: Remove Worker draining from the approval request**

Replace the current asynchronous implementation in `apps/runtime/src/runtime.ts` with:

```ts
async approveDelivery(
  ...args: Parameters<RuntimeCommands["approveDelivery"]>
): Promise<{ issue: ReturnType<RuntimeCommands["getIssue"]> }> {
  return { issue: this.dependencies.commands.approveDelivery(...args) };
}
```

Remove `completedBranch()` and its now-unused store event lookup. Remove the `BranchInfo` import only if TypeScript no longer needs it for the explicit return type; otherwise retain it. Do not add a longer Utility timeout.

- [ ] **Step 4: Update existing finalization tests for background settlement**

In the flaky finalization test, assert the immediate response is `FINALIZING`, then call `await runtime.drain()` before reading the failed Issue. Retry the failed Issue in the same way:

```ts
const accepted = await runtime.approveDelivery(created.issue.id);
expect(accepted.issue.status).toBe("FINALIZING");
await runtime.drain();
expect(store.getIssue(created.issue.id)?.status).toBe("FINALIZATION_FAILED");

const retried = await runtime.approveDelivery(created.issue.id);
expect(retried.issue.status).toBe("FINALIZING");
await runtime.drain();
expect(store.getIssue(created.issue.id)?.status).toBe("COMPLETED");
```

Update `apps/runtime/test/acceptance/git-workspace-restart.test.ts` and `apps/runtime/test/acceptance/manual-full-flow.test.ts` so every final-state assertion explicitly follows `await runtime.drain()`.

- [ ] **Step 5: Run Runtime finalization coverage and verify GREEN**

Run:

```bash
pnpm --filter @oh-my-bug/runtime exec vitest run test/workspace-finalization.test.ts test/acceptance/git-workspace-restart.test.ts test/acceptance/manual-full-flow.test.ts
```

Expected: PASS. The deferred test resolves before publication and all final-state assertions pass after `runtime.drain()`.

- [ ] **Step 6: Commit the asynchronous Runtime boundary**

```bash
git add apps/runtime/src/runtime.ts apps/runtime/test/workspace-finalization.test.ts apps/runtime/test/acceptance/git-workspace-restart.test.ts apps/runtime/test/acceptance/manual-full-flow.test.ts
git commit -m "fix(runtime): finalize deliveries asynchronously"
```

### Task 2: Recover completed branch information from durable events

**Files:**
- Create: `apps/desktop/src/web/issues/completed-branch.ts`
- Create: `apps/desktop/test/web/completed-branch.test.ts`
- Modify: `apps/desktop/src/web/app.tsx`
- Modify: `apps/desktop/test/web/app-workbench.test.tsx`

- [ ] **Step 1: Write the failing branch parser tests**

Create `apps/desktop/test/web/completed-branch.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { AgentEventDto } from "../../src/web/api/types.js";
import { completedBranchFromEvents } from "../../src/web/issues/completed-branch.js";

const event = (sequence: number, data: Record<string, unknown>): AgentEventDto => ({
  id: `event-${sequence}`,
  issueId: "issue-1",
  sequence,
  type: "ISSUE_COMPLETED",
  actor: "SYSTEM",
  data,
  occurredAt: "2026-08-24T10:00:00.000Z",
});

describe("completedBranchFromEvents", () => {
  it("returns the latest valid completed branch", () => {
    expect(completedBranchFromEvents([
      event(1, { branch: { name: "old", commit: "111" } }),
      event(2, { branch: { name: "ohmybug/omb-1", commit: "abc123", remote: "origin" } }),
    ])).toEqual({ name: "ohmybug/omb-1", commit: "abc123", remote: "origin" });
  });

  it("ignores malformed and unrelated events", () => {
    expect(completedBranchFromEvents([
      { ...event(1, {}), type: "WORKSPACE_PUBLISH_FAILED" },
      event(2, { branch: { name: "", commit: "abc123" } }),
      event(3, { branch: "not-an-object" }),
    ])).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the parser test and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run test/web/completed-branch.test.ts
```

Expected: FAIL because `completed-branch.ts` does not exist.

- [ ] **Step 3: Implement bounded event parsing**

Create `apps/desktop/src/web/issues/completed-branch.ts`:

```ts
import type { AgentEventDto, BranchInfoDto } from "../api/types.js";

export function completedBranchFromEvents(
  events: AgentEventDto[],
): BranchInfoDto | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== "ISSUE_COMPLETED") continue;
    const value = event.data.branch;
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const candidate = value as Record<string, unknown>;
    if (!nonEmpty(candidate.name) || !nonEmpty(candidate.commit)) continue;
    return {
      name: candidate.name,
      commit: candidate.commit,
      ...(nonEmpty(candidate.remote) ? { remote: candidate.remote } : {}),
    };
  }
  return undefined;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
```

- [ ] **Step 4: Run the parser tests and verify GREEN**

Run the Step 2 command again.

Expected: PASS.

- [ ] **Step 5: Use the durable branch in the Workbench**

Import the helper in `apps/desktop/src/web/app.tsx`. After `useIssueEvents`, derive the selected branch:

```ts
const events = useIssueEvents(selectedId, onRefresh);
const durableBranch = completedBranchFromEvents(events);
const selectedBranch = selected
  ? branches[selected.id] ?? durableBranch
  : undefined;
```

Pass `selectedBranch` to `IssueDetail`. Keep the existing immediate-response branch cache for protocol compatibility, but do not require `approveDelivery()` to return a branch.

- [ ] **Step 6: Add a Workbench event-flow test**

In `apps/desktop/test/web/app-workbench.test.tsx`, configure a selected `ACCEPTANCE_REVIEW` Issue, make `api.approveDelivery()` resolve with `{ issue: finalizing }`, capture the subscription listener, and emit:

```ts
{
  id: "event-completed",
  issueId: issue.id,
  sequence: 20,
  type: "ISSUE_COMPLETED",
  actor: "SYSTEM",
  data: {
    branch: { name: "ohmybug/chk-1", commit: "abcdef123456", remote: "origin" },
  },
  occurredAt: "2026-08-24T10:01:00.000Z",
}
```

Assert the approval promise updates the UI to `交付处理中` without a branch, then the event renders `ohmybug/chk-1`, `abcdef1`, and `origin` in the `交付分支` region.

- [ ] **Step 7: Run Desktop branch-flow tests**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run test/web/completed-branch.test.ts test/web/app-workbench.test.tsx test/web/issues.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit durable branch recovery**

```bash
git add apps/desktop/src/web/app.tsx apps/desktop/src/web/issues/completed-branch.ts apps/desktop/test/web/completed-branch.test.ts apps/desktop/test/web/app-workbench.test.tsx
git commit -m "fix(desktop): restore finalized branches from events"
```

### Task 3: Verify the asynchronous request boundary

**Files:**
- Modify: `apps/runtime/test/protocol/service.test.ts`
- Modify: `apps/desktop/test/electron/desktop-api.test.ts`

- [ ] **Step 1: Add protocol assertions for the accepted state**

Update the service fixture so its `approveDelivery` implementation returns:

```ts
async (id: string) => ({
  issue: commands.approveDelivery(id),
})
```

Assert the service response contains a `FINALIZING` Issue and no `branch`. Retain the schema test proving an optional branch remains valid for backward compatibility.

- [ ] **Step 2: Run the focused protocol tests**

Run:

```bash
pnpm --filter @oh-my-bug/runtime exec vitest run test/protocol/service.test.ts test/protocol/operations.test.ts
pnpm --filter @oh-my-bug/desktop exec vitest run test/electron/desktop-api.test.ts test/web/transport.test.ts
```

Expected: PASS with no timer advancement and no `UTILITY_REQUEST_TIMEOUT` expectation for approval.

- [ ] **Step 3: Run package verification**

Run:

```bash
pnpm --filter @oh-my-bug/runtime test
pnpm --filter @oh-my-bug/desktop test
pnpm --filter @oh-my-bug/runtime typecheck
pnpm --filter @oh-my-bug/desktop typecheck
```

Expected: all commands PASS with no unhandled rejections or React act warnings.

- [ ] **Step 4: Commit protocol fixture alignment**

```bash
git add apps/runtime/test/protocol/service.test.ts apps/desktop/test/electron/desktop-api.test.ts
git commit -m "test: cover async delivery acceptance"
```
