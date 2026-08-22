# Parallel Issue Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run up to three independent Oh My Bug Issues concurrently while keeping every operation for one Issue strictly serialized.

**Architecture:** Keep one in-process `RuntimeWorker` pump, but let it own a bounded map of active Issue operations. A scheduler wake signal lets newly queued Issues fill free slots immediately; active and failed Issue ID sets prevent duplicate selection and tight retry loops without adding SQLite leases.

**Tech Stack:** TypeScript 6, Node.js promises, Vitest 4, SQLite-backed `RuntimeStore`, pnpm workspace scripts

---

## File map

- Create `apps/runtime/test/parallel-worker.test.ts`: deterministic barrier-based coverage for prompt wake-up, the default three-Issue limit, per-Issue serialization, failure isolation, and shutdown.
- Modify `apps/runtime/src/orchestration/worker.ts`: extract pending-operation dispatch and replace the serial pump with the bounded scheduler.
- Modify `docs/architecture.md`: document the concurrency and isolation guarantees exposed by Runtime orchestration.

### Task 1: Capture the scheduling regression and safety requirements

**Files:**
- Create: `apps/runtime/test/parallel-worker.test.ts`

- [ ] **Step 1: Write the failing scheduler tests**

Create `apps/runtime/test/parallel-worker.test.ts` with the complete test harness below:

```ts
import type { AgentSessionRef } from "@oh-my-bug/core";
import { describe, expect, it, vi } from "vitest";

import { RuntimeWorker } from "../src/orchestration/worker.js";
import { FakeAgent } from "./helpers/fakes.js";
import { createHarness, eventIds, now, project } from "./helpers/runtime.js";

type Harness = ReturnType<typeof createHarness>;

class BlockingAssessmentAgent extends FakeAgent {
  readonly startedIssueIds: string[] = [];
  private readonly releases = new Map<string, () => void>();
  private releaseFutureAssessments = false;

  override async assess(
    session: AgentSessionRef,
    input: Parameters<FakeAgent["assess"]>[1],
  ) {
    this.startedIssueIds.push(input.issue.id);
    if (!this.releaseFutureAssessments) {
      await new Promise<void>((resolve) => {
        this.releases.set(input.issue.id, resolve);
      });
    }
    return super.assess(session, input);
  }

  release(issueId: string): void {
    this.releases.get(issueId)?.();
    this.releases.delete(issueId);
  }

  releaseAll(): void {
    this.releaseFutureAssessments = true;
    for (const release of this.releases.values()) release();
    this.releases.clear();
  }
}

function queueAssessment(
  store: Harness["store"],
  id: string,
  identifier: string,
  projectPath: string | null = project.path,
): void {
  store.transaction((transaction) => transaction.insertIssue({
    id,
    projectId: project.id,
    ...(projectPath ? { projectPath } : {}),
    identifier,
    title: identifier,
    titleSource: "user",
    status: "RECEIVED",
    inputs: [],
    revision: 1,
    createdAt: now,
    updatedAt: now,
  }, "ASSESS"));
}

function workerFor(
  harness: Harness,
  options?: { maxConcurrentIssues?: number },
): RuntimeWorker {
  return new RuntimeWorker({
    store: harness.store,
    agents: harness.agents,
    evidence: harness.evidence,
    workspaces: harness.workspaces,
    id: eventIds("parallel-worker"),
    now: () => now,
  }, options);
}

describe("Runtime parallel Issue scheduler", () => {
  it("starts a newly queued Issue while another Issue is active and a slot is free", async () => {
    const agent = new BlockingAssessmentAgent();
    const harness = createHarness(agent);
    const worker = workerFor(harness);
    queueAssessment(harness.store, "issue-1", "OMB-01");
    worker.kick();
    await vi.waitFor(() => expect(agent.startedIssueIds).toEqual(["issue-1"]));

    queueAssessment(harness.store, "issue-2", "OMB-02");
    worker.kick();
    try {
      await vi.waitFor(
        () => expect(agent.startedIssueIds).toContain("issue-2"),
        { timeout: 200 },
      );
    } finally {
      agent.releaseAll();
      await worker.drain();
    }
  });

  it("starts no more than three Issues by default", async () => {
    const agent = new BlockingAssessmentAgent();
    const harness = createHarness(agent);
    const worker = workerFor(harness);
    for (let index = 1; index <= 4; index += 1) {
      queueAssessment(harness.store, `issue-${index}`, `OMB-0${index}`);
    }

    worker.kick();
    await vi.waitFor(() => expect(agent.startedIssueIds).toHaveLength(3));
    expect(agent.startedIssueIds).not.toContain("issue-4");

    agent.release("issue-1");
    await vi.waitFor(() => expect(agent.startedIssueIds).toHaveLength(4));
    expect(agent.startedIssueIds).toContain("issue-4");
    agent.releaseAll();
    await worker.drain();
  });

  it("does not overlap two operations for the same Issue", async () => {
    const agent = new BlockingAssessmentAgent();
    const harness = createHarness(agent);
    const worker = workerFor(harness);
    queueAssessment(harness.store, "issue-1", "OMB-01");
    worker.kick();
    await vi.waitFor(() => expect(agent.startedIssueIds).toEqual(["issue-1"]));

    const active = harness.store.getIssue("issue-1");
    if (!active) throw new Error("ACTIVE_ISSUE_REQUIRED");
    harness.store.transaction((transaction) => {
      transaction.updateIssue(active, active.revision, "ASSESS");
    });
    worker.kick();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(agent.startedIssueIds).toEqual(["issue-1"]);

    agent.releaseAll();
    await worker.drain();
  });

  it("continues unrelated Issues before reporting an unexpected operation error", async () => {
    const agent = new FakeAgent();
    const harness = createHarness(agent);
    const worker = workerFor(harness);
    queueAssessment(harness.store, "bad-issue", "OMB-01", null);
    queueAssessment(harness.store, "good-issue", "OMB-02");

    await expect(worker.drain()).rejects.toThrow("ISSUE_PROJECT_PATH_REQUIRED");
    expect(harness.store.getIssue("good-issue")?.status).toBe("ASSESSMENT_REVIEW");
    expect(harness.store.listPendingOperations().map(({ issue }) => issue.id))
      .toContain("bad-issue");
  });

  it("does not start queued Issues after shutdown begins", async () => {
    const agent = new BlockingAssessmentAgent();
    const harness = createHarness(agent);
    const worker = workerFor(harness);
    for (let index = 1; index <= 4; index += 1) {
      queueAssessment(harness.store, `issue-${index}`, `OMB-0${index}`);
    }

    worker.kick();
    await vi.waitFor(() => expect(agent.startedIssueIds).toHaveLength(3));
    worker.beginShutdown();
    agent.releaseAll();
    await worker.drain();

    expect(agent.startedIssueIds).toHaveLength(3);
    expect(harness.store.listPendingOperations().map(({ issue }) => issue.id))
      .toContain("issue-4");
  });
});
```

