# Delivery Finalization Statuses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ambiguous `APPROVED` Issue state with durable `FINALIZING` and `FINALIZATION_FAILED` states and use accurate delivery-finalization copy in the desktop UI.

**Architecture:** The Core workflow owns the two new lifecycle states and their transitions. SQLite normalizes legacy `APPROVED` rows before Core parsing, Runtime persists failure and retry transitions, and Workspace providers accept only the active state. The desktop renders status and recovery controls directly from the durable state without inferring from events.

**Tech Stack:** TypeScript 6, Zod 4, React 19, Vitest 4, Testing Library, SQLite/better-sqlite3, pnpm workspaces

---

## File Map

- `packages/core/src/issue/types.ts`: durable Issue status union.
- `packages/core/src/issue/schema.ts`: persisted status validation.
- `packages/core/src/issue/workflow.ts`: approval, finalization failure, retry, and completion transitions.
- `packages/core/test/issue/workflow.test.ts`: Core lifecycle behavior.
- `packages/core/test/issue/schema.test.ts`: persistence contract for the new statuses.
- `packages/storage/src/sqlite/database.ts`: one-time normalization of legacy `APPROVED` rows.
- `packages/storage/test/sqlite/database.test.ts`: migration coverage for active and failed legacy rows.
- `apps/runtime/src/orchestration/commands.ts`: initial approval and explicit finalization retry command behavior.
- `apps/runtime/src/orchestration/workspace-coordinator.ts`: active-state guard, durable failure transition, and restart recovery selection.
- `apps/runtime/test/commands.test.ts`: command-level approval and retry behavior.
- `apps/runtime/test/workspace-finalization.test.ts`: successful, failed, and retried finalization behavior.
- `apps/runtime/test/recovery.test.ts`: recovery queues only active finalization.
- `apps/runtime/test/acceptance/git-workspace-restart.test.ts`: failed finalization stays idle across restart until explicit retry.
- `apps/runtime/test/lifecycle-hooks.test.ts`: approved-delivery hook expectation.
- `packages/workspace-git/src/provider.ts`: Git finalization state guard.
- `packages/workspace-git/test/publish.test.ts`: Git provider fixtures use the active state.
- `packages/storage/test/sqlite/workspace-store.test.ts`: atomic completion fixture uses the active state.
- `apps/desktop/src/web/issues/issue-status.tsx`: badge labels and variants.
- `apps/desktop/src/web/issues/issue-detail.tsx`: failed-only retry section and delivery copy.
- `apps/desktop/test/web/issues.test.tsx`: finalizing versus failed rendering and retry behavior.
- `apps/desktop/test/web/app-workbench.test.tsx`: live-list fixture uses the active status.

Internal events `DELIVERY_APPROVED`, `DELIVERY_FINALIZATION_RETRIED`, and `WORKSPACE_PUBLISH_FAILED` remain unchanged for compatibility. Files containing only those event names are not renamed.

### Task 1: Model the two Core lifecycle states

**Files:**
- Modify: `packages/core/test/issue/workflow.test.ts`
- Modify: `packages/core/test/issue/schema.test.ts`
- Modify: `packages/core/src/issue/types.ts`
- Modify: `packages/core/src/issue/schema.ts`
- Modify: `packages/core/src/issue/workflow.ts`

- [ ] **Step 1: Write the failing workflow tests**

Replace the approval test with a complete status sequence and update the grant-revocation fixture:

```ts
it("separates active and failed Delivery finalization", () => {
  const finalizing = transitionIssue(
    { ...issueAt("ACCEPTANCE_REVIEW"), assessment },
    "APPROVE_DELIVERY",
    "2026-08-20T07:09:00.000Z",
  );

  expect(finalizing).toMatchObject({ status: "FINALIZING", resolution: "FIXED" });
  const failed = transitionIssue(
    finalizing,
    "FINALIZATION_ERRORED",
    "2026-08-20T07:09:30.000Z",
  );
  expect(failed.status).toBe("FINALIZATION_FAILED");
  expect(transitionIssue(
    failed,
    "RETRY_FINALIZATION",
    "2026-08-20T07:09:45.000Z",
  ).status).toBe("FINALIZING");
  expect(transitionIssue(
    finalizing,
    "COMPLETE_DELIVERY",
    "2026-08-20T07:10:00.000Z",
  )).toMatchObject({ status: "COMPLETED", resolution: "FIXED" });
});
```

