# Issue Workspace Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show an Issue's persisted Git branch with a `Worktree` tag in the right metadata rail, while keeping the rail header sticky and expanded Agent commands full-width.

**Architecture:** Add an optional read-only `describe` capability to workspace providers, then expose the resulting binding metadata through a nullable Runtime protocol query. Reuse one Runtime helper for the live service and browser-development snapshot so Electron and localhost previews receive identical data; the React workbench fetches the selected Issue's workspace metadata independently of the core Issue model and hides the row when no branch is available.

**Tech Stack:** TypeScript 6, Vitest, Zod 4, React 19, Electron IPC, SQLite workspace persistence, CSS Grid.

---

## File map

- Modify `packages/module-api/src/workspace.ts`: define the provider-neutral workspace description contract.
- Modify `packages/workspace-git/src/provider.ts`: describe the branch stored for a Git workspace resource.
- Modify `packages/workspace-git/test/acquire.test.ts`: prove branch description survives provider reconstruction.
- Create `apps/runtime/src/workspaces/issue-workspace-info.ts`: centralize binding lookup, provider description, and graceful degradation.
- Create `apps/runtime/test/issue-workspace-info.test.ts`: cover binding/provider/branch/error cases without UI dependencies.
- Modify `apps/runtime/src/protocol/types.ts`: publish `IssueWorkspaceInfo` and the nullable `getIssueWorkspace` operation.
- Modify `apps/runtime/src/protocol/schema-definitions.ts`: validate the new output shape.
- Modify `apps/runtime/src/protocol/operations.ts`: register the renderer-visible query.
- Modify `apps/runtime/src/service.ts`: serve selected-Issue workspace metadata.
- Modify `apps/runtime/src/composition.ts`: include the same metadata in browser-development snapshots.
- Modify `apps/runtime/test/protocol/operations.test.ts`: lock operation order and schema behavior.
- Modify `apps/runtime/test/protocol/service.test.ts`: verify missing Issues still use the existing error and missing bindings return `null`.
- Modify `apps/runtime/test/composition.test.ts`: verify snapshot metadata is populated from persisted Git state.
- Modify `apps/desktop/src/electron/desktop-api.ts`: expose a named preload method for the query.
- Modify `apps/desktop/test/electron/desktop-api.test.ts`: lock the public method and IPC payload.
- Modify `apps/desktop/src/web/api/types.ts`: export the workspace DTO alias.
- Modify `apps/desktop/src/web/api/transport.ts`: add the renderer transport method.
- Modify `apps/desktop/src/web/api/desktop-transport.ts`: map the transport to the preload bridge.
- Modify `apps/desktop/src/web/api/browser-development-transport.ts`: serve workspace metadata from the snapshot.
- Modify `apps/desktop/src/web/api/client.ts`: make the unavailable transport type-complete.
- Modify `apps/desktop/test/web/transport.test.ts`: verify the Electron bridge mapping.
- Modify `apps/desktop/test/web/browser-development-client.test.ts`: verify the snapshot mapping and missing-entry behavior.
- Modify `apps/desktop/src/web/app.tsx`: load selected-Issue workspace metadata and conditionally render the branch row.
- Modify `apps/desktop/test/web/app-workbench.test.tsx`: verify branch/tag rendering and the no-branch omission rule.
- Modify `apps/desktop/src/web/styles/global.css`: make the rail header sticky, style the branch row, and expand command details.
- Modify `apps/desktop/test/web/project-settings-layout.test.ts`: add source-level CSS regression assertions for the sticky/full-width rules.

### Task 1: Provider description contract and Git implementation

**Files:**
- Modify: `packages/module-api/src/workspace.ts`
- Modify: `packages/workspace-git/src/provider.ts`
- Test: `packages/workspace-git/test/acquire.test.ts`

- [ ] **Step 1: Write the failing persistence-focused provider test**

Add this test to `packages/workspace-git/test/acquire.test.ts`:

```ts
it("describes the persisted Issue branch after provider reconstruction", async () => {
  const fixture = await createGitFixture();
  cleanups.push(fixture.cleanup);
  const factory = gitWorkspaceFactory({
    state: fixture.state,
    worktreeRoot: fixture.worktreeRoot,
  });
  const acquired = await factory.create({ baseBranch: "main", pushToRemote: false })
    .acquire({ issue: fixture.issue, project: fixture.project });

  const restored = factory.create({});

  await expect(restored.describe?.({
    issue: fixture.issue,
    resourceId: acquired.resourceId,
  })).resolves.toEqual({ branch: "ohmybug/omb-1" });
});
```