- [ ] **Step 2: Run the focused test and verify the serial scheduler fails it**

Run:

```bash
pnpm --filter @oh-my-bug/runtime exec vitest run test/parallel-worker.test.ts
```

Expected: FAIL. The current `RuntimeWorker` constructor does not accept the options argument. Once that missing API is added, the prompt wake-up/default-capacity assertions remain red until the serial pump is replaced.

### Task 2: Implement the bounded scheduler

**Files:**
- Modify: `apps/runtime/src/orchestration/worker.ts:42-92`
- Test: `apps/runtime/test/parallel-worker.test.ts`

- [ ] **Step 1: Add scheduler options and progress result types**

Add these declarations immediately below `RuntimeWorkerDependencies`:

```ts
export interface RuntimeWorkerOptions {
  maxConcurrentIssues?: number;
}

type OperationSettlement =
  | { kind: "settled"; issueId: string; ok: true }
  | { kind: "settled"; issueId: string; ok: false; error: unknown };

type SchedulerProgress = OperationSettlement | { kind: "wake" };

const DEFAULT_MAX_CONCURRENT_ISSUES = 3;
```

Replace the `RuntimeWorker` fields and constructor with:

```ts
export class RuntimeWorker {
  private running?: Promise<void>;
  private accepting = true;
  private wakeScheduler?: () => void;
  private readonly maxConcurrentIssues: number;

  constructor(
    private readonly dependencies: RuntimeWorkerDependencies,
    options: RuntimeWorkerOptions = {},
  ) {
    const maxConcurrentIssues = options.maxConcurrentIssues
      ?? DEFAULT_MAX_CONCURRENT_ISSUES;
    if (!Number.isInteger(maxConcurrentIssues) || maxConcurrentIssues < 1) {
      throw new Error("INVALID_MAX_CONCURRENT_ISSUES");
    }
    this.maxConcurrentIssues = maxConcurrentIssues;
  }
```

- [ ] **Step 2: Wake an existing scheduler instead of starting a second pump**

Replace `kick()` with:

```ts
  kick(): void {
    if (!this.accepting) return;
    if (this.running) {
      this.wakeScheduler?.();
      return;
    }
    this.running = this.runUntilIdle().finally(() => {
      this.running = undefined;
    });
  }
```

Keep `beginShutdown()` and `drain()` unchanged. `beginShutdown()` prevents new slot filling, while `drain()` continues awaiting the pump that owns all active operations.

- [ ] **Step 3: Extract dispatch so the scheduler can start a selected operation**

Replace `drainOne()` with the following two methods:

```ts
  async drainOne(): Promise<void> {
    const pending = this.dependencies.store.listPendingOperations()[0];
    if (!pending) return;
    await this.runPendingOperation(pending);
  }

  private async runPendingOperation(
    pending: ReturnType<RuntimeStore["listPendingOperations"]>[number],
  ): Promise<void> {
    if (pending.operation === "PREPARE") {
      return this.dependencies.workspaces.prepare(pending.issue);
    }
    if (pending.operation === "ASSESS") return this.assess(pending.issue);
    if (pending.operation === "REPAIR") return this.repair(pending.issue);
    if (pending.operation === "CAPTURE_EVIDENCE") {
      return this.captureEvidence(pending.issue);
    }
    if (pending.operation === "EVIDENCE") return this.inspectEvidence(pending.issue);
    if (pending.operation === "FINALIZE") {
      return this.dependencies.workspaces.finalize(pending.issue);
    }
    throw new Error("UNSUPPORTED_PENDING_OPERATION");
  }
```

- [ ] **Step 4: Replace the serial loop with bounded per-Issue scheduling**

Replace `runUntilIdle()` and add `waitForProgress()` with:

```ts
  private async runUntilIdle(): Promise<void> {
    const active = new Map<string, Promise<OperationSettlement>>();
    const failedInPump = new Set<string>();
    let firstFailure: { error: unknown } | undefined;

    while (true) {
      if (this.accepting) {
        for (const pending of this.dependencies.store.listPendingOperations()) {
          if (active.size >= this.maxConcurrentIssues) break;
          const issueId = pending.issue.id;
          if (active.has(issueId) || failedInPump.has(issueId)) continue;

          const operation = this.runPendingOperation(pending).then<OperationSettlement>(
            () => ({ kind: "settled", issueId, ok: true }),
            (error: unknown) => ({ kind: "settled", issueId, ok: false, error }),
          );
          active.set(issueId, operation);
        }
      }

      if (active.size === 0) break;
      const progress = await this.waitForProgress(active);
      if (progress.kind === "wake") continue;

      active.delete(progress.issueId);
      if (!progress.ok) {
        failedInPump.add(progress.issueId);
        firstFailure ??= { error: progress.error };
      }
    }

    if (firstFailure) throw firstFailure.error;
  }

  private async waitForProgress(
    active: Map<string, Promise<OperationSettlement>>,
  ): Promise<SchedulerProgress> {
    let wake!: () => void;
    const woken = new Promise<SchedulerProgress>((resolve) => {
      wake = () => resolve({ kind: "wake" });
    });
    this.wakeScheduler = wake;
    try {
      return await Promise.race([...active.values(), woken]);
    } finally {
      if (this.wakeScheduler === wake) this.wakeScheduler = undefined;
    }
  }
```

- [ ] **Step 5: Run the focused tests and verify all scheduler requirements pass**

Run:

```bash
pnpm --filter @oh-my-bug/runtime exec vitest run test/parallel-worker.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Run the existing RuntimeWorker-adjacent tests**

Run:

```bash
pnpm --filter @oh-my-bug/runtime exec vitest run \
  test/assessment-worker.test.ts \
  test/repair-worker.test.ts \
  test/evidence-worker.test.ts \
  test/recovery.test.ts \
  test/shutdown.test.ts \
  test/workspace-finalization.test.ts
```

Expected: PASS with no changed assertions in the existing suites.

- [ ] **Step 7: Commit the scheduler and regression tests**

```bash
git add apps/runtime/src/orchestration/worker.ts \
  apps/runtime/test/parallel-worker.test.ts
git commit -m "fix(runtime): run independent issues concurrently"
```

### Task 3: Document and verify the runtime contract

**Files:**
- Modify: `docs/architecture.md:38-40`
- Test: `apps/runtime/test/parallel-worker.test.ts`

- [ ] **Step 1: Document bounded concurrency next to the Runtime architecture**

After the paragraph describing package boundaries, add:

```md
Runtime Worker 使用单进程有界调度器，同时推进最多 3 个不同 Issue。新进入队列的 Issue 会在存在空闲槽位时立即启动；同一 Issue 的 Workspace、Assessment、Repair、Evidence 与 Finalize 操作始终串行。每个 Issue 的独立 worktree 继续作为文件系统隔离边界，SQLite compare-and-swap 更新继续作为持久状态保护。
```

- [ ] **Step 2: Run Runtime type checking**

Run:

```bash
pnpm --filter @oh-my-bug/runtime typecheck
```

Expected: PASS with no TypeScript diagnostics.

- [ ] **Step 3: Run the complete Runtime test suite**

Run:

```bash
pnpm --filter @oh-my-bug/runtime test
```

Expected: PASS, including `parallel-worker.test.ts` and all acceptance tests.

- [ ] **Step 4: Run repository-wide static and regression verification**

Run:

```bash
pnpm typecheck
pnpm lint
pnpm test
```

Expected: all three commands exit 0; no workspace or repository regression is reported.

- [ ] **Step 5: Check the final diff for accidental changes**

Run:

```bash
git status --short
git diff --check HEAD~1
git diff --stat HEAD~1
```

Expected: only `worker.ts`, `parallel-worker.test.ts`, and `architecture.md` are changed after the scheduler commit; `git diff --check` prints no errors.

- [ ] **Step 6: Commit the architecture documentation**

```bash
git add docs/architecture.md
git commit -m "docs: describe parallel issue scheduling"
```
