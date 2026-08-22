# Internal Plugin and Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Cordis-owned internal module lifecycle, make Workspace a selectable Runtime capability, and deliver optional Git worktree branches only after user approval while preserving the no-Git flow.

**Architecture:** Core remains unaware of Cordis, Git, Worktree, and provider configuration; it stores only `Issue.projectPath` plus neutral preparation/finalization states. Runtime owns provider selection, orchestration, typed lifecycle hooks, and product APIs. SQLite persists project provider configuration, Issue bindings, and generic module state; Local and Git implementations depend only on the stable module contracts.

**Tech Stack:** TypeScript 6, Node.js 26, Cordis 3.18, Zod 4, better-sqlite3, React 19, Vitest 4, pnpm, native Git CLI

---

## File map

### New packages

- `packages/module-api/src/workspace.ts`: provider, binding, branch, configuration, and persistence contracts.
- `packages/module-api/src/lifecycle.ts`: typed lifecycle event map and listener contracts.
- `packages/module-api/src/index.ts`: public exports for first-party modules and Runtime.
- `packages/workspace-local/src/index.ts`: default provider factory with no filesystem side effects.
- `packages/workspace-git/src/git-client.ts`: safe `git` process execution and Git error normalization.
- `packages/workspace-git/src/provider.ts`: idempotent worktree acquire, approval-time commit/push, and release.
- `packages/workspace-git/src/index.ts`: Git provider factory export.

### Runtime

- `apps/runtime/src/modules/module-host.ts`: thin Cordis lifecycle owner.
- `apps/runtime/src/modules/workspace-registry.ts`: lifecycle-aware provider factory registry.
- `apps/runtime/src/modules/lifecycle-hooks.ts`: typed hook registration, ordered dispatch, and failure reporting.
- `apps/runtime/src/modules/workspace-module.ts`: Cordis adapter that registers one provider factory and unregisters it on ForkScope disposal.
- `apps/runtime/src/orchestration/workspace-coordinator.ts`: durable prepare, finalize, retry, and legacy reconciliation.
- `apps/runtime/src/orchestration/worker.ts`: dispatch neutral `PREPARE` and `FINALIZE` operations and use `Issue.projectPath`.
- `apps/runtime/src/orchestration/commands.ts`: emit lifecycle hooks and persist approval before finalization.
- `apps/runtime/src/orchestration/recovery.ts`: restore preparation/finalization without rerunning Agent work.
- `apps/runtime/src/composition.ts`: the only file importing concrete Workspace modules.
- `apps/runtime/src/service.ts` and `apps/runtime/src/protocol/*`: Workspace configuration, manifests, `ApprovalResult`, and branch information.

### Persistence and product UI

- `packages/storage/src/sqlite/workspace-store.ts`: SQLite implementation of Workspace and module-state contracts.
- `packages/storage/src/sqlite/schema.ts`: Workspace tables and project-scoped integration uniqueness.
- `packages/storage/src/sqlite/database.ts`: forward-only migrations for existing databases.
- `apps/desktop/src/web/projects/project-form.tsx`: provider selection and manifest-driven provider fields.
- `apps/desktop/src/web/projects/config-fields.tsx`: reusable manifest configuration renderer extracted from integration settings.
- `apps/desktop/src/web/issues/issue-detail.tsx`: approved/publishing state, retry, and returned branch summary.

## Task 1: Make Core preparation and approval provider-neutral

**Files:**
- Modify: `packages/core/src/issue/types.ts`
- Modify: `packages/core/src/issue/schema.ts`
- Modify: `packages/core/src/issue/workflow.ts`
- Modify: `packages/core/src/runtime/types.ts`
- Test: `packages/core/test/issue/schema.test.ts`
- Test: `packages/core/test/issue/workflow.test.ts`

- [ ] **Step 1: Write failing Core tests**

Add these focused cases:

```ts
it("accepts a concrete projectPath without describing its source", () => {
  expect(issueSchema.parse({
    ...issueAt("RECEIVED"),
    projectPath: "/tmp/worktrees/OMB-1",
  }).projectPath).toBe("/tmp/worktrees/OMB-1");
});

it("persists approval before final completion", () => {
  const approved = transitionIssue(
    { ...issueAt("ACCEPTANCE_REVIEW"), assessment },
    "APPROVE_DELIVERY",
    "2026-08-22T08:00:00.000Z",
  );
  expect(approved).toMatchObject({ status: "APPROVED", resolution: "FIXED" });

  expect(transitionIssue(
    approved,
    "COMPLETE_DELIVERY",
    "2026-08-22T08:01:00.000Z",
  )).toMatchObject({ status: "COMPLETED", resolution: "FIXED" });
});
```

- [ ] **Step 2: Run the focused tests and confirm failure**

Run:

```bash
pnpm --filter @oh-my-bug/core test -- test/issue/schema.test.ts test/issue/workflow.test.ts
```

Expected: FAIL because `projectPath`, `APPROVED`, and `COMPLETE_DELIVERY` are not in the schemas or transition table.

- [ ] **Step 3: Add the neutral Core fields and transitions**

Use these exact model changes:

```ts
export type IssueStatus =
  | "RECEIVED"
  | "ASSESSING"
  | "ASSESSMENT_REVIEW"
  | "ASSESSMENT_FAILED"
  | "REPAIRING"
  | "EVIDENCE_CHECK"
  | "REPAIR_FAILED"
  | "ACCEPTANCE_REVIEW"
  | "APPROVED"
  | "COMPLETED"
  | "CLOSED"
  | "CANCELED";

// Add to the existing Issue interface.
projectPath?: string;
```

Add `projectPath: z.string().trim().min(1).optional()` and `APPROVED` to `issueSchema`. Extend the workflow with:

```ts
export type IssueAction =
  | "START_ASSESSMENT"
  | "ASSESSMENT_READY"
  | "ASSESSMENT_ERRORED"
  | "RETRY_ASSESSMENT"
  | "REQUEST_REASSESSMENT"
  | "DELIVERY_READY"
  | "EVIDENCE_REJECTED"
  | "EVIDENCE_ACCEPTED"
  | "REPAIR_ERRORED"
  | "RETRY_REPAIR"
  | "REJECT_DELIVERY"
  | "APPROVE_DELIVERY"
  | "COMPLETE_DELIVERY"
  | "CANCEL";

ACCEPTANCE_REVIEW: {
  REJECT_DELIVERY: "REPAIRING",
  APPROVE_DELIVERY: "APPROVED",
  CANCEL: "CANCELED",
},
APPROVED: {
  COMPLETE_DELIVERY: "COMPLETED",
},
```

Keep resolution assignment on `APPROVE_DELIVERY`. Extend pending operations without provider names:

```ts
export type PendingOperation = "PREPARE" | "ASSESS" | "REPAIR" | "FINALIZE";
```

- [ ] **Step 4: Run Core tests**

Run:

```bash
pnpm --filter @oh-my-bug/core test
```