Change the terminal grant test fixture from `issueAt("APPROVED")` to `issueAt("FINALIZING")`. Update all workflow expectations that currently name `APPROVED` to expect `FINALIZING`.

- [ ] **Step 2: Write the failing persistence-schema test**

Import `issueStatusSchema` and add:

```ts
it.each(["FINALIZING", "FINALIZATION_FAILED"] as const)(
  "round-trips the %s status",
  (status) => {
    expect(issueSchema.parse({ ...issue, status }).status).toBe(status);
  },
);

it("rejects the legacy APPROVED status", () => {
  expect(issueStatusSchema.safeParse("APPROVED").success).toBe(false);
});
```

- [ ] **Step 3: Run the focused Core tests and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/core exec vitest run test/issue/workflow.test.ts test/issue/schema.test.ts
```

Expected: FAIL because `FINALIZING`, `FINALIZATION_FAILED`, `FINALIZATION_ERRORED`, and `RETRY_FINALIZATION` do not exist.

- [ ] **Step 4: Implement the minimal Core model**

In `types.ts`, replace `"APPROVED"` with:

```ts
  | "FINALIZING"
  | "FINALIZATION_FAILED"
```

In `schema.ts`, replace the `APPROVED` enum member with:

```ts
  "FINALIZING",
  "FINALIZATION_FAILED",
```

In `workflow.ts`, extend `IssueAction` with:

```ts
  | "FINALIZATION_ERRORED"
  | "RETRY_FINALIZATION"
```

Replace the delivery-finalization transitions with:

```ts
  ACCEPTANCE_REVIEW: {
    REJECT_DELIVERY: "REPAIRING",
    APPROVE_DELIVERY: "FINALIZING",
    CANCEL: "CANCELED",
  },
  FINALIZING: {
    FINALIZATION_ERRORED: "FINALIZATION_FAILED",
    COMPLETE_DELIVERY: "COMPLETED",
  },
  FINALIZATION_FAILED: { RETRY_FINALIZATION: "FINALIZING" },
```

Do not alter resolution assignment: `APPROVE_DELIVERY` still assigns `FIXED` or `IMPLEMENTED`.

- [ ] **Step 5: Run the focused Core tests and verify GREEN**

Run:

```bash
pnpm --filter @oh-my-bug/core exec vitest run test/issue/workflow.test.ts test/issue/schema.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the Core state model**

```bash
git add packages/core/src/issue packages/core/test/issue
git commit -m "feat(core): split delivery finalization states"
```

### Task 2: Migrate legacy `APPROVED` rows before parsing

**Files:**
- Modify: `packages/storage/test/sqlite/database.test.ts`
- Modify: `packages/storage/src/sqlite/database.ts`

- [ ] **Step 1: Write the failing migration test**

Import `openRuntimeDatabase` and add a raw legacy-row test that bypasses the new Core schema:

```ts
it("migrates active and failed legacy APPROVED rows", () => {
  const path = databasePath();
  const legacy = new BetterSqlite3(path);
  legacy.exec(runtimeSchema);
  legacy.prepare(
    `INSERT INTO projects (id, project_key, revision, next_issue_sequence, data_json)
     VALUES (?, ?, 1, 3, ?)`,
  ).run(project.id, project.key, JSON.stringify(project));
  const insert = legacy.prepare(
    `INSERT INTO issues
      (id, project_id, identifier, status, revision, pending_operation, data_json)
     VALUES (?, ?, ?, 'APPROVED', 7, ?, ?)`,
  );
  insert.run(
    "legacy-active",
    project.id,
    "OMB-1",
    "FINALIZE",
    JSON.stringify({ ...issue, id: "legacy-active", status: "APPROVED" }),
  );
  insert.run(
    "legacy-failed",
    project.id,
    "OMB-2",
    null,
    JSON.stringify({
      ...issue,
      id: "legacy-failed",
      identifier: "OMB-2",
      status: "APPROVED",
    }),
  );
  legacy.close();

  const database = openRuntimeDatabase(path);
  const store = new SqliteRuntimeStore(database);
  expect(store.getIssue("legacy-active")?.status).toBe("FINALIZING");
  expect(store.getIssue("legacy-failed")?.status).toBe("FINALIZATION_FAILED");
  expect(store.listPendingOperations()).toEqual([{
    issue: expect.objectContaining({ id: "legacy-active", revision: 7 }),
    operation: "FINALIZE",
  }]);
  store.close();
});
```