- [ ] **Step 2: Run the focused test and confirm the contract is missing**

Run:

```bash
pnpm --filter @oh-my-bug/workspace-git exec vitest run test/acquire.test.ts
```

Expected: FAIL because `WorkspaceProvider` and `GitWorkspaceProvider` do not expose `describe`.

- [ ] **Step 3: Add the provider-neutral description type and optional method**

Add to `packages/module-api/src/workspace.ts` immediately after `WorkspaceBinding`:

```ts
export interface WorkspaceDescription {
  branch?: string;
}
```

Add to `WorkspaceProvider` before `publish`:

```ts
describe?(input: {
  issue: Issue;
  resourceId: string;
}): Promise<WorkspaceDescription>;
```

- [ ] **Step 4: Read the Git branch from persisted provider state**

Add to `GitWorkspaceProvider` after `acquire` and before `publish`:

```ts
async describe(input: {
  issue: Issue;
  resourceId: string;
}): Promise<{ branch: string }> {
  const state = this.getSavedState(input.issue, input.resourceId);
  return { branch: state.branch };
}
```

This must call `getSavedState`; do not inspect the filesystem or run a Git command for a read-only UI query.

- [ ] **Step 5: Run provider tests and typecheck the two packages**

Run:

```bash
pnpm --filter @oh-my-bug/workspace-git exec vitest run test/acquire.test.ts
pnpm --filter @oh-my-bug/module-api --filter @oh-my-bug/workspace-git typecheck
```

Expected: both commands PASS.

- [ ] **Step 6: Commit the provider contract**

```bash
git add packages/module-api/src/workspace.ts packages/workspace-git/src/provider.ts packages/workspace-git/test/acquire.test.ts
git commit -m "feat: describe persisted issue workspaces"
```

### Task 2: Runtime workspace metadata reader and protocol query

**Files:**
- Create: `apps/runtime/src/workspaces/issue-workspace-info.ts`
- Create: `apps/runtime/test/issue-workspace-info.test.ts`
- Modify: `apps/runtime/src/protocol/types.ts`
- Modify: `apps/runtime/src/protocol/schema-definitions.ts`
- Modify: `apps/runtime/src/protocol/operations.ts`
- Modify: `apps/runtime/src/service.ts`
- Modify: `apps/runtime/test/protocol/operations.test.ts`
- Modify: `apps/runtime/test/protocol/service.test.ts`

- [ ] **Step 1: Write failing tests for binding lookup and graceful degradation**

Create `apps/runtime/test/issue-workspace-info.test.ts`:

```ts
import type { Issue } from "@oh-my-bug/core";
import type { WorkspacePersistence, WorkspaceProvider } from "@oh-my-bug/module-api";
import { describe, expect, it, vi } from "vitest";

import { readIssueWorkspaceInfo } from "../src/workspaces/issue-workspace-info.js";

const issue: Issue = {
  id: "issue-1",
  projectId: "project-1",
  identifier: "OMB-1",
  title: "Show the worktree branch",
  titleSource: "user",
  status: "REPAIRING",
  inputs: [],
  revision: 2,
  createdAt: "2026-08-22T08:00:00.000Z",
  updatedAt: "2026-08-22T08:01:00.000Z",
};

function persistence(binding = {
  issueId: issue.id,
  providerId: "git",
  resourceId: `git:${issue.id}`,
  status: "READY" as const,
  createdAt: issue.createdAt,
  updatedAt: issue.updatedAt,
}): WorkspacePersistence {
  return {
    transaction: (work) => work(),
    getProjectConfiguration: () => ({ provider: "git", config: { baseBranch: "main" } }),
    setProjectConfiguration: vi.fn(),
    getBinding: () => binding,
    recoverBinding: vi.fn(),
    beginAcquire: vi.fn(),
    completeAcquire: vi.fn() as never,
    failAcquire: vi.fn(),
    completeRelease: vi.fn() as never,
  };
}

describe("readIssueWorkspaceInfo", () => {
  it("returns a described branch from the persisted binding", async () => {
    const provider = {
      id: "git",
      acquire: vi.fn(),
      describe: vi.fn(async () => ({ branch: "ohmybug/omb-1" })),
      publish: vi.fn(),
      release: vi.fn(),
    } satisfies WorkspaceProvider;
    const registry = { create: vi.fn(() => provider) };

    await expect(readIssueWorkspaceInfo({
      issue,
      persistence: persistence(),
      registry,
    })).resolves.toEqual({
      providerId: "git",
      status: "READY",
      branch: "ohmybug/omb-1",
    });
    expect(registry.create).toHaveBeenCalledWith("git", { baseBranch: "main" });
  });

  it("returns null without a binding", async () => {
    const withoutBinding = { ...persistence(), getBinding: () => undefined };
    await expect(readIssueWorkspaceInfo({
      issue,
      persistence: withoutBinding,
      registry: { create: vi.fn() },
    })).resolves.toBeNull();
  });

  it("returns binding metadata without a branch for providers without describe", async () => {
    const localBinding = {
      issueId: issue.id,
      providerId: "local",
      resourceId: `local:${issue.id}`,
      status: "READY" as const,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
    };
    const localProvider = {
      id: "local",
      acquire: vi.fn(),
      publish: vi.fn(),
      release: vi.fn(),
    } satisfies WorkspaceProvider;

    await expect(readIssueWorkspaceInfo({
      issue,
      persistence: persistence(localBinding),
      registry: { create: vi.fn(() => localProvider) },
    })).resolves.toEqual({ providerId: "local", status: "READY" });
  });

  it("keeps binding metadata when provider description fails", async () => {
    const registry = { create: vi.fn(() => { throw new Error("PROVIDER_MISSING"); }) };
    await expect(readIssueWorkspaceInfo({
      issue,
      persistence: persistence(),
      registry,
    })).resolves.toEqual({ providerId: "git", status: "READY" });
  });
});
```

- [ ] **Step 2: Run the helper test and confirm the module is absent**

Run:

```bash
pnpm --filter @oh-my-bug/runtime exec vitest run test/issue-workspace-info.test.ts
```

Expected: FAIL with a missing `issue-workspace-info` module.

- [ ] **Step 3: Define the Runtime DTO and protocol method**

In `apps/runtime/src/protocol/types.ts`, import `WorkspaceBinding` from `@oh-my-bug/module-api` and add:

```ts
export interface IssueWorkspaceInfo {
  providerId: string;
  status: WorkspaceBinding["status"];
  branch?: string;
}
```

Add to `RuntimeApi` immediately after `getIssue`:

```ts
getIssueWorkspace(input: { id: string }): Promise<IssueWorkspaceInfo | null>;
```

- [ ] **Step 4: Implement the isolated reader**

Create `apps/runtime/src/workspaces/issue-workspace-info.ts`:

```ts
import type { Issue } from "@oh-my-bug/core";
import type { WorkspacePersistence } from "@oh-my-bug/module-api";

import type { WorkspaceRegistry } from "../modules/workspace-registry.js";
import type { IssueWorkspaceInfo } from "../protocol/types.js";

export async function readIssueWorkspaceInfo(input: {
  issue: Issue;
  persistence: WorkspacePersistence;
  registry: Pick<WorkspaceRegistry, "create">;
}): Promise<IssueWorkspaceInfo | null> {
  const binding = input.persistence.getBinding(input.issue.id);
  if (!binding) return null;

  const base: IssueWorkspaceInfo = {
    providerId: binding.providerId,
    status: binding.status,
  };
  try {
    const configured = input.persistence.getProjectConfiguration(input.issue.projectId);
    const config = configured?.provider === binding.providerId ? configured.config : {};
    const provider = input.registry.create(binding.providerId, config);
    const description = await provider.describe?.({
      issue: input.issue,
      resourceId: binding.resourceId,
    });
    return description?.branch ? { ...base, branch: description.branch } : base;
  } catch {
    return base;
  }
}
```

- [ ] **Step 5: Make the helper tests pass**

Run:

```bash
pnpm --filter @oh-my-bug/runtime exec vitest run test/issue-workspace-info.test.ts
```