Expected: PASS. Existing approval assertions now expect `APPROVED`, followed by `COMPLETE_DELIVERY` for `COMPLETED`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/issue packages/core/src/runtime/types.ts packages/core/test/issue
git commit -m "feat(core): separate approval from completion"
```

## Task 2: Scope integration input identity by project

**Files:**
- Modify: `packages/core/src/ports/runtime-store.ts`
- Modify: `packages/core/src/runtime/intake.ts`
- Modify: `packages/core/test/runtime/intake.test.ts`
- Modify: `packages/storage/src/sqlite/schema.ts`
- Modify: `packages/storage/src/sqlite/database.ts`
- Modify: `packages/storage/src/sqlite/runtime-store.ts`
- Modify: `packages/storage/test/sqlite/intake-store.test.ts`
- Modify: `apps/runtime/test/acceptance/intake-idempotency.test.ts`

- [ ] **Step 1: Write the cross-project regression tests**

Create two projects and reuse the same integration/input key:

```ts
it("allows the same integration input key in different projects", () => {
  const store = createStore();
  const secondProject = { ...project, id: "project-2", key: "TWO" };
  store.registerProject(project);
  store.registerProject(secondProject);
  store.transaction((tx) => tx.insertIssue(issue, "PREPARE"));
  store.transaction((tx) => tx.insertIssue({
    ...issue,
    id: "issue-2",
    projectId: secondProject.id,
    identifier: "TWO-1",
    inputs: [{ ...input, id: "input-2" }],
  }, "PREPARE"));

  expect(store.transaction((tx) =>
    tx.findIssueByInput(project.id, "sentry", "event-1"),
  )?.id).toBe(issue.id);
  expect(store.transaction((tx) =>
    tx.findIssueByInput(secondProject.id, "sentry", "event-1"),
  )?.id).toBe("issue-2");
});
```

- [ ] **Step 2: Run the regression tests and confirm failure**

Run:

```bash
pnpm --filter @oh-my-bug/storage test -- test/sqlite/intake-store.test.ts
pnpm --filter @oh-my-bug/runtime test -- test/acceptance/intake-idempotency.test.ts
```

Expected: FAIL with a uniqueness error or a TypeScript signature error.

- [ ] **Step 3: Change the port, query, and schema**

Use this signature everywhere:

```ts
findIssueByInput(
  projectId: string,
  integration: string,
  inputKey: string,
): Issue | undefined;
```

Call it from Core intake as:

```ts
const exactIssue = command.transaction.findIssueByInput(
  command.projectId,
  input.integration,
  input.inputKey,
);
```

Change SQLite uniqueness and lookup:

```sql
UNIQUE(project_id, integration, input_key)
```

```ts
WHERE integration_inputs.project_id = ?
  AND integration_inputs.integration = ?
  AND integration_inputs.input_key = ?
```

Add `migrateIntegrationInputIdentity(database)` in `database.ts`. It reads the `integration_inputs` table SQL from `sqlite_master`; when it finds the old `UNIQUE(integration, input_key)`, it drops `integration_inputs_group_index`, renames the old table, creates the new table, copies all rows, drops the old table, and recreates the group index inside one SQLite transaction.

- [ ] **Step 4: Run Core, Storage, and Runtime intake tests**

Run:

```bash
pnpm --filter @oh-my-bug/core test -- test/runtime/intake.test.ts
pnpm --filter @oh-my-bug/storage test -- test/sqlite/intake-store.test.ts test/sqlite/database.test.ts
pnpm --filter @oh-my-bug/runtime test -- test/acceptance/intake-idempotency.test.ts
```

Expected: PASS, including reopening an old-schema database and retaining its inputs.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ports/runtime-store.ts packages/core/src/runtime/intake.ts packages/core/test/runtime/intake.test.ts packages/storage/src/sqlite packages/storage/test/sqlite apps/runtime/test/acceptance/intake-idempotency.test.ts
git commit -m "fix: scope input idempotency by project"
```

## Task 3: Introduce stable Workspace and lifecycle contracts

**Files:**
- Create: `packages/module-api/package.json`
- Create: `packages/module-api/tsconfig.json`
- Create: `packages/module-api/vitest.config.ts`
- Create: `packages/module-api/src/workspace.ts`
- Create: `packages/module-api/src/lifecycle.ts`
- Create: `packages/module-api/src/index.ts`
- Modify: `package.json`

- [ ] **Step 1: Write a compile-time contract test**

Create `packages/module-api/test/contracts.test.ts`:

```ts
import type { RuntimeProject } from "@oh-my-bug/core";
import { describe, expect, it } from "vitest";
import type {
  BranchInfo,
  LifecycleEventMap,
  WorkspaceProviderFactory,
} from "../src/index.js";

describe("internal module contracts", () => {
  it("keeps branch data outside the Core project model", () => {
    const branch: BranchInfo = { name: "ohmybug/omb-1", commit: "abc123" };
    const project: RuntimeProject = { id: "p1", key: "P1", path: "/repo" };
    const factory = { id: "local" } as WorkspaceProviderFactory;
    const event: keyof LifecycleEventMap = "issue.completed";
    expect({ branch, project, factory: factory.id, event }).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the new package test and confirm failure**

Run:

```bash
pnpm --filter @oh-my-bug/module-api test
```

Expected: FAIL because the package and contracts do not exist.

- [ ] **Step 3: Add package metadata and exact contracts**

Use this package metadata:

```json
{
  "name": "@oh-my-bug/module-api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": { "@oh-my-bug/core": "workspace:*" },
  "devDependencies": { "typescript": "^6.0.3", "vitest": "^4.1.11" }
}
```

Define these contracts in `workspace.ts`:

```ts
import type {
  ConfigField,
  ConfigValue,
  Issue,
  NewIssueEvent,
  RuntimeProject,
} from "@oh-my-bug/core";

export interface BranchInfo {
  name: string;
  commit: string;
  remote?: string;
}

export interface WorkspaceProjectConfiguration {
  provider: string;
  config: Record<string, ConfigValue>;
}

export interface WorkspaceProviderManifest {
  id: string;
  name: string;
  configFields: ConfigField[];
}