- [ ] **Step 2: Run the migration test and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/storage exec vitest run test/sqlite/database.test.ts
```

Expected: FAIL because reopening attempts to parse legacy `APPROVED` JSON.

- [ ] **Step 3: Implement migration before any Issue read**

Add to `database.ts`:

```ts
function migrateDeliveryFinalizationStatuses(database: RuntimeDatabase): void {
  database.prepare(
    `UPDATE issues
     SET status = CASE
           WHEN pending_operation = 'FINALIZE' THEN 'FINALIZING'
           ELSE 'FINALIZATION_FAILED'
         END,
         data_json = json_set(
           data_json,
           '$.status',
           CASE
             WHEN pending_operation = 'FINALIZE' THEN 'FINALIZING'
             ELSE 'FINALIZATION_FAILED'
           END
         )
     WHERE status = 'APPROVED'
        OR json_extract(data_json, '$.status') = 'APPROVED'`,
  ).run();
}
```

Call `migrateDeliveryFinalizationStatuses(database)` immediately after `database.exec(runtimeSchema)` and before other code can construct `SqliteRuntimeStore` or parse an Issue. Do not change revisions, timestamps, pending operations, events, bindings, or module resources.

- [ ] **Step 4: Run Storage tests and verify GREEN**

Run:

```bash
pnpm --filter @oh-my-bug/storage exec vitest run test/sqlite/database.test.ts
```

Expected: PASS, including both legacy status mappings.

- [ ] **Step 5: Commit the migration**

```bash
git add packages/storage/src/sqlite/database.ts packages/storage/test/sqlite/database.test.ts
git commit -m "feat(storage): migrate finalization statuses"
```

### Task 3: Persist Runtime failure, retry, and recovery states

**Files:**
- Modify: `apps/runtime/test/commands.test.ts`
- Modify: `apps/runtime/test/workspace-finalization.test.ts`
- Modify: `apps/runtime/test/recovery.test.ts`
- Modify: `apps/runtime/test/acceptance/git-workspace-restart.test.ts`
- Modify: `apps/runtime/test/lifecycle-hooks.test.ts`
- Modify: `apps/runtime/src/orchestration/commands.ts`
- Modify: `apps/runtime/src/orchestration/workspace-coordinator.ts`

- [ ] **Step 1: Write the failing command tests**

Update approval expectations from `APPROVED` to `FINALIZING`. Add:

```ts
it("retries only a failed Delivery finalization", () => {
  const { commands, store } = createHarness();
  const failed = reviewedIssue({
    id: "issue-finalization-failed",
    status: "FINALIZATION_FAILED",
    resolution: "FIXED",
    repair: { iteration: 1, delivery },
    revision: 8,
  });
  store.transaction((transaction) => transaction.insertIssue(failed, null));

  const retrying = commands.approveDelivery(failed.id);

  expect(retrying).toMatchObject({
    status: "FINALIZING",
    resolution: "FIXED",
    revision: 9,
  });
  expect(store.listPendingOperations()).toEqual([{
    issue: retrying,
    operation: "FINALIZE",
  }]);
  expect(store.readEvents(failed.id).map((event) => event.type))
    .toEqual(["DELIVERY_FINALIZATION_RETRIED"]);
});
```

- [ ] **Step 2: Update finalization and recovery tests to describe the new behavior**

In `workspace-finalization.test.ts`:

- expect initial command state `FINALIZING`;
- replace the failed/retry assertions with:

```ts
expect(failed).toEqual({
  issue: expect.objectContaining({ status: "FINALIZATION_FAILED" }),
});
expect(store.listPendingOperations()).toEqual([]);
expect(workspacePersistence.getBinding(created.issue.id)?.status).toBe("READY");
expect(store.readEvents(created.issue.id).map((event) => event.type))
  .toContain("WORKSPACE_PUBLISH_FAILED");