Expected: PASS for described, absent, and unavailable-provider cases.

- [ ] **Step 6: Add the Zod output schema and registered operation**

In `apps/runtime/src/protocol/schema-definitions.ts`, add:

```ts
export const issueWorkspaceInfoSchema = z.object({
  providerId: identifierSchema,
  status: z.enum(["PREPARING", "READY", "FAILED", "RELEASED"]),
  branch: identifierSchema.optional(),
}).strict();
```

In `apps/runtime/src/protocol/operations.ts`, import `issueWorkspaceInfoSchema` and insert after `getIssue`:

```ts
getIssueWorkspace: operation({
  input: projectIdSchema,
  output: issueWorkspaceInfoSchema.nullable(),
  renderer: true,
  invoke: (service, input) => service.getIssueWorkspace(input),
}),
```

Update the ordered key assertion in `apps/runtime/test/protocol/operations.test.ts` by inserting `"getIssueWorkspace"` after `"getIssue"`, then add:

```ts
it("validates nullable Issue workspace metadata", () => {
  expect(runtimeOperations.getIssueWorkspace.output.parse({
    providerId: "git",
    status: "READY",
    branch: "ohmybug/omb-1",
  })).toEqual({
    providerId: "git",
    status: "READY",
    branch: "ohmybug/omb-1",
  });
  expect(runtimeOperations.getIssueWorkspace.output.parse(null)).toBeNull();
});
```

- [ ] **Step 7: Serve the query without weakening existing Issue errors**

Import `IssueWorkspaceInfo` and `readIssueWorkspaceInfo` in `apps/runtime/src/service.ts`, then add after `getIssue`:

```ts
async getIssueWorkspace(input: { id: string }): Promise<IssueWorkspaceInfo | null> {
  this.assertAccepting();
  const issue = this.dependencies.runtime.getIssue(input.id);
  return readIssueWorkspaceInfo({
    issue,
    persistence: this.dependencies.workspacePersistence,
    registry: this.dependencies.workspaceRegistry,
  });
}
```

Add to `apps/runtime/test/protocol/service.test.ts`:

```ts
it("returns null workspace metadata and preserves missing-Issue errors", async () => {
  const { root, service } = await harness();
  const projectDirectory = join(root, "workspace-metadata-project");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(projectDirectory));
  const project = await service.createProject({
    path: projectDirectory,
    key: "META",
  });
  const created = await service.submitManual({
    projectId: project.id,
    commandId: "manual-workspace-metadata",
    content: "Show workspace metadata",
  });

  await expect(service.getIssueWorkspace({ id: created.id })).resolves.toBeNull();
  await expect(service.getIssueWorkspace({ id: "missing-issue" }))
    .rejects.toThrow("ISSUE_NOT_FOUND");
});
```

- [ ] **Step 8: Run Runtime protocol tests and typecheck**

Run:

```bash
pnpm --filter @oh-my-bug/runtime exec vitest run test/issue-workspace-info.test.ts test/protocol/operations.test.ts test/protocol/service.test.ts
pnpm --filter @oh-my-bug/runtime typecheck
```

Expected: PASS with `getIssueWorkspace` included in the renderer operation registry.

- [ ] **Step 9: Commit the Runtime query**

```bash
git add apps/runtime/src/workspaces/issue-workspace-info.ts apps/runtime/test/issue-workspace-info.test.ts apps/runtime/src/protocol/types.ts apps/runtime/src/protocol/schema-definitions.ts apps/runtime/src/protocol/operations.ts apps/runtime/src/service.ts apps/runtime/test/protocol/operations.test.ts apps/runtime/test/protocol/service.test.ts
git commit -m "feat: expose issue workspace metadata"
```

### Task 3: Browser-development snapshot parity

**Files:**
- Modify: `apps/runtime/src/composition.ts`
- Test: `apps/runtime/test/composition.test.ts`

- [ ] **Step 1: Add a failing snapshot assertion**

In the existing `reads a browser-safe snapshot from the persisted desktop Runtime` test, persist a Git configuration, binding, and module state after inserting `issue`:

```ts
composition.workspacePersistence.setProjectConfiguration(issue.projectId, {
  provider: "git",
  config: { baseBranch: "main", pushToRemote: false },
});
composition.workspacePersistence.recoverBinding({
  issueId: issue.id,
  providerId: "git",
  resourceId: `git:${issue.id}`,
  status: "READY",
  createdAt: timestamp,
  updatedAt: timestamp,
});
composition.workspacePersistence.set("workspace-git", `git:${issue.id}`, {
  issueId: issue.id,
  repositoryPath: dataRoot,
  projectRelativePath: ".",
  worktreePath: join(dataRoot, "worktrees", issue.id),
  branch: "ohmybug/omb-1",
  baseBranch: "main",
  baseCommit: "abc123",
  pushToRemote: false,
});
```

Then extend the snapshot expectation:

```ts
expect(snapshot.issueWorkspaces).toMatchObject({
  [issue.id]: {
    providerId: "git",
    status: "READY",
    branch: `ohmybug/${issue.identifier.toLowerCase()}`,
  },
});
```

- [ ] **Step 2: Run the snapshot test and confirm the field is absent**

Run:

```bash
pnpm --filter @oh-my-bug/runtime exec vitest run test/composition.test.ts
```

Expected: FAIL because `DesktopRuntimeSnapshot` has no `issueWorkspaces` field.

- [ ] **Step 3: Add workspace metadata to both empty and populated snapshots**

In `apps/runtime/src/composition.ts`, import `IssueWorkspaceInfo` and `readIssueWorkspaceInfo`, then extend `DesktopRuntimeSnapshot`:

```ts
issueWorkspaces: Record<string, IssueWorkspaceInfo>;
```

Add this property to `empty()`:

```ts
issueWorkspaces: {},
```

Before returning the populated snapshot, compute:

```ts
const issueWorkspaces = Object.fromEntries((await Promise.all(issues.map(async (issue) => {
  const info = await readIssueWorkspaceInfo({
    issue,
    persistence: workspacePersistence,
    registry: workspaceRegistry,
  });
  return info ? [issue.id, info] as const : undefined;
}))).filter((entry): entry is readonly [string, IssueWorkspaceInfo] => Boolean(entry)));
```

Then add `issueWorkspaces` to the returned snapshot object.

- [ ] **Step 4: Run the snapshot test and Runtime typecheck**

Run:

```bash
pnpm --filter @oh-my-bug/runtime exec vitest run test/composition.test.ts
pnpm --filter @oh-my-bug/runtime typecheck
```

Expected: PASS; missing bindings are omitted, while persisted Git state yields a branch.

- [ ] **Step 5: Commit snapshot parity**

```bash
git add apps/runtime/src/composition.ts apps/runtime/test/composition.test.ts
git commit -m "feat: include workspaces in browser snapshot"
```

### Task 4: Desktop bridge and renderer transports

**Files:**
- Modify: `apps/desktop/src/electron/desktop-api.ts`
- Modify: `apps/desktop/test/electron/desktop-api.test.ts`
- Modify: `apps/desktop/src/web/api/types.ts`
- Modify: `apps/desktop/src/web/api/transport.ts`
- Modify: `apps/desktop/src/web/api/desktop-transport.ts`
- Modify: `apps/desktop/src/web/api/browser-development-transport.ts`
- Modify: `apps/desktop/src/web/api/client.ts`
- Modify: `apps/desktop/test/web/transport.test.ts`
- Modify: `apps/desktop/test/web/browser-development-client.test.ts`

- [ ] **Step 1: Write failing Electron and browser transport expectations**

In `apps/desktop/test/electron/desktop-api.test.ts`, add `"getIssueWorkspace"` to the frozen method list and extend the IPC mapping test:

```ts
await api.getIssueWorkspace("issue-1");
expect(ipc.invoke).toHaveBeenNthCalledWith(4, "oh-my-bug:request", {
  operation: "getIssueWorkspace",
  payload: { id: "issue-1" },
});
```

In `apps/desktop/test/web/transport.test.ts`, add to the bridge fixture:

```ts
getIssueWorkspace: vi.fn(async () => ({
  providerId: "git",
  status: "READY",
  branch: "ohmybug/chk-1",
})),
```

and assert:

```ts
await expect(transport.issueWorkspace("issue-1")).resolves.toEqual({
  providerId: "git",
  status: "READY",
  branch: "ohmybug/chk-1",
});
expect(bridge.getIssueWorkspace).toHaveBeenCalledWith("issue-1");
```