export interface WorkspaceBinding {
  issueId: string;
  providerId: string;
  resourceId: string;
  status: "PREPARING" | "READY" | "FAILED" | "RELEASED";
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceProvider {
  readonly id: string;
  acquire(input: { issue: Issue; project: RuntimeProject }): Promise<{
    projectPath: string;
    resourceId: string;
  }>;
  publish(input: { issue: Issue; resourceId: string }): Promise<BranchInfo | undefined>;
  release(input: { issue: Issue; resourceId: string }): Promise<void>;
}

export interface WorkspaceProviderFactory {
  readonly id: string;
  readonly manifest: WorkspaceProviderManifest;
  validate(config: Record<string, ConfigValue>): void;
  create(config: Record<string, ConfigValue>): WorkspaceProvider;
}

export interface ModuleStateStore {
  get<T>(moduleId: string, resourceId: string): T | undefined;
  set<T>(moduleId: string, resourceId: string, value: T): void;
  delete(moduleId: string, resourceId: string): void;
}

export interface WorkspacePersistence {
  transaction<T>(work: () => T): T;
  getProjectConfiguration(projectId: string): WorkspaceProjectConfiguration | undefined;
  setProjectConfiguration(projectId: string, value: WorkspaceProjectConfiguration): void;
  getBinding(issueId: string): WorkspaceBinding | undefined;
  beginAcquire(binding: WorkspaceBinding): void;
  completeAcquire(input: {
    binding: WorkspaceBinding;
    issue: Issue;
    expectedRevision: number;
    event: NewIssueEvent;
  }): Issue;
  failAcquire(binding: WorkspaceBinding, event: NewIssueEvent): void;
  completeRelease(input: {
    binding: WorkspaceBinding;
    issue: Issue;
    expectedRevision: number;
    event: NewIssueEvent;
  }): Issue;
}
```

Define lifecycle types in `lifecycle.ts`:

```ts
import type { Assessment, IntegrationInput, Issue, RuntimeProject } from "@oh-my-bug/core";
import type { BranchInfo } from "./workspace.js";

export interface LifecycleEventMap {
  "issue.beforeCreate": { issue: Issue; project: RuntimeProject; input: IntegrationInput };
  "issue.created": { issue: Issue; project: RuntimeProject };
  "assessment.before": { issue: Issue; project: RuntimeProject };
  "assessment.after": { issue: Issue; project: RuntimeProject; assessment?: Assessment };
  "repair.before": { issue: Issue; project: RuntimeProject };
  "repair.after": { issue: Issue; project: RuntimeProject };
  "issue.userApproved": { issue: Issue; project: RuntimeProject };
  "issue.completed": { issue: Issue; project: RuntimeProject; branch?: BranchInfo };
}

export type LifecycleListener<K extends keyof LifecycleEventMap> =
  (payload: Readonly<LifecycleEventMap[K]>) => void;

export interface LifecycleHooks {
  on<K extends keyof LifecycleEventMap>(
    owner: string,
    name: K,
    listener: LifecycleListener<K>,
  ): () => void;
  emit<K extends keyof LifecycleEventMap>(name: K, payload: LifecycleEventMap[K]): void;
}
```

Import `BranchInfo` from `workspace.ts`, export both files from `index.ts`, and add the new package to root typecheck/test filter lists.

- [ ] **Step 4: Install and verify package contracts**

Run:

```bash
pnpm install
pnpm --filter @oh-my-bug/module-api typecheck
pnpm --filter @oh-my-bug/module-api test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml packages/module-api
git commit -m "feat: define internal module contracts"
```

## Task 4: Persist Workspace configuration, bindings, and module state

**Files:**
- Create: `packages/storage/src/sqlite/workspace-store.ts`
- Modify: `packages/storage/src/sqlite/schema.ts`
- Modify: `packages/storage/src/index.ts`
- Modify: `packages/storage/package.json`
- Create: `packages/storage/test/sqlite/workspace-store.test.ts`

- [ ] **Step 1: Write persistence and atomicity tests**

Cover project configuration, module state round-trip, failed bindings, and atomic path assignment:

```ts
it("assigns projectPath and queues Assessment atomically with a READY binding", () => {
  const { runtime, workspaces } = createWorkspaceStores();
  runtime.registerProject(project);
  runtime.transaction((tx) => tx.insertIssue(issue, "PREPARE"));
  const binding = {
    issueId: issue.id,
    providerId: "local",
    resourceId: `local:${issue.id}`,
    status: "READY" as const,
    createdAt: now,
    updatedAt: now,
  };

  const assigned = workspaces.completeAcquire({
    binding,
    issue: { ...issue, projectPath: project.path, revision: 2, updatedAt: now },
    expectedRevision: 1,
    event: workspaceEvent(issue.id, "WORKSPACE_READY"),
  });

  expect(workspaces.getBinding(issue.id)).toEqual(binding);
  expect(runtime.listPendingOperations()).toEqual([{ issue: assigned, operation: "ASSESS" }]);
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run:

```bash
pnpm --filter @oh-my-bug/storage test -- test/sqlite/workspace-store.test.ts
```

Expected: FAIL because `SqliteWorkspaceStore` and tables do not exist.

- [ ] **Step 3: Add tables and the SQLite adapter**

Add `"@oh-my-bug/module-api": "workspace:*"` to `packages/storage/package.json`.

Add these tables:

```sql
CREATE TABLE IF NOT EXISTS workspace_project_configurations (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  config_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_bindings (
  issue_id TEXT PRIMARY KEY REFERENCES issues(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PREPARING', 'READY', 'FAILED', 'RELEASED')),
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS module_resources (
  module_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  data_json TEXT NOT NULL,
  PRIMARY KEY(module_id, resource_id)
);
```

Implement `SqliteWorkspaceStore implements WorkspacePersistence, ModuleStateStore`. `completeAcquire()` must use `database.transaction`, compare the Issue revision, update `issues.data_json`, set `pending_operation = 'ASSESS'`, upsert the READY binding, and append its event before commit. `completeRelease()` receives an Issue already reduced with `COMPLETE_DELIVERY`; it must persist that Issue with the RELEASED binding, clear pending operation, and append `ISSUE_COMPLETED` atomically.

`completeAcquire()` must reject an attempt to replace an existing non-empty `Issue.projectPath` with a different path. Add a compare-and-swap test proving both the original path and binding survive that rejection.

- [ ] **Step 4: Run Storage tests**

Run:

```bash
pnpm --filter @oh-my-bug/storage typecheck
pnpm --filter @oh-my-bug/storage test -- test/sqlite/workspace-store.test.ts test/sqlite/issue-store.test.ts
```

Expected: PASS; a forced revision mismatch leaves both Issue and binding unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/storage/package.json packages/storage/src packages/storage/test/sqlite/workspace-store.test.ts
git commit -m "feat(storage): persist workspace lifecycle"
```

## Task 5: Add the Cordis module host, registry, and typed hooks

**Files:**
- Create: `apps/runtime/src/modules/module-host.ts`
- Create: `apps/runtime/src/modules/workspace-registry.ts`
- Create: `apps/runtime/src/modules/lifecycle-hooks.ts`
- Create: `apps/runtime/src/modules/workspace-module.ts`
- Create: `apps/runtime/test/module-host.test.ts`
- Modify: `apps/runtime/package.json`

- [ ] **Step 1: Write module lifecycle tests**

```ts
it("unregisters a provider when its Cordis ForkScope is disposed", async () => {
  const registry = new WorkspaceRegistry();
  const host = new ModuleHost();
  const mounted = host.mount(workspaceModule, {
    factory: fakeWorkspaceFactory("git"),
    registry,
  });
  await host.start();
  expect(registry.create("git", {}).id).toBe("git");

  mounted.dispose();
  expect(() => registry.create("git", {})).toThrow("WORKSPACE_PROVIDER_NOT_AVAILABLE:git");
});

it("isolates hook failures and identifies the owning module", () => {
  const failures: Array<{ owner: string; hook: string; error: unknown }> = [];
  const hooks = new RuntimeLifecycleHooks((owner, hook, error) =>
    failures.push({ owner, hook, error }));
  hooks.on("broken", "issue.completed", () => { throw new Error("PIPELINE_FAILED"); });
  hooks.emit("issue.completed", { issue, project, branch: undefined });
  expect(failures[0]).toMatchObject({ owner: "broken", hook: "issue.completed" });
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run:

```bash
pnpm --filter @oh-my-bug/runtime test -- test/module-host.test.ts
```

Expected: FAIL because the host and registries do not exist.

- [ ] **Step 3: Implement the thin Cordis boundary**

Add `"@cordisjs/core": "3.18.1"` and `"@oh-my-bug/module-api": "workspace:*"` to Runtime dependencies. Implement the host with no Runtime business methods:

```ts
import { Context, ScopeStatus, type ForkScope, type Plugin } from "@cordisjs/core";

export class ModuleHost {
  private readonly context = new Context();
  private readonly scopes: ForkScope[] = [];

  mount<T>(plugin: Plugin<Context, T>, config: T): ForkScope {
    const scope = this.context.plugin(plugin, config);
    this.scopes.push(scope);
    return scope;
  }

  async start(): Promise<void> {
    const failed = this.scopes.find((scope) => scope.status === ScopeStatus.FAILED);
    if (failed) throw failed.error;
  }

  async stop(): Promise<void> {
    for (const scope of [...this.scopes].reverse()) scope.dispose();
    this.scopes.length = 0;
  }
}
```

`WorkspaceRegistry.register(factory)` returns an unregister function and rejects duplicate IDs. `create(id, config)` throws `WORKSPACE_PROVIDER_NOT_AVAILABLE:${id}` and calls `factory.create(structuredClone(config))`. `validate(id, config)` calls the selected factory's validator. Existing bindings may call `create(providerId, {})`: Local ignores the empty object; Git finalization and recovery read persisted resource state before requiring acquisition configuration.

Implement the Cordis adapter:

```ts
export function workspaceModule(
  ctx: Context,
  config: { factory: WorkspaceProviderFactory; registry: WorkspaceRegistry },
): void {
  ctx.effect(() => config.registry.register(config.factory));
}
```

`RuntimeLifecycleHooks` stores listeners in registration order, returns an unregister function, catches each listener error, and continues dispatching later listeners.

- [ ] **Step 4: Run module tests**

Run:

```bash
pnpm --filter @oh-my-bug/runtime typecheck
pnpm --filter @oh-my-bug/runtime test -- test/module-host.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/runtime/package.json apps/runtime/src/modules apps/runtime/test/module-host.test.ts pnpm-lock.yaml
git commit -m "feat(runtime): host internal modules with Cordis"
```

## Task 6: Mount LocalWorkspace and prepare every new Issue

**Files:**
- Create: `packages/workspace-local/package.json`
- Create: `packages/workspace-local/tsconfig.json`
- Create: `packages/workspace-local/src/index.ts`
- Create: `packages/workspace-local/test/provider.test.ts`
- Modify: `package.json`
- Modify: `apps/runtime/package.json`
- Create: `apps/runtime/src/orchestration/workspace-coordinator.ts`
- Modify: `apps/runtime/src/orchestration/worker.ts`
- Modify: `apps/runtime/src/orchestration/commands.ts`
- Modify: `apps/runtime/src/runtime.ts`
- Modify: `apps/runtime/src/composition.ts`
- Modify: `apps/runtime/test/helpers/runtime.ts`
- Modify: `apps/runtime/test/assessment-worker.test.ts`

- [ ] **Step 1: Write Local provider and prepare-gate tests**

```ts
it("returns the registered project path without side effects", async () => {
  const provider = localWorkspaceFactory.create({});
  await expect(provider.acquire({ issue, project })).resolves.toEqual({
    projectPath: project.path,
    resourceId: `local:${issue.id}`,
  });
  await expect(provider.publish({ issue, resourceId: `local:${issue.id}` }))
    .resolves.toBeUndefined();
});

it("prepares a path before Assessment can start", async () => {
  const harness = createHarness();
  const created = await harness.commands.submitManual(project.id, {
    commandId: "prepare-1",
    content: "Checkout fails",
  });
  if (created.kind !== "CREATED") throw new Error("CREATED_REQUIRED");
  expect(harness.store.listPendingOperations()[0]?.operation).toBe("PREPARE");

  await harness.worker.drainOne();
  expect(harness.store.getIssue(created.issue.id)).toMatchObject({ projectPath: project.path });
  expect(harness.store.listPendingOperations()[0]?.operation).toBe("ASSESS");
  expect(harness.agent.assessInputs).toHaveLength(0);
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
pnpm --filter @oh-my-bug/workspace-local test
pnpm --filter @oh-my-bug/runtime test -- test/assessment-worker.test.ts
```

Expected: FAIL because new Issues currently queue `ASSESS` and no coordinator exists.

- [ ] **Step 3: Implement LocalWorkspace and preparation orchestration**

Use this package metadata and add the package to root test/typecheck filters:

```json
{
  "name": "@oh-my-bug/workspace-local",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": {
    "@oh-my-bug/core": "workspace:*",
    "@oh-my-bug/module-api": "workspace:*"
  }
}
```

Add `@oh-my-bug/workspace-local: workspace:*` to `apps/runtime/package.json`.

Export this factory from the new package:

```ts
export const localWorkspaceFactory: WorkspaceProviderFactory = {
  id: "local",
  manifest: { id: "local", name: "本机目录", configFields: [] },
  validate() {},
  create() {
    return {
      id: "local",
      async acquire({ issue, project }) {
        return { projectPath: project.path, resourceId: `local:${issue.id}` };
      },
      async publish() { return undefined; },
      async release() {},
    };
  },
};
```

Change Core intake insertion to `PREPARE`. Implement `WorkspaceCoordinator.prepare(issue)` with this order:

1. Load the project and persisted binding.
2. Use the binding provider when present; otherwise use project configuration or `{ provider: "local", config: {} }`.
3. Persist `PREPARING` before calling `acquire()`, using the stable resource identity `<providerId>:<issueId>`.
4. Call the selected provider.
5. Require `acquire()` to return the same stable resource identity, then persist READY binding, `Issue.projectPath`, `WORKSPACE_READY`, and pending `ASSESS` through `completeAcquire()`.
6. On failure, persist FAILED, clear pending work, append `WORKSPACE_PREPARATION_FAILED`, and keep the Issue at `RECEIVED`.

Dispatch `PREPARE` in `RuntimeWorker.drainOne()`. Mount `localWorkspaceFactory` through `workspaceModule` in composition. Await `ModuleHost.start()` before recovery and dispose its ForkScopes before closing SQLite.

- [ ] **Step 4: Run Local and Runtime tests**

Run:

```bash
pnpm --filter @oh-my-bug/workspace-local test
pnpm --filter @oh-my-bug/runtime test -- test/assessment-worker.test.ts test/composition.test.ts
```

Expected: PASS; default projects still reach Assessment with their original path.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml packages/workspace-local apps/runtime/package.json apps/runtime/src apps/runtime/test
git commit -m "feat: prepare issues through LocalWorkspace"
```

## Task 7: Route Agent and Evidence through Issue.projectPath

**Files:**
- Modify: `packages/agent-codex/src/codex-agent-adapter.ts`
- Modify: `packages/agent-codex/test/assessment.test.ts`
- Modify: `packages/agent-codex/test/repair.test.ts`
- Modify: `apps/runtime/src/orchestration/worker.ts`
- Modify: `apps/runtime/test/assessment-worker.test.ts`
- Modify: `apps/runtime/test/repair-worker.test.ts`

- [ ] **Step 1: Write path isolation tests**

Use different source and Issue paths:

```ts
const isolatedIssue = { ...issue, projectPath: "/tmp/worktrees/OMB-1" };
await agent.assess(session, { issue: isolatedIssue, project, feedback: undefined });
expect(client.turns[0]?.workingDirectory).toBe(isolatedIssue.projectPath);
```

For Repair, assert both evidence intake and import receive `isolatedIssue.projectPath`, while the Agent still receives the original project metadata for commands and instructions.

- [ ] **Step 2: Run focused Agent and Runtime tests**

Run:

```bash
pnpm --filter @oh-my-bug/agent-codex test -- test/assessment.test.ts test/repair.test.ts
pnpm --filter @oh-my-bug/runtime test -- test/assessment-worker.test.ts test/repair-worker.test.ts
```

Expected: FAIL because all three filesystem consumers still use `project.path`.

- [ ] **Step 3: Replace path derivation with one guard**

Add and use this helper:

```ts
function requireProjectPath(issue: Issue): string {
  if (!issue.projectPath) throw new Error("ISSUE_PROJECT_PATH_REQUIRED");
  return issue.projectPath;
}
```

In Codex Assessment and Repair options set:

```ts
workingDirectory: requireProjectPath(input.issue)
```

In Runtime Worker use the same value for `prepareIntake()` and `evidence.import({ workspaceDirectory })`. Do not mutate `RuntimeProject.path` or create a derived project object.

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm --filter @oh-my-bug/agent-codex test
pnpm --filter @oh-my-bug/runtime test -- test/assessment-worker.test.ts test/repair-worker.test.ts
```

Expected: PASS, including a failure assertion for an `ASSESS` operation whose Issue lacks `projectPath`.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-codex apps/runtime/src/orchestration/worker.ts apps/runtime/test/assessment-worker.test.ts apps/runtime/test/repair-worker.test.ts
git commit -m "feat: isolate agent work by issue path"
```

## Task 8: Emit the confirmed typed lifecycle hooks

**Files:**
- Modify: `packages/core/src/runtime/intake.ts`
- Modify: `apps/runtime/src/orchestration/commands.ts`
- Modify: `apps/runtime/src/orchestration/worker.ts`
- Modify: `apps/runtime/src/orchestration/workspace-coordinator.ts`
- Create: `apps/runtime/test/lifecycle-hooks.test.ts`

- [ ] **Step 1: Write ordered lifecycle tests**

```ts
it("emits the public lifecycle in workflow order", async () => {
  const observed: string[] = [];
  for (const name of [
    "issue.beforeCreate",
    "issue.created",
    "assessment.before",
    "assessment.after",
    "repair.before",
    "repair.after",
    "issue.userApproved",
    "issue.completed",
  ] as const) hooks.on("observer", name, () => observed.push(name));

  await runSuccessfulLocalFlow(harness);
  expect(observed).toEqual([
    "issue.beforeCreate",
    "issue.created",
    "assessment.before",
    "assessment.after",
    "repair.before",
    "repair.after",
    "issue.userApproved",
    "issue.completed",
  ]);
});
```

- [ ] **Step 2: Run test and confirm failure**

Run:

```bash
pnpm --filter @oh-my-bug/runtime test -- test/lifecycle-hooks.test.ts
```

Expected: FAIL with an empty observed list.

- [ ] **Step 3: Emit hooks at persisted boundaries**

Add an optional synchronous callback to Core intake:

```ts
export interface AcceptIntegrationInputCommand {
  projectId: string;
  input: IntegrationInput;
  transaction: RuntimeTransaction;
  id: () => string;
  now: string;
  beforeCreate?(issue: Issue): void;
}

const issue = createIssue({
  ...identity,
  projectId: command.projectId,
  input,
  now: command.now,
});
command.beforeCreate?.(issue);
command.transaction.insertIssue(issue, "PREPARE");
```

Runtime passes `hooks.emit("issue.beforeCreate", ...)`; after the intake transaction commits it emits `issue.created` only for `CREATED`.

Emit Assessment/Repair `before` after the pending operation is claimed and before calling Agent. Emit `after` after the success/failure Core result is persisted. Emit `issue.userApproved` after the APPROVED transaction commits. Emit `issue.completed` only after BranchInfo is persisted, provider release succeeds, and Core completion commits.

Hook failures must call the Runtime reporter, which appends:

```ts
{
  type: "MODULE_HOOK_FAILED",
  actor: "SYSTEM",
  data: { owner, hook, message: publicModuleError(error) },
}
```

The Core transition remains committed and later listeners still run. Hooks remain synchronous notifications: a follow-up module enqueues its own durable Runtime operation from the listener instead of holding or rolling back the Issue transition.

- [ ] **Step 4: Run hook and workflow tests**

Run:

```bash
pnpm --filter @oh-my-bug/core test -- test/runtime/intake.test.ts
pnpm --filter @oh-my-bug/runtime test -- test/lifecycle-hooks.test.ts test/commands.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/runtime/intake.ts packages/core/test/runtime/intake.test.ts apps/runtime/src apps/runtime/test/lifecycle-hooks.test.ts apps/runtime/test/commands.test.ts
git commit -m "feat(runtime): emit typed lifecycle hooks"
```

## Task 9: Expose provider manifests and per-project selection

**Files:**
- Modify: `apps/runtime/src/protocol/types.ts`
- Modify: `apps/runtime/src/protocol/schema-definitions.ts`
- Modify: `apps/runtime/src/protocol/operations.ts`
- Modify: `apps/runtime/src/service.ts`
- Modify: `apps/runtime/src/composition.ts`
- Modify: `apps/runtime/test/protocol/service.test.ts`
- Modify: `apps/runtime/test/protocol/operations.test.ts`

- [ ] **Step 1: Write protocol tests**

```ts
it("defaults projects to LocalWorkspace and rejects unavailable providers", async () => {
  const created = await service.createProject({ path: root, key: "SHOP" });
  expect(created.workspace).toEqual({ provider: "local", config: {} });
  await expect(service.updateProject({
    id: created.id,
    input: {
      expectedRevision: created.revision,
      workspace: { provider: "missing", config: {} },
    },
  })).rejects.toThrow("WORKSPACE_PROVIDER_NOT_AVAILABLE:missing");
});
```

- [ ] **Step 2: Run protocol tests and confirm failure**

Run:

```bash
pnpm --filter @oh-my-bug/runtime test -- test/protocol/service.test.ts test/protocol/operations.test.ts
```

Expected: FAIL because Workspace protocol fields and operations do not exist.

- [ ] **Step 3: Add Runtime-only product configuration**

Add to `CreateProjectInput` and `UpdateProjectInput`:

```ts
workspace?: WorkspaceProjectConfiguration;
```

Use a separate product output type so unavailable persisted configuration remains representable. Add `workspace: ProductWorkspaceConfiguration` to the existing `ProductProject` interface:

```ts
export interface ProductWorkspaceConfiguration extends WorkspaceProjectConfiguration {
  unavailable?: string;
}

workspace: ProductWorkspaceConfiguration;
```

Add `listWorkspaceProviders` to `RuntimeApi`, returning `WorkspaceProviderManifest[]`. Validate provider configuration by calling `WorkspaceRegistry.validate(provider, config)` during create/update, then persist it with `WorkspacePersistence.setProjectConfiguration()`. Absence means `{ provider: "local", config: {} }`.

Project registration and Workspace configuration must execute inside one `SqliteWorkspaceStore.transaction()` so a failed provider write does not leave a partially created or updated project. `ProductProject` reads configuration from Workspace persistence; unavailable persisted providers remain visible with `unavailable: "WORKSPACE_PROVIDER_NOT_AVAILABLE:<id>"` and are never rewritten to Local.

- [ ] **Step 4: Run Runtime protocol tests**

Run:

```bash
pnpm --filter @oh-my-bug/runtime typecheck
pnpm --filter @oh-my-bug/runtime test -- test/protocol/service.test.ts test/protocol/operations.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/runtime/src/protocol apps/runtime/src/service.ts apps/runtime/src/composition.ts apps/runtime/test/protocol
git commit -m "feat(runtime): configure workspace providers per project"
```

## Task 10: Implement idempotent Git worktree acquisition

**Files:**
- Create: `packages/workspace-git/package.json`
- Create: `packages/workspace-git/tsconfig.json`
- Create: `packages/workspace-git/src/git-client.ts`
- Create: `packages/workspace-git/src/provider.ts`
- Create: `packages/workspace-git/src/index.ts`
- Create: `packages/workspace-git/test/helpers.ts`
- Create: `packages/workspace-git/test/acquire.test.ts`
- Modify: `package.json`
- Modify: `apps/runtime/package.json`
- Modify: `apps/runtime/src/composition.ts`

- [ ] **Step 1: Write real temporary-repository acquire tests**

```ts
it("creates one stable Issue branch and worktree", async () => {
  const fixture = await createGitFixture();
  const provider = gitWorkspaceFactory({
    state: fixture.state,
    worktreeRoot: fixture.worktreeRoot,
  }).create({ baseBranch: "main", delivery: "local" });

  const first = await provider.acquire({ issue, project: fixture.project });
  const second = await provider.acquire({ issue, project: fixture.project });

  expect(second).toEqual(first);
  expect(first.projectPath).not.toBe(fixture.project.path);
  expect(await git(fixture.repository, "branch", "--show-current")).toBe("main");
  expect(await git(first.projectPath, "branch", "--show-current")).toBe("ohmybug/omb-1");
});
```

Also test a project path below the Git root; returned `projectPath` must point to the same relative subdirectory inside the worktree.

- [ ] **Step 2: Run Git acquire tests and confirm failure**

Run:

```bash
pnpm --filter @oh-my-bug/workspace-git test -- test/acquire.test.ts
```

Expected: FAIL because the package does not exist.

- [ ] **Step 3: Implement safe Git acquisition**

Use this package metadata and add the package to root test/typecheck filters:

```json
{
  "name": "@oh-my-bug/workspace-git",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": {
    "@oh-my-bug/core": "workspace:*",
    "@oh-my-bug/module-api": "workspace:*",
    "zod": "^4.4.3"
  }
}
```

Add `@oh-my-bug/workspace-git: workspace:*` to `apps/runtime/package.json`.

Use `execFile("git", args, { cwd })`, never a shell command string. Normalize stdout with `.trim()` and preserve stderr only as an internal `cause`.

Validate this provider configuration in `factory.validate()` with Zod:

```ts
const gitWorkspaceConfigSchema = z.object({
  baseBranch: z.string().trim().min(1),
  delivery: z.enum(["local", "remote"]),
  remote: z.string().trim().min(1).optional(),
}).strict().refine(
  (value) => value.delivery === "local" || Boolean(value.remote),
  { message: "GIT_REMOTE_REQUIRED" },
);
```

Expose this manifest from the factory:

```ts
manifest: {
  id: "git",
  name: "Git Worktree",
  configFields: [
    { key: "baseBranch", type: "string", label: "基线分支", required: true, defaultValue: "main" },
    { key: "delivery", type: "string", label: "交付方式", required: true, defaultValue: "local" },
    { key: "remote", type: "string", label: "远程仓库", required: false, defaultValue: "origin" },
  ],
},
```

`factory.create(config)` stores the unparsed configuration. `acquire()` first reuses persisted resource state; only a new acquisition parses the stored configuration. This lets publication and recovery reopen an existing resource through `create("git", {})` without consulting a changed project default.

Persist this exact resource state under module `workspace-git` and resource `git:${issue.id}`:

```ts
interface GitWorkspaceState {
  issueId: string;
  repositoryPath: string;
  projectRelativePath: string;
  worktreePath: string;
  branch: string;
  baseBranch: string;
  baseCommit: string;
  delivery: "local" | "remote";
  remote?: string;
  branchInfo?: BranchInfo;
}
```

Resolve repository root and base commit, use branch `ohmybug/${issue.identifier.toLowerCase()}`, and worktree directory `<worktreeRoot>/<projectId>/<issueId>`. On retry, reuse saved state. If the branch exists but the worktree directory is missing after a crash, run `git worktree add <path> <branch>` instead of creating another branch.

Mount this factory in Desktop composition with `worktreeRoot: join(dataRoot, "worktrees")`. Keep Local mounted and selected by default.

- [ ] **Step 4: Run Git and composition tests**

Run:

```bash
pnpm --filter @oh-my-bug/workspace-git typecheck
pnpm --filter @oh-my-bug/workspace-git test -- test/acquire.test.ts
pnpm --filter @oh-my-bug/runtime test -- test/composition.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml packages/workspace-git apps/runtime/package.json apps/runtime/src/composition.ts apps/runtime/test/composition.test.ts
git commit -m "feat(git): acquire isolated issue worktrees"
```

## Task 11: Commit and optionally push only after approval

**Files:**
- Modify: `packages/workspace-git/src/provider.ts`
- Create: `packages/workspace-git/test/publish.test.ts`
- Modify: `apps/runtime/src/orchestration/workspace-coordinator.ts`
- Modify: `apps/runtime/src/orchestration/worker.ts`
- Modify: `apps/runtime/src/orchestration/commands.ts`
- Modify: `apps/runtime/src/runtime.ts`
- Modify: `apps/runtime/test/commands.test.ts`
- Create: `apps/runtime/test/workspace-finalization.test.ts`

- [ ] **Step 1: Write approval boundary and publish tests**

```ts
it("does not commit before approval and returns a local branch after approval", async () => {
  const fixture = await createGitFlowHarness({ delivery: "local" });
  const before = await git(fixture.worktree, "rev-parse", "HEAD");
  await writeFile(join(fixture.issue.projectPath!, "fixed.txt"), "fixed\n");
  expect(await git(fixture.worktree, "rev-parse", "HEAD")).toBe(before);

  const result = await fixture.runtime.approveDelivery(fixture.issue.id);
  expect(result).toMatchObject({
    issue: { status: "COMPLETED" },
    branch: { name: "ohmybug/omb-1" },
  });
  expect(result.branch?.commit).not.toBe(before);
});
```

Add remote delivery using a temporary bare repository. Add a failure test where the first push fails, leaves the Issue `APPROVED` and worktree present, then succeeds on a second `approveDelivery()` without another Repair or duplicate commit.

Add a cancellation case proving an uncommitted Git worktree remains on disk and no forced release is attempted.

- [ ] **Step 2: Run publish tests and confirm failure**

Run:

```bash
pnpm --filter @oh-my-bug/workspace-git test -- test/publish.test.ts
pnpm --filter @oh-my-bug/runtime test -- test/workspace-finalization.test.ts
```

Expected: FAIL because publish/finalization are not implemented.

- [ ] **Step 3: Implement idempotent publish, release, and finalization**

In Git `publish()`:

1. Return persisted `branchInfo` immediately when present.
2. Run `git status --porcelain`; when changes exist, run `git add -A` and `git commit -m "<identifier>: <title>"`.
3. Read `HEAD` as the commit. A clean worktree returns the existing branch HEAD without creating an empty commit.
4. For remote delivery run `git push <remote> refs/heads/<branch>:refs/heads/<branch>`.
5. Persist `{ name, commit, remote? }` before returning it.

In `release()`, run `git worktree remove <worktreePath>` without `--force`; successful publish has a clean worktree. Keep the branch.

Change `RuntimeCommands.approveDelivery()` to persist `APPROVED` with pending `FINALIZE`, emit `issue.userApproved`, and wake the worker. Calling it in `APPROVED` queues another `FINALIZE` without changing revision or rerunning Agent stages.

`WorkspaceCoordinator.finalize(issue)` must load the persisted binding, call `publish()`, then `release()`, then call `completeRelease()` so BranchInfo already exists before Core reaches `COMPLETED`. Publish/release failure clears pending work, appends `WORKSPACE_PUBLISH_FAILED`, keeps the binding and Issue `APPROVED`, and leaves the worktree available for retry.

- [ ] **Step 4: Run Git, Runtime, and Core workflow tests**

Run:

```bash
pnpm --filter @oh-my-bug/workspace-git test
pnpm --filter @oh-my-bug/runtime test -- test/commands.test.ts test/workspace-finalization.test.ts
pnpm --filter @oh-my-bug/core test -- test/issue/workflow.test.ts
```

Expected: PASS; no test or diff command is invoked by finalization.

- [ ] **Step 5: Commit**

```bash
git add packages/workspace-git apps/runtime/src/orchestration apps/runtime/src/runtime.ts apps/runtime/test/commands.test.ts apps/runtime/test/workspace-finalization.test.ts
git commit -m "feat(git): publish approved issue branches"
```

## Task 12: Return ApprovalResult through the product protocol

**Files:**
- Modify: `apps/runtime/src/protocol/types.ts`
- Modify: `apps/runtime/src/protocol/schema-definitions.ts`
- Modify: `apps/runtime/src/protocol/operations.ts`
- Modify: `apps/runtime/src/service.ts`
- Modify: `apps/desktop/src/electron/desktop-api.ts`
- Modify: `apps/desktop/src/web/api/types.ts`
- Modify: `apps/desktop/src/web/api/transport.ts`
- Modify: `apps/desktop/src/web/api/desktop-transport.ts`
- Modify: `apps/desktop/src/web/app.tsx`
- Modify: `apps/desktop/src/web/issues/issue-detail.tsx`
- Modify: `apps/desktop/src/web/issues/issue-status.tsx`
- Modify: `apps/runtime/test/protocol/service.test.ts`
- Modify: `apps/desktop/test/web/issues.test.tsx`

- [ ] **Step 1: Write protocol and UI tests**

```ts
it("returns branch information outside the Core Issue", async () => {
  await expect(service.approveDelivery({ id: "issue-1" })).resolves.toEqual({
    issue: expect.objectContaining({ status: "COMPLETED" }),
    branch: { name: "ohmybug/omb-1", commit: "abc123" },
  });
});

it("shows retry while an approved branch is waiting to publish", () => {
  renderIssue({ ...issue, status: "APPROVED" });
  expect(screen.getByRole("button", { name: "重试发布" })).toBeVisible();
});
```

- [ ] **Step 2: Run protocol and UI tests and confirm failure**

Run:

```bash
pnpm --filter @oh-my-bug/runtime test -- test/protocol/service.test.ts
pnpm --filter @oh-my-bug/desktop test -- test/web/issues.test.tsx
```

Expected: FAIL because approval still returns a bare Issue and `APPROVED` has no UI mapping.

- [ ] **Step 3: Add the product result without changing Core Issue**

Define and validate:

```ts
export interface ApprovalResult {
  issue: Issue;
  branch?: BranchInfo;
}

export const branchInfoSchema = z.object({
  name: identifierSchema,
  commit: identifierSchema,
  remote: identifierSchema.optional(),
}).strict();

export const approvalResultSchema = z.object({
  issue: issueSchema,
  branch: branchInfoSchema.optional(),
}).strict();
```

Make `approveDelivery` async through Runtime, Service, operation schema, IPC bridge, and renderer transport. Runtime waits for finalization and returns the latest Issue plus BranchInfo from module state. The renderer stores the returned branch beside the selected Issue and shows branch name, short commit, and optional remote. `APPROVED` displays as `发布中/待重试`; its action calls `approveDelivery` again.

- [ ] **Step 4: Run product boundary tests**

Run:

```bash
pnpm --filter @oh-my-bug/runtime test -- test/protocol
pnpm --filter @oh-my-bug/desktop test -- test/electron/desktop-api.test.ts test/web/issues.test.tsx test/web/transport.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/runtime/src apps/runtime/test/protocol apps/desktop/src apps/desktop/test/electron/desktop-api.test.ts apps/desktop/test/web/issues.test.tsx apps/desktop/test/web/transport.test.ts
git commit -m "feat: return published branch information"
```

## Task 13: Add manifest-driven Workspace project settings

**Files:**
- Create: `apps/desktop/src/web/projects/config-fields.tsx`
- Modify: `apps/desktop/src/web/projects/integration-fields.tsx`
- Modify: `apps/desktop/src/web/projects/project-form.tsx`
- Modify: `apps/desktop/src/web/api/transport.ts`
- Modify: `apps/desktop/src/web/api/client.ts`
- Modify: `apps/desktop/src/web/api/desktop-transport.ts`
- Modify: `apps/desktop/test/web/projects.test.tsx`
- Modify: `apps/desktop/test/web/transport.test.ts`

- [ ] **Step 1: Write project settings tests**

```ts
it("keeps Local as default and renders Git fields from its manifest", () => {
  render(<ProjectForm
    manifests={integrationManifests}
    workspaceProviders={[
      { id: "local", name: "本机目录", configFields: [] },
      { id: "git", name: "Git Worktree", configFields: [
        { key: "baseBranch", type: "string", label: "基线分支", required: true, defaultValue: "main" },
        { key: "delivery", type: "string", label: "交付方式", required: true, defaultValue: "local" },
        { key: "remote", type: "string", label: "远程仓库", required: false, defaultValue: "origin" },
      ] },
    ]}
    inspection={inspection}
    onSave={async () => undefined}
  />);
  expect(screen.getByRole("combobox", { name: "工作目录方式" })).toHaveTextContent("本机目录");
  fireEvent.click(screen.getByRole("tab", { name: "工作目录" }));
  selectOption("工作目录方式", "Git Worktree");
  expect(screen.getByLabelText("基线分支")).toHaveValue("main");
});
```

- [ ] **Step 2: Run UI tests and confirm failure**

Run:

```bash
pnpm --filter @oh-my-bug/desktop test -- test/web/projects.test.tsx test/web/transport.test.ts
```

Expected: FAIL because provider manifests and Workspace form data are not wired.

- [ ] **Step 3: Extract generic fields and add Workspace tab**

Move non-secret config rendering from `IntegrationFields` into `ConfigFields` with props:

```ts
interface ConfigFieldsProps {
  fields: ConfigField[];
  config: Record<string, ConfigValue>;
  onChange(key: string, value: ConfigValue): void;
}
```

Keep `IntegrationFields` responsible only for composing `ConfigFields` with secret fields. Add to `ProjectFormValue`:

```ts
workspace: {
  provider: string;
  config: Record<string, ConfigValue>;
};
```

Add one `工作目录` tab with a provider selector and the selected manifest's `ConfigFields`. Default new projects to Local. `createProjectPayload()` and `updateProjectPayload()` send Workspace configuration unchanged. Add `workspaceProviders()` to renderer transport and load it with integration manifests in `app.tsx`.

- [ ] **Step 4: Run project settings tests**

Run:

```bash
pnpm --filter @oh-my-bug/desktop typecheck
pnpm --filter @oh-my-bug/desktop test -- test/web/projects.test.tsx test/web/transport.test.ts
```

Expected: PASS; no Git-specific branch fields appear while Local is selected.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/web apps/desktop/test/web
git commit -m "feat(desktop): configure project workspace provider"
```

## Task 14: Reconcile restart, legacy Issues, and failed publication

**Files:**
- Modify: `apps/runtime/src/orchestration/recovery.ts`
- Modify: `apps/runtime/src/orchestration/workspace-coordinator.ts`
- Modify: `apps/runtime/src/runtime.ts`
- Modify: `packages/storage/src/sqlite/workspace-store.ts`
- Modify: `apps/runtime/test/recovery.test.ts`
- Modify: `apps/runtime/test/acceptance/restart-flow.test.ts`
- Create: `apps/runtime/test/acceptance/git-workspace-restart.test.ts`

- [ ] **Step 1: Write restart and migration tests**

```ts
it("reuses the persisted Git binding after project defaults change", async () => {
  const first = await createPersistentGitRuntime(fixture, { provider: "git", config: gitConfig });
  const created = await first.submitManual(project.id, manualInput);
  await first.drainOne();
  const path = first.getIssue(created.issue.id).projectPath;
  await first.stop();

  fixture.workspaceStore.setProjectConfiguration(project.id, { provider: "local", config: {} });
  const reopened = await reopenPersistentRuntime(fixture);
  expect(reopened.workspaceBinding(created.issue.id)?.providerId).toBe("git");
  expect(reopened.getIssue(created.issue.id).projectPath).toBe(path);
});

it("resumes APPROVED publication without rerunning Repair", async () => {
  const reopened = await reopenAfterPublishFailure(fixture);
  await reopened.approveDelivery(issue.id);
  expect(agent.repairInputs).toHaveLength(1);
  expect(reopened.getIssue(issue.id).status).toBe("COMPLETED");
});
```

- [ ] **Step 2: Run recovery tests and confirm failure**

Run:

```bash
pnpm --filter @oh-my-bug/runtime test -- test/recovery.test.ts test/acceptance/restart-flow.test.ts test/acceptance/git-workspace-restart.test.ts
```

Expected: FAIL because Workspace state is not reconciled on restart.

- [ ] **Step 3: Implement deterministic recovery**

Before normal interrupted-Agent reconciliation:

1. For legacy Issues without bindings, create a Local binding and assign the registered project's original path. Preserve their existing `ASSESS` or `REPAIR` operation.
2. For `RECEIVED` Issues without `projectPath`, queue `PREPARE` using their binding provider or the persisted project default.
3. For READY bindings whose Issue path is missing, restore the provider-owned path through idempotent `acquire()` and atomically queue the correct Agent operation.
4. For `APPROVED`, queue `FINALIZE`; persisted BranchInfo makes publish retry idempotent.
5. For Git bindings whose provider is unavailable, record `WORKSPACE_PROVIDER_NOT_AVAILABLE` and do not select Local.

Run module readiness before this reconciliation. Keep existing `ASSESSING`, `REPAIRING`, and `EVIDENCE_CHECK` interrupted-state behavior unchanged after Workspace repair.

- [ ] **Step 4: Run all recovery and acceptance tests**

Run:

```bash
pnpm --filter @oh-my-bug/runtime test -- test/recovery.test.ts test/acceptance
pnpm --filter @oh-my-bug/storage test -- test/sqlite/recovery-store.test.ts test/sqlite/workspace-store.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/runtime/src/orchestration apps/runtime/src/runtime.ts apps/runtime/test/recovery.test.ts apps/runtime/test/acceptance packages/storage/src/sqlite/workspace-store.ts packages/storage/test/sqlite
git commit -m "feat: recover workspace operations after restart"
```

## Task 15: Verify architecture boundaries and full product flow

**Files:**
- Modify: `packages/core/test/architecture-boundary.test.ts`
- Modify: `apps/desktop/test/architecture/runtime-boundary.test.ts`
- Modify: `apps/runtime/test/composition.test.ts`
- Modify: `apps/desktop/test/electron/e2e/manual-workflow.spec.ts`
- Create: `apps/desktop/test/electron/e2e/git-workspace.spec.ts`

- [ ] **Step 1: Add boundary and end-to-end assertions**

Boundary tests must assert:

```ts
expect(coreSources).not.toMatch(/cordis|WorkspaceProvider|GitWorkspace|worktree/i);
expect(nonCompositionRuntimeSources).not.toMatch(/workspace-local|workspace-git/);
expect(compositionSource).toContain("localWorkspaceFactory");
expect(compositionSource).toContain("gitWorkspaceFactory");
```

The Electron Git flow creates a temporary repository, configures Git Workspace, creates an Issue, completes the demo workflow, verifies no commit before delivery approval, approves it, and verifies the returned local branch survives while the worktree directory is removed.

- [ ] **Step 2: Run boundary and E2E tests**

Run:

```bash
pnpm --filter @oh-my-bug/core test -- test/architecture-boundary.test.ts
pnpm --filter @oh-my-bug/desktop test -- test/architecture/runtime-boundary.test.ts
pnpm test:e2e:electron -- apps/desktop/test/electron/e2e/git-workspace.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Run repository-wide verification**

Run:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build:desktop
```

Expected: all commands exit 0. Record any unrelated pre-existing failure separately; do not weaken or delete a test to obtain green output.

- [ ] **Step 4: Confirm excluded behavior stays absent**

Run:

```bash
rg -n "checkpoint commit|diff report|automatic test|git diff|pnpm test" packages/workspace-git apps/runtime/src/orchestration/workspace-coordinator.ts
```

Expected: no workflow implementation invokes diff collection, tests, or checkpoint commits. Test files and documentation strings may match; production publish code only stages, commits, optionally pushes, and removes the clean worktree.

- [ ] **Step 5: Commit final verification coverage**

```bash
git add packages/core/test/architecture-boundary.test.ts apps/desktop/test/architecture apps/runtime/test/composition.test.ts apps/desktop/test/electron/e2e
git commit -m "test: verify internal workspace module flow"
```