const completed = await runtime.approveDelivery(created.issue.id);

expect(completed).toEqual({
  issue: expect.objectContaining({ status: "COMPLETED" }),
  branch: { name: "ohmybug/omb-1", commit: "abc123" },
});
expect(workspacePersistence.getBinding(created.issue.id)?.status).toBe("RELEASED");
expect(publishAttempts).toBe(2);
expect(releases).toBe(1);
```

In `recovery.test.ts`, replace the old approved-recovery case with:

```ts
it("queues finalization for a FINALIZING Issue recovered after restart", async () => {
  const { store, workspaces, workspacePersistence } = createHarness();
  const finalizing = {
    id: "finalizing-restart",
    projectId: project.id,
    projectPath: project.path,
    identifier: "OMB-FINALIZING",
    title: "Finalizing",
    titleSource: "user" as const,
    status: "FINALIZING" as const,
    resolution: "FIXED" as const,
    inputs: [],
    assessment,
    repair: { iteration: 1 },
    revision: 7,
    createdAt: now,
    updatedAt: now,
  };
  store.transaction((transaction) => transaction.insertIssue(finalizing, "FINALIZE"));
  store.transaction((transaction) => transaction.updateIssue(
    finalizing,
    finalizing.revision,
    null,
  ));

  await workspaces.recover();

  expect(store.listPendingOperations()).toEqual([{
    issue: expect.objectContaining({ id: finalizing.id }),
    operation: "FINALIZE",
  }]);
  expect(workspacePersistence.getBinding(finalizing.id)?.providerId).toBe("local");
});

it("leaves FINALIZATION_FAILED idle after restart", async () => {
  const { store, workspaces, workspacePersistence } = createHarness();
  const failed = {
    id: "finalization-failed-restart",
    projectId: project.id,
    projectPath: project.path,
    identifier: "OMB-FINALIZATION-FAILED",
    title: "Finalization failed",
    titleSource: "user" as const,
    status: "FINALIZATION_FAILED" as const,
    resolution: "FIXED" as const,
    inputs: [],
    assessment,
    repair: { iteration: 1 },
    revision: 8,
    createdAt: now,
    updatedAt: now,
  };
  store.transaction((transaction) => transaction.insertIssue(failed, null));

  await workspaces.recover();

  expect(store.listPendingOperations()).toEqual([]);
  expect(workspacePersistence.getBinding(failed.id)?.providerId).toBe("local");
});
```

In `git-workspace-restart.test.ts`, replace the status and restart portion with:

```ts
const failed = await runtime.approveDelivery(assessed.id);
expect(failed.issue.status).toBe("FINALIZATION_FAILED");
expect(fixture.agent.repairInputs).toHaveLength(1);
await runtime.stop();

const remote = join(fixture.root, "delivery.git");
await mkdir(remote);
await git(remote, "init", "--bare");
await git(fixture.repository, "remote", "add", "delivery", remote);

const reopened = createRuntime(fixture.runtimeOptions);
await reopened.start();
await reopened.drain();
expect(reopened.getIssue(assessed.id).status).toBe("FINALIZATION_FAILED");