In `apps/desktop/test/web/browser-development-client.test.ts`, add to the populated snapshot:

```ts
issueWorkspaces: {
  "issue-1": {
    providerId: "git",
    status: "READY",
    branch: "ohmybug/omb-1",
  },
},
```

Extend the local transport type with `issueWorkspace(id: string): Promise<unknown>` and assert:

```ts
expect(await transport?.issueWorkspace("issue-1")).toEqual(
  snapshot.issueWorkspaces["issue-1"],
);
expect(await transport?.issueWorkspace("missing-issue")).toBeNull();
```

- [ ] **Step 2: Run the focused tests and confirm methods are missing**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run test/electron/desktop-api.test.ts test/web/transport.test.ts test/web/browser-development-client.test.ts
```

Expected: FAIL because neither bridge nor transport exposes workspace metadata.

- [ ] **Step 3: Add the named Electron preload operation**

In `DesktopApi` within `apps/desktop/src/electron/desktop-api.ts`, add after `getIssue`:

```ts
getIssueWorkspace(id: string): Promise<RuntimeOperationOutput<"getIssueWorkspace">>;
```

In `createDesktopApi`, add after `getIssue`:

```ts
getIssueWorkspace: (id) => request("getIssueWorkspace", { id }),
```

- [ ] **Step 4: Add the renderer DTO and transport method**

In `apps/desktop/src/web/api/types.ts`, add:

```ts
export type IssueWorkspaceInfoDto = RuntimeOperationOutput<"getIssueWorkspace">;
```

In `ProductTransport` within `apps/desktop/src/web/api/transport.ts`, import that type and add after `issue`:

```ts
issueWorkspace(id: string): Promise<IssueWorkspaceInfoDto>;
```

In `apps/desktop/src/web/api/desktop-transport.ts`, add after `issue`:

```ts
issueWorkspace: (id) => bridge.getIssueWorkspace(id),
```

In `apps/desktop/src/web/api/client.ts`, add to `unavailableTransport`:

```ts
issueWorkspace: unavailable,
```

- [ ] **Step 5: Serve browser-preview metadata from the single cached snapshot**

In `apps/desktop/src/web/api/browser-development-transport.ts`, import `IssueWorkspaceInfoDto`, extend `DevelopmentSnapshot`, and add the transport method:

```ts
export interface DevelopmentSnapshot {
  integrationPlugins: IntegrationPluginManifest[];
  workspaceProviders?: WorkspaceProviderManifest[];
  projectInspections?: Record<string, ProjectInspection>;
  projects: ProjectDto[];
  issues: IssueDto[];
  issueWorkspaces?: Record<string, Exclude<IssueWorkspaceInfoDto, null>>;
  issueEvents: Record<string, AgentEventDto[]>;
  integrationHealth: Record<string, IntegrationHealth>;
}
```

```ts
issueWorkspace: async (id) => (await snapshot()).issueWorkspaces?.[id] ?? null,
```

- [ ] **Step 6: Run desktop transport tests and typecheck**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run test/electron/desktop-api.test.ts test/web/transport.test.ts test/web/browser-development-client.test.ts
pnpm --filter @oh-my-bug/desktop typecheck
```

Expected: PASS, with the snapshot still fetched only once.

- [ ] **Step 7: Commit the transport path**

```bash
git add apps/desktop/src/electron/desktop-api.ts apps/desktop/test/electron/desktop-api.test.ts apps/desktop/src/web/api/types.ts apps/desktop/src/web/api/transport.ts apps/desktop/src/web/api/desktop-transport.ts apps/desktop/src/web/api/browser-development-transport.ts apps/desktop/src/web/api/client.ts apps/desktop/test/web/transport.test.ts apps/desktop/test/web/browser-development-client.test.ts
git commit -m "feat: bridge issue workspace metadata"
```

### Task 5: Conditional branch row in the Issue metadata rail

**Files:**
- Modify: `apps/desktop/src/web/app.tsx`
- Test: `apps/desktop/test/web/app-workbench.test.tsx`

- [ ] **Step 1: Write the failing branch/tag and omission tests**

Add this test to `apps/desktop/test/web/app-workbench.test.tsx`:

```ts
it("shows a persisted branch with a Worktree tag and hides the row without a branch", async () => {
  vi.spyOn(api, "integrationPlugins").mockResolvedValue([]);
  vi.spyOn(api, "workspaceProviders").mockResolvedValue([]);
  vi.spyOn(api, "projects").mockResolvedValue([project]);
  vi.spyOn(api, "issues").mockResolvedValue([issue]);
  vi.spyOn(api, "issue").mockResolvedValue(issue);
  vi.spyOn(api, "integrationHealth").mockResolvedValue({});
  vi.spyOn(api, "subscribeIssueEvents").mockReturnValue(() => undefined);
  const workspace = vi.spyOn(api, "issueWorkspace").mockResolvedValue({
    providerId: "git",
    status: "READY",
    branch: "ohmybug/chk-1",
  });

  const view = render(<App />);

  const rail = await screen.findByTestId("issue-metadata-rail");
  expect(await within(rail).findByText("ohmybug/chk-1")).toBeVisible();
  expect(within(rail).getByText("Worktree")).toBeVisible();
  expect(workspace).toHaveBeenCalledWith(issue.id);

  workspace.mockResolvedValue(null);
  view.unmount();
  render(<App />);
  const railWithoutBranch = await screen.findByTestId("issue-metadata-rail");
  await waitFor(() => expect(workspace).toHaveBeenCalledTimes(2));
  expect(within(railWithoutBranch).queryByText("分支")).not.toBeInTheDocument();
  expect(within(railWithoutBranch).queryByText("Worktree")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the workbench test and confirm the query/rendering is absent**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run test/web/app-workbench.test.tsx
```

Expected: FAIL because `IssueWorkspace` does not request or render workspace metadata.

- [ ] **Step 3: Load metadata whenever the selected Issue or revision changes**

Import `IssueWorkspaceInfoDto` into `apps/desktop/src/web/app.tsx`. In `IssueWorkspace`, add:

```ts
const [workspaceInfo, setWorkspaceInfo] = useState<IssueWorkspaceInfoDto>(null);

useEffect(() => {
  let active = true;
  setWorkspaceInfo(null);
  if (!selected) return () => { active = false; };
  void api.issueWorkspace(selected.id).then((info) => {
    if (active) setWorkspaceInfo(info);
  }).catch(() => {
    if (active) setWorkspaceInfo(null);
  });
  return () => { active = false; };
}, [selected?.id, selected?.revision]);
```

Pass the value to the rail:

```tsx
<IssueMetadataRail
  active={active}
  events={events}
  issue={selected}
  project={selectedProject}
  workspace={workspaceInfo}
  onClose={() => setMetadataOpen(false)}
/>
```

- [ ] **Step 4: Render only a real branch and label Git worktrees**

Extend `IssueMetadataRail` props:

```ts
workspace: IssueWorkspaceInfoDto;
```

Insert immediately after the Project row:

```tsx
{workspace?.branch ? <div className="issue-workspace-row">
  <dt>分支</dt>
  <dd>
    <code title={workspace.branch}>{workspace.branch}</code>
    {workspace.providerId === "git"
      ? <span className="workspace-kind-tag">Worktree</span>
      : null}
  </dd>
</div> : null}
```

Do not render a placeholder when the query returns `null`, the provider fails, or `branch` is absent.

- [ ] **Step 5: Run the workbench test and desktop typecheck**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run test/web/app-workbench.test.tsx
pnpm --filter @oh-my-bug/desktop typecheck
```

Expected: PASS; the branch and tag are present only for a described Git workspace.

- [ ] **Step 6: Commit the UI behavior**

```bash
git add apps/desktop/src/web/app.tsx apps/desktop/test/web/app-workbench.test.tsx
git commit -m "feat: show issue worktree branch"
```

### Task 6: Sticky metadata header and full-width command details

**Files:**
- Modify: `apps/desktop/src/web/styles/global.css`
- Modify: `apps/desktop/test/web/project-settings-layout.test.ts`
- Test: `apps/desktop/test/web/agent-activity.test.tsx`

- [ ] **Step 1: Add failing CSS contract assertions**

In `apps/desktop/test/web/project-settings-layout.test.ts`, move the loaded CSS into module scope and add a dedicated contract test:

```ts
let styles = "";