const completed = await reopened.approveDelivery(assessed.id);
expect(completed.issue.status).toBe("COMPLETED");
expect(fixture.agent.repairInputs).toHaveLength(1);
expect(reopened.readIssueEvents(assessed.id)).toEqual(expect.arrayContaining([
  expect.objectContaining({
    type: "ISSUE_COMPLETED",
    data: expect.objectContaining({
      branch: expect.objectContaining({ remote: "delivery" }),
    }),
  }),
]));
await reopened.stop();
```

Update `lifecycle-hooks.test.ts` to expect `FINALIZING` after initial delivery approval. Do not rename `DELIVERY_APPROVED` or hook `issue.userApproved`.

- [ ] **Step 3: Run focused Runtime tests and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/runtime exec vitest run test/commands.test.ts test/workspace-finalization.test.ts test/recovery.test.ts test/acceptance/git-workspace-restart.test.ts test/lifecycle-hooks.test.ts
```

Expected: FAIL because commands do not transition failed finalization back to active, Workspace failures are not persisted, and recovery still treats the old state as active.

- [ ] **Step 4: Implement explicit retry in `RuntimeCommands`**

Replace the `current.status === "APPROVED"` branch with:

```ts
if (current.status === "FINALIZATION_FAILED") {
  return this.change(
    issueId,
    "DELIVERY_FINALIZATION_RETRIED",
    "FINALIZE",
    (issue, now) => transitionIssue(issue, "RETRY_FINALIZATION", now),
  );
}
```

Keep initial approval on the existing path; its Core transition now returns `FINALIZING` and still emits `issue.userApproved` exactly once. Calling `approveDelivery` for an already `FINALIZING` Issue remains illegal and does not enqueue a duplicate operation.

- [ ] **Step 5: Implement durable failure and correct recovery in `WorkspaceCoordinator`**

Change finalization guards from `APPROVED` to `FINALIZING`. In the catch block, after the same revision/status guard, create and persist the failed Issue:

```ts
const failed = transitionIssue(
  latest,
  "FINALIZATION_ERRORED",
  this.dependencies.now(),
);
const message = workspaceFailureMessage(error, "WORKSPACE_PUBLISH_FAILED");
this.dependencies.persistence.transaction(() => {
  this.dependencies.store.transaction((transaction) => {
    transaction.updateIssue(failed, latest.revision, null);
    transaction.appendEvent(this.event(issue.id, "WORKSPACE_PUBLISH_FAILED", {
      providerId: binding?.providerId,
      error: message,
    }));
  });
});
```

Change recovery selection to:

```ts
if (issue.status === "FINALIZING") return "FINALIZE";
```

Do not add a recovery case for `FINALIZATION_FAILED`.

- [ ] **Step 6: Run focused Runtime tests and verify GREEN**

Run the command from Step 3 again.

Expected: PASS, including restart remaining idle until explicit retry.

- [ ] **Step 7: Commit Runtime lifecycle behavior**

```bash
git add apps/runtime/src/orchestration apps/runtime/test/commands.test.ts apps/runtime/test/workspace-finalization.test.ts apps/runtime/test/recovery.test.ts apps/runtime/test/acceptance/git-workspace-restart.test.ts apps/runtime/test/lifecycle-hooks.test.ts
git commit -m "feat(runtime): persist finalization failure and retry"
```

### Task 4: Update Git and atomic-release state contracts

**Files:**
- Modify: `packages/workspace-git/test/publish.test.ts`
- Modify: `packages/workspace-git/src/provider.ts`
- Modify: `packages/storage/test/sqlite/workspace-store.test.ts`

- [ ] **Step 1: Change Git fixtures and add the failed-state rejection test**

Mechanically replace fixture status `"APPROVED" as const` with `"FINALIZING" as const` in `publish.test.ts`. Add one focused guard test:

```ts
it("rejects a failed finalization attempt", async () => {
  const fixture = await createGitFixture();
  cleanups.push(fixture.cleanup);
  const provider = gitWorkspaceFactory({
    state: fixture.state,
    worktreeRoot: fixture.worktreeRoot,
  }).create({ baseBranch: "main", pushToRemote: false });
  const acquired = await provider.acquire({ issue: fixture.issue, project: fixture.project });

  await expect(provider.publish({
    issue: {
      ...fixture.issue,
      projectPath: acquired.projectPath,
      status: "FINALIZATION_FAILED",
      resolution: "FIXED",
    },
    resourceId: "git:issue-1",
  })).rejects.toThrow("GIT_WORKSPACE_NOT_FINALIZING");
});
```

Change the atomic completion fixture in `workspace-store.test.ts` from `APPROVED` to `FINALIZING`.

- [ ] **Step 2: Run focused provider and storage tests and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/workspace-git exec vitest run test/publish.test.ts
pnpm --filter @oh-my-bug/storage exec vitest run test/sqlite/workspace-store.test.ts
```

Expected: Git tests FAIL because the provider still requires `APPROVED`; the storage test may fail to compile until its fixture matches the new Core state.

- [ ] **Step 3: Update the Git state guard**

Replace the provider guard with:

```ts
if (input.issue.status !== "FINALIZING") {
  throw new Error("GIT_WORKSPACE_NOT_FINALIZING");
}
```

Do not change commit, merge, push, branch-info, or release behavior.

- [ ] **Step 4: Run focused provider and storage tests and verify GREEN**

Run both commands from Step 2 again.

Expected: PASS.

- [ ] **Step 5: Commit provider contract updates**

```bash
git add packages/workspace-git/src/provider.ts packages/workspace-git/test/publish.test.ts packages/storage/test/sqlite/workspace-store.test.ts
git commit -m "refactor(git): finalize only active deliveries"
```

### Task 5: Render accurate desktop states and failed-only retry

**Files:**
- Modify: `apps/desktop/test/web/issues.test.tsx`
- Modify: `apps/desktop/test/web/app-workbench.test.tsx`
- Modify: `apps/desktop/src/web/issues/issue-status.tsx`
- Modify: `apps/desktop/src/web/issues/issue-detail.tsx`

- [ ] **Step 1: Replace the ambiguous desktop test with two state tests**

Replace `shows retry while an approved branch is waiting to publish` with:

```tsx
it("shows active finalization without a retry action", () => {
  render(<IssueDetail
    issue={{ ...issue, status: "FINALIZING", repair: undefined }}
    onApproveDelivery={async () => undefined}
    onRefresh={async () => undefined}
  />);

  expect(screen.getByText("交付处理中")).toBeVisible();
  expect(screen.queryByRole("button", { name: "重试交付" })).not.toBeInTheDocument();
  expect(screen.queryByText(/发布/)).not.toBeInTheDocument();
});

it("retries only a failed finalization", async () => {
  const onApproveDelivery = vi.fn(async () => undefined);
  render(<IssueDetail
    issue={{ ...issue, status: "FINALIZATION_FAILED", repair: undefined }}
    onApproveDelivery={onApproveDelivery}
    onRefresh={async () => undefined}
  />);

  const recovery = within(screen.getByRole("region", { name: "交付恢复" }));
  expect(recovery.getByText("交付失败，待重试")).toBeVisible();
  expect(recovery.getByText("代码和工作目录已保留，可安全重试交付收尾。")).toBeVisible();
  await act(async () => fireEvent.click(recovery.getByRole("button", { name: "重试交付" })));
  expect(onApproveDelivery).toHaveBeenCalledOnce();
});
```

Add the non-`Error` callback fallback test:

```tsx
it("shows the delivery retry fallback error", async () => {
  render(<IssueDetail
    issue={{ ...issue, status: "FINALIZATION_FAILED", repair: undefined }}
    onApproveDelivery={async () => Promise.reject("unavailable")}
    onRefresh={async () => undefined}
  />);

  fireEvent.click(screen.getByRole("button", { name: "重试交付" }));

  expect(await screen.findByText("重试交付失败")).toBeVisible();
});
```

Change the background live-status fixture in `app-workbench.test.tsx` from `APPROVED` to `FINALIZING`.

- [ ] **Step 2: Run focused desktop tests and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/web/issues.test.tsx test/web/app-workbench.test.tsx
```

Expected: FAIL because the badge map and detail recovery section do not support the two new states.

- [ ] **Step 3: Implement badge labels and variants**

In `issue-status.tsx`, replace the `APPROVED` entries with:

```ts
FINALIZING: "default",
FINALIZATION_FAILED: "destructive",
```

and:

```ts
FINALIZING: "交付处理中",
FINALIZATION_FAILED: "交付失败，待重试",
```

- [ ] **Step 4: Replace publication-local state and render failed-only recovery**

In `issue-detail.tsx`, rename local variables to `finalizationRetrying`, `finalizationRetryError`, and their setters. Replace the `APPROVED` section with:

```tsx
{issue.status === "FINALIZATION_FAILED" && onApproveDelivery ? (
  <section aria-label="交付恢复" className="failure-actions">
    <div>
      <strong>交付失败，待重试</strong>
      <span>代码和工作目录已保留，可安全重试交付收尾。</span>
    </div>
    {finalizationRetryError ? (
      <Alert className="form-error" variant="destructive">
        <AlertDescription>{finalizationRetryError}</AlertDescription>
      </Alert>
    ) : null}
    <Button
      disabled={finalizationRetrying}
      type="button"
      variant="secondary"
      onClick={() => {
        setFinalizationRetrying(true);
        setFinalizationRetryError("");
        void refreshAfter(onApproveDelivery)
          .catch((caught) => setFinalizationRetryError(
            caught instanceof Error ? caught.message : "重试交付失败",
          ))
          .finally(() => setFinalizationRetrying(false));
      }}
    >
      <RotateCcw size={13} />
      {finalizationRetrying ? "重试中…" : "重试交付"}
    </Button>
  </section>
) : null}
```

`FINALIZING` needs no detail action section; its badge is the entire user-facing indication. Remove all user-facing `发布中`, `发布失败`, and `重试发布` copy from this component.

- [ ] **Step 5: Run focused desktop tests and verify GREEN**

Run the command from Step 2 again.

Expected: PASS.

- [ ] **Step 6: Commit desktop behavior**

```bash
git add apps/desktop/src/web/issues/issue-status.tsx apps/desktop/src/web/issues/issue-detail.tsx apps/desktop/test/web/issues.test.tsx apps/desktop/test/web/app-workbench.test.tsx
git commit -m "fix(desktop): distinguish delivery finalization states"
```

### Task 6: Repository-wide compatibility and verification

**Files:**
- Modify only if found by the checks: typed test fixtures that still use the removed lifecycle status.

- [ ] **Step 1: Verify there are no remaining lifecycle uses of `APPROVED`**

Run:

```bash
rg -n 'status:\s*"APPROVED"|status !== "APPROVED"|status === "APPROVED"|APPROVED:' packages apps -g '*.ts' -g '*.tsx'
```

Expected: no matches. Event identifiers such as `ASSESSMENT_APPROVED` and `DELIVERY_APPROVED` are allowed and must remain unchanged.

- [ ] **Step 2: Run all affected workspace test suites**

Run:

```bash
pnpm --filter @oh-my-bug/core --filter @oh-my-bug/storage --filter @oh-my-bug/workspace-git --filter @oh-my-bug/runtime --filter @oh-my-bug/desktop test
```

Expected: PASS with no failed tests.

- [ ] **Step 3: Run repository typechecking**

Run:

```bash
pnpm typecheck
```

Expected: PASS. If a typed fixture still uses `APPROVED`, change only that fixture to `FINALIZING` or `FINALIZATION_FAILED` according to its scenario, then rerun this command.

- [ ] **Step 4: Run formatting/static checks on the completed diff**

Run:

```bash
git diff --check
pnpm lint
```

Expected: both commands PASS without whitespace errors or lint violations.

- [ ] **Step 5: Review Git behavior invariants**

Run:

```bash
git diff -- packages/workspace-git/src/provider.ts apps/desktop/src/web/projects/git-workspace-fields.tsx
```

Expected: provider behavior differs only in the accepted Issue status and error name; project Git settings are untouched.

- [ ] **Step 6: Commit any compatibility-only fixture updates**

If Step 1 or Step 3 required additional fixture changes:

```bash
git add packages apps
git commit -m "test: align finalization status fixtures"
```

If no additional files changed, skip this commit.