beforeAll(async () => {
  styles = await readFile(resolve(process.cwd(), "src/web/styles/global.css"), "utf8");
  document.head.innerHTML = `<style>${styles}</style>`;
  document.body.style.setProperty("--surface", "rgb(24, 25, 28)");
  document.body.innerHTML = `
    <section class="page-scroll">
      <div class="settings-column">
        <div class="project-settings-tabs"></div>
      </div>
    </section>
  `;
});

it("locks sticky metadata and full-width activity detail rules", () => {
  expect(styles).toMatch(/\.metadata-rail-header\s*\{[^}]*position:\s*sticky;/s);
  expect(styles).toMatch(/\.metadata-rail-header\s*\{[^}]*top:\s*0;/s);
  expect(styles).toMatch(/\.activity-event\s*\{[^}]*width:\s*100%;/s);
  expect(styles).toMatch(/\.activity-detail\s*\{[^}]*width:\s*100%;/s);
  expect(styles).toMatch(/\.activity-detail pre\s*\{[^}]*box-sizing:\s*border-box;/s);
  expect(styles).toMatch(/\.activity-detail pre\s*\{[^}]*width:\s*100%;/s);
});
```

- [ ] **Step 2: Run the CSS regression test and confirm the properties are absent**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run test/web/project-settings-layout.test.ts
```

Expected: FAIL on the sticky and width assertions.

- [ ] **Step 3: Make the metadata header sticky and opaque**

Add these declarations to `.metadata-rail-header` in `apps/desktop/src/web/styles/global.css`:

```css
position: sticky;
z-index: 2;
top: 0;
background: var(--sidebar);
```

- [ ] **Step 4: Style the branch value for a narrow rail**

Add after the existing `.issue-metadata-list` rules:

```css
.issue-workspace-row dd {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
}

.issue-workspace-row code {
  min-width: 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-kind-tag {
  flex: 0 0 auto;
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  padding: 2px 6px;
  color: var(--text-muted);
  font-size: 9px;
  line-height: 1;
}
```

- [ ] **Step 5: Make expanded Agent details occupy the full content column**

Update the existing selectors:

```css
.activity-event {
  width: 100%;
  min-width: 0;
}

.activity-detail {
  width: 100%;
  min-width: 0;
  margin-top: 5px;
}

.activity-detail pre {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  overflow: auto;
  max-height: 160px;
  margin: 6px 0 0;
  border-radius: 4px;
  background: var(--surface-raised);
  padding: 7px 8px;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
```

- [ ] **Step 6: Run CSS and Agent activity component tests**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run test/web/project-settings-layout.test.ts test/web/agent-activity.test.tsx
```

Expected: PASS; activity markup behavior remains unchanged while the CSS contract is locked.

- [ ] **Step 7: Commit the layout fixes**

```bash
git add apps/desktop/src/web/styles/global.css apps/desktop/test/web/project-settings-layout.test.ts
git commit -m "fix: stabilize issue metadata layout"
```

### Task 7: End-to-end verification

**Files:**
- Verify: all files changed in Tasks 1-6

- [ ] **Step 1: Run the complete repository verification suite**

Run:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build:web
```

Expected: all commands exit 0 with no new warnings attributable to this change.

- [ ] **Step 2: Start the browser preview for deterministic UI inspection**

Run in a persistent terminal:

```bash
pnpm dev:web
```

Expected: Vite serves `http://localhost:5173/issues` and the development snapshot loads.

- [ ] **Step 3: Verify the requested 787×756 behavior in the in-app browser**

At a 787×756 viewport:

1. Open an Issue with persisted Git workspace metadata and confirm the right rail shows `分支`, the exact branch name, and a `Worktree` tag.
2. Open an Issue without a branch and confirm the entire `分支` row is absent.
3. Scroll the right rail and confirm `详情` remains pinned to the rail top with an opaque background and bottom divider.
4. Expand an Agent command detail and confirm the command box fills the event content column without horizontal overflow.
5. Confirm the browser console contains no new errors.

- [ ] **Step 4: Record final repository state**

Run:

```bash
git status --short
git log -7 --oneline
```

Expected: no unintended files are modified; the implementation is represented by the focused commits from Tasks 1-6.
