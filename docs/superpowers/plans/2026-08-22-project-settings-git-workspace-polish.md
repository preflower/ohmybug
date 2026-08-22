# Project Settings and Git Workspace Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a unified project-settings save area, a searchable local/remote Git base-branch picker with on-open Fetch and repository-aware validation, aligned path controls, a clear remote-publication switch, and a consistent Issue failure banner.

**Architecture:** Keep Git discovery, Fetch, and ref validation inside `workspace-git`; expose optional project-aware branch capabilities through `module-api`, `WorkspaceRegistry`, typed Runtime operations, and desktop transports. Keep the branch Combobox pure and renderer-owned, with `ProjectForm` receiving an async refresh callback rather than shelling out or importing Runtime internals.

**Tech Stack:** TypeScript 6, React 19, Base UI Combobox and Switch, Zod Runtime protocol schemas, Vitest, Testing Library, Electron IPC, Git CLI.

---

## File map

- `packages/module-api/src/workspace.ts`: provider-neutral branch discovery DTOs and optional project-aware provider methods.
- `packages/workspace-git/src/provider.ts`: effective-remote resolution, local/cached branch listing, on-demand Fetch, and base-ref validation.
- `apps/runtime/src/modules/workspace-registry.ts`: capability delegation and schema-plus-repository validation.
- `apps/runtime/src/service.ts`: Runtime branch operation and awaited validation before project persistence.
- `apps/runtime/src/protocol/{schema-definitions,operations,types}.ts`: typed renderer-facing branch operation.
- `apps/desktop/src/electron/desktop-api.ts`: fixed preload bridge method.
- `apps/desktop/src/web/api/{transport,desktop-transport,browser-development-transport,client,types}.ts`: renderer transport surface.
- `apps/desktop/src/web/components/ui/{switch,combobox}.tsx`: reusable Base UI wrappers matching the existing control vocabulary.
- `apps/desktop/src/web/projects/{git-workspace-fields,project-form}.tsx`: Git-specific project fields and form integration.
- `apps/desktop/src/web/app.tsx`: remove duplicate header actions and bind branch refresh into `ProjectForm`.
- `apps/desktop/src/web/issues/issue-detail.tsx`: reuse the existing Codex failure banner.
- `apps/desktop/src/web/styles/global.css`: path alignment, footer refinement, Git field layout, and long-ref behavior.

### Task 1: Define project-aware workspace branch contracts

**Files:**
- Modify: `packages/module-api/src/workspace.ts`
- Modify: `packages/module-api/test/contracts.test.ts`

- [ ] **Step 1: Write the failing contract test**

Add this test beside the existing inspection contract test:

```ts
it("allows providers to discover and validate project branch refs", async () => {
  const factory: WorkspaceProviderFactory = {
    id: "fixture",
    manifest: { id: "fixture", name: "Fixture", configFields: [] },
    validate() {},
    create: () => ({
      id: "fixture",
      acquire: async () => ({ projectPath: "/repo", resourceId: "fixture:1" }),
      publish: async () => undefined,
      release: async () => undefined,
    }),
    inspectProjectBranches: async (_path, input) => ({
      localBranches: ["main"],
      remoteBranches: input.refreshRemote ? ["origin/main"] : [],
      remote: { name: "origin", url: "git@example.com:team/repo.git" },
    }),
    validateProjectConfiguration: async () => undefined,
  };

  await expect(factory.inspectProjectBranches?.("/repo", { refreshRemote: true }))
    .resolves.toEqual({
      localBranches: ["main"],
      remoteBranches: ["origin/main"],
      remote: { name: "origin", url: "git@example.com:team/repo.git" },
    });
  await expect(factory.validateProjectConfiguration?.("/repo", {})).resolves.toBeUndefined();
});
```

- [ ] **Step 2: Run the contract test and verify RED**

Run: `pnpm --filter @oh-my-bug/module-api test -- contracts.test.ts`

Expected: TypeScript transform fails because `inspectProjectBranches` and `validateProjectConfiguration` are not members of `WorkspaceProviderFactory`.

- [ ] **Step 3: Add the provider-neutral DTOs and optional methods**

Add to `workspace.ts`:

```ts
export interface WorkspaceRemoteDescription {
  name: string;
  url: string;
}

export interface WorkspaceBranchDiscovery {
  localBranches: string[];
  remoteBranches: string[];
  remote?: WorkspaceRemoteDescription;
  remoteUnavailableReason?: string;
  refreshError?: string;
}
```

Extend `WorkspaceProviderInspection` and `WorkspaceProviderFactory`:

```ts
export interface WorkspaceProviderInspection {
  available: boolean;
  reason?: string;
  configPatch?: Record<string, ConfigValue>;
  fields?: Record<string, WorkspaceInspectionFieldState>;
  properties?: WorkspaceInspectionProperty[];
  branches?: WorkspaceBranchDiscovery;
}

export interface WorkspaceProviderFactory {
  readonly id: string;
  readonly manifest: WorkspaceProviderManifest;
  validate(config: Record<string, ConfigValue>): void;
  validateProjectConfiguration?(
    projectPath: string,
    config: Record<string, ConfigValue>,
  ): Promise<void>;
  inspectProjectBranches?(
    projectPath: string,
    input: { refreshRemote: boolean },
  ): Promise<WorkspaceBranchDiscovery>;
  create(config: Record<string, ConfigValue>): WorkspaceProvider;
  inspectProject?(projectPath: string): Promise<WorkspaceProviderInspection>;
}
```

- [ ] **Step 4: Run module-api tests and typecheck**

Run: `pnpm --filter @oh-my-bug/module-api test && pnpm --filter @oh-my-bug/module-api typecheck`

Expected: all module-api tests and TypeScript checks pass.

- [ ] **Step 5: Commit the contract**

```bash
git add packages/module-api/src/workspace.ts packages/module-api/test/contracts.test.ts
git commit -m "feat(workspace): define project branch discovery"
```

### Task 2: Implement Git branch discovery, Fetch, and validation

**Files:**
- Modify: `packages/workspace-git/src/provider.ts`
- Modify: `packages/workspace-git/test/inspection.test.ts`

- [ ] **Step 1: Write failing Git provider tests**

Add tests covering the public capability rather than private helpers:

```ts
it("lists local refs immediately and appends fetched remote refs", async () => {
  const value = await fixture();
  const bare = join(value.root, "origin.git");
  await git(value.root, "init", "--bare", bare);
  await git(value.repository, "remote", "add", "origin", bare);
  await git(value.repository, "push", "origin", "main:main", "main:release");

  const factory = gitWorkspaceFactory({ state: value.state, worktreeRoot: value.worktreeRoot });

  await expect(factory.inspectProjectBranches?.(value.repository, { refreshRemote: false }))
    .resolves.toMatchObject({
      localBranches: ["main"],
      remote: { name: "origin", url: bare },
    });
  await expect(factory.inspectProjectBranches?.(value.repository, { refreshRemote: true }))
    .resolves.toMatchObject({
      localBranches: ["main"],
      remoteBranches: ["origin/main", "origin/release"],
      remote: { name: "origin", url: bare },
    });
});

it("keeps local refs and reports a failed Fetch", async () => {
  const value = await fixture();
  await git(value.repository, "remote", "add", "origin", join(value.root, "missing.git"));
  const factory = gitWorkspaceFactory({ state: value.state, worktreeRoot: value.worktreeRoot });

  await expect(factory.inspectProjectBranches?.(value.repository, { refreshRemote: true }))
    .resolves.toMatchObject({
      localBranches: ["main"],
      remoteBranches: [],
      refreshError: "GIT_COMMAND_FAILED:fetch",
    });
});

it("validates local and remote-tracking base refs before save", async () => {
  const value = await fixture();
  const factory = gitWorkspaceFactory({ state: value.state, worktreeRoot: value.worktreeRoot });

  await expect(factory.validateProjectConfiguration?.(value.repository, {
    baseBranch: "main", pushToRemote: false,
  })).resolves.toBeUndefined();
  await expect(factory.validateProjectConfiguration?.(value.repository, {
    baseBranch: "missing", pushToRemote: false,
  })).rejects.toThrow("GIT_COMMAND_FAILED:rev-parse");
});
```

Also extend the existing no-remote inspection assertion with:

```ts
branches: {
  localBranches: ["main"],
  remoteBranches: [],
  remoteUnavailableReason: "当前 Git 仓库未配置远程仓库",
},
```

- [ ] **Step 2: Run the Git inspection test and verify RED**

Run: `pnpm --filter @oh-my-bug/workspace-git test -- inspection.test.ts`

Expected: tests fail because the new factory methods and `branches` inspection data are absent.

- [ ] **Step 3: Extract effective-remote and ref-listing helpers**

In `provider.ts`, add:

```ts
interface GitProjectContext {
  repositoryPath: string;
  remote?: { name: string; url: string };
  remoteUnavailableReason?: string;
}

async function readGitProjectContext(projectPath: string): Promise<GitProjectContext | undefined> {
  const repositoryPath = await tryRunGit(projectPath, ["rev-parse", "--show-toplevel"], [128]);
  if (!repositoryPath) return undefined;
  const remotes = (await runGit(repositoryPath, ["remote"]))
    .split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  const branch = await runGit(repositoryPath, ["branch", "--show-current"]);
  const tracked = branch
    ? await tryRunGit(repositoryPath, ["config", "--get", `branch.${branch}.remote`])
    : undefined;
  const name = tracked && tracked !== "." && remotes.includes(tracked)
    ? tracked
    : remotes.includes("origin")
      ? "origin"
      : remotes.length === 1 ? remotes[0] : undefined;
  if (!name) {
    return {
      repositoryPath,
      remoteUnavailableReason: remotes.length === 0
        ? "当前 Git 仓库未配置远程仓库"
        : "当前 Git 仓库有多个远程仓库，且未配置默认上游",
    };
  }
  return {
    repositoryPath,
    remote: { name, url: await runGit(repositoryPath, ["remote", "get-url", name]) },
  };
}

async function listRefs(repositoryPath: string, prefix: string): Promise<string[]> {
  const output = await runGit(repositoryPath, [
    "for-each-ref", "--format=%(refname:short)", prefix,
  ]);
  return output.split(/\r?\n/).map((value) => value.trim()).filter(Boolean).sort();
}
```

- [ ] **Step 4: Implement branch discovery and project validation**

Add these factory methods and reuse them from `inspectProject`:

```ts
async inspectProjectBranches(projectPath, input) {
  const context = await readGitProjectContext(projectPath);
  if (!context) throw new Error("WORKSPACE_GIT_NOT_AVAILABLE");
  const localBranches = await listRefs(context.repositoryPath, "refs/heads");
  let refreshError: string | undefined;
  if (input.refreshRemote && context.remote) {
    try {
      await runGit(context.repositoryPath, ["fetch", "--prune", context.remote.name]);
    } catch (error) {
      refreshError = error instanceof Error ? error.message : "GIT_COMMAND_FAILED:fetch";
    }
  }
  const remoteBranches = context.remote
    ? (await listRefs(context.repositoryPath, `refs/remotes/${context.remote.name}`))
        .filter((ref) => ref !== `${context.remote!.name}/HEAD`)
    : [];
  return {
    localBranches,
    remoteBranches,
    ...(context.remote ? { remote: context.remote } : {}),
    ...(context.remoteUnavailableReason
      ? { remoteUnavailableReason: context.remoteUnavailableReason }
      : {}),
    ...(refreshError ? { refreshError } : {}),
  };
},
async validateProjectConfiguration(projectPath, config) {
  const parsed = parseConfiguration(config);
  const repositoryPath = await runGit(projectPath, ["rev-parse", "--show-toplevel"]);
  await runGit(repositoryPath, [
    "rev-parse", "--verify", "--end-of-options", `${parsed.baseBranch}^{commit}`,
  ]);
},
```

Update `inspectGitProject` to call `readGitProjectContext` and the non-refreshing branch method so the returned inspection includes `branches` without network access.

- [ ] **Step 5: Run all workspace-git tests and typecheck**

Run: `pnpm --filter @oh-my-bug/workspace-git test && pnpm --filter @oh-my-bug/workspace-git typecheck`

Expected: all Git Workspace tests and type checks pass.

- [ ] **Step 6: Commit the Git behavior**

```bash
git add packages/workspace-git/src/provider.ts packages/workspace-git/test/inspection.test.ts
git commit -m "feat(git): discover and validate base branches"
```

### Task 3: Expose branch refresh and validation through Runtime

**Files:**
- Modify: `apps/runtime/src/modules/workspace-registry.ts`
- Modify: `apps/runtime/src/service.ts`
- Modify: `apps/runtime/src/protocol/schema-definitions.ts`
- Modify: `apps/runtime/src/protocol/operations.ts`
- Modify: `apps/runtime/src/protocol/types.ts`
- Modify: `apps/runtime/test/protocol/operations.test.ts`
- Modify: `apps/runtime/test/protocol/service.test.ts`

- [ ] **Step 1: Write failing protocol and service tests**

Add to `operations.test.ts`:

```ts
it("validates grouped project branch discovery", () => {
  const input = { path: "/repo", providerId: "git", refreshRemote: true };
  const output = {
    localBranches: ["main"],
    remoteBranches: ["origin/main"],
    remote: { name: "origin", url: "git@example.com:team/repo.git" },
  };
  expect(runtimeOperations.inspectProjectBranches.input.parse(input)).toEqual(input);
  expect(runtimeOperations.inspectProjectBranches.output.parse(output)).toEqual(output);
});
```

Also insert `"inspectProjectBranches"` immediately after `"inspectProject"` in the existing exact `Object.keys(runtimeOperations)` expectation.

Add a fixture factory to `service.test.ts` and register it in the harness for this test:

```ts
const branchFactory: WorkspaceProviderFactory = {
  id: "branches",
  manifest: { id: "branches", name: "Branches", configFields: [] },
  validate() {},
  validateProjectConfiguration: async (path, config) => {
    if (path.endsWith("invalid") || config.baseBranch === "missing") {
      throw new Error("BASE_BRANCH_NOT_FOUND");
    }
  },
  inspectProjectBranches: async () => ({
    localBranches: ["main"], remoteBranches: ["origin/main"],
  }),
  create: () => ({
    id: "branches",
    acquire: async () => ({ projectPath: "/repo", resourceId: "branches:1" }),
    publish: async () => undefined,
    release: async () => undefined,
  }),
};
```

Assert:

```ts
await expect(service.inspectProjectBranches({
  path: projectDirectory,
  providerId: "branches",
  refreshRemote: true,
})).resolves.toEqual({
  localBranches: ["main"], remoteBranches: ["origin/main"],
});

await expect(service.createProject({
  path: projectDirectory,
  key: "BAD",
  workspace: { provider: "branches", config: { baseBranch: "missing" } },
})).rejects.toThrow("BASE_BRANCH_NOT_FOUND");
```

- [ ] **Step 2: Run Runtime tests and verify RED**

Run: `pnpm --filter @oh-my-bug/runtime test -- operations.test.ts service.test.ts`

Expected: failures report the missing `inspectProjectBranches` operation and service method.

- [ ] **Step 3: Add Zod schemas and the renderer operation**

Add to `schema-definitions.ts`:

```ts
export const workspaceRemoteDescriptionSchema = z.object({
  name: identifierSchema,
  url: z.string().min(1),
}).strict();

export const workspaceBranchDiscoverySchema = z.object({
  localBranches: z.array(z.string().min(1)),
  remoteBranches: z.array(z.string().min(1)),
  remote: workspaceRemoteDescriptionSchema.optional(),
  remoteUnavailableReason: z.string().min(1).optional(),
  refreshError: z.string().min(1).optional(),
}).strict();
```

Add `branches: workspaceBranchDiscoverySchema.optional()` to `workspaceProviderInspectionSchema` and add to `runtimeOperations` immediately after `inspectProject`:

```ts
inspectProjectBranches: operation({
  input: z.object({
    path: identifierSchema,
    providerId: identifierSchema,
    refreshRemote: z.boolean(),
  }).strict(),
  output: workspaceBranchDiscoverySchema,
  renderer: true,
  invoke: (service, input) => service.inspectProjectBranches(input),
}),
```

Add the matching method to `RuntimeApi` in `protocol/types.ts`.

- [ ] **Step 4: Add Registry delegation and awaited validation**

Add to `WorkspaceRegistry`:

```ts
async inspectProjectBranches(
  id: string,
  path: string,
  input: { refreshRemote: boolean },
): Promise<WorkspaceBranchDiscovery> {
  const factory = this.require(id);
  if (!factory.inspectProjectBranches) {
    throw new Error(`WORKSPACE_BRANCH_DISCOVERY_NOT_AVAILABLE:${id}`);
  }
  return structuredClone(await factory.inspectProjectBranches(path, input));
}

async validateProject(
  id: string,
  path: string,
  config: Record<string, ConfigValue>,
): Promise<void> {
  const factory = this.require(id);
  factory.validate(structuredClone(config));
  await factory.validateProjectConfiguration?.(path, structuredClone(config));
}
```

Add to `RuntimeService`:

```ts
async inspectProjectBranches(input: {
  path: string;
  providerId: string;
  refreshRemote: boolean;
}): Promise<WorkspaceBranchDiscovery> {
  this.assertAccepting();
  const path = await canonicalDirectory(input.path);
  return this.dependencies.workspaceRegistry.inspectProjectBranches(
    input.providerId, path, { refreshRemote: input.refreshRemote },
  );
}
```

Replace the synchronous workspace validation calls in both `createProject` and `updateProject` with:

```ts
await this.dependencies.workspaceRegistry.validateProject(
  selectedWorkspace.provider,
  path,
  selectedWorkspace.config,
);
```

For create, name the cloned configuration `selectedWorkspace` before the call so create and update use the same variable names.

- [ ] **Step 5: Run Runtime tests and typecheck**

Run: `pnpm --filter @oh-my-bug/runtime test && pnpm --filter @oh-my-bug/runtime typecheck`

Expected: all Runtime tests and type checks pass.

- [ ] **Step 6: Commit Runtime exposure**

```bash
git add apps/runtime/src/modules/workspace-registry.ts apps/runtime/src/service.ts apps/runtime/src/protocol apps/runtime/test/protocol
git commit -m "feat(runtime): expose project branch inspection"
```

### Task 4: Bridge branch discovery into desktop and browser preview

**Files:**
- Modify: `apps/desktop/src/electron/desktop-api.ts`
- Modify: `apps/desktop/src/web/api/types.ts`
- Modify: `apps/desktop/src/web/api/transport.ts`
- Modify: `apps/desktop/src/web/api/desktop-transport.ts`
- Modify: `apps/desktop/src/web/api/browser-development-transport.ts`
- Modify: `apps/desktop/src/web/api/client.ts`
- Modify: `apps/desktop/test/electron/desktop-api.test.ts`
- Modify: `apps/desktop/test/web/transport.test.ts`
- Modify: `apps/desktop/test/web/browser-development-client.test.ts`

- [ ] **Step 1: Write failing bridge and transport assertions**

In `desktop-api.test.ts`, add `inspectProjectBranches` to the frozen method list, invoke it, and assert:

```ts
expect(ipc.invoke).toHaveBeenCalledWith("oh-my-bug:request", {
  operation: "inspectProjectBranches",
  payload: { path: "/work/checkout", providerId: "git", refreshRemote: true },
});
```

In `transport.test.ts`, add a bridge mock and assertion:

```ts
inspectProjectBranches: vi.fn(async () => ({
  localBranches: ["main"], remoteBranches: ["origin/main"],
})),

await expect(transport.projectBranches(project.path, "git", true)).resolves.toEqual({
  localBranches: ["main"], remoteBranches: ["origin/main"],
});
```

In `browser-development-client.test.ts`, put `branches` into the Git project inspection and assert `projectBranches(path, "git", true)` returns that snapshot data without attempting a write.

- [ ] **Step 2: Run desktop transport tests and verify RED**

Run: `pnpm --filter @oh-my-bug/desktop test -- desktop-api.test.ts transport.test.ts browser-development-client.test.ts`

Expected: tests fail because bridge and renderer transport methods do not exist.

- [ ] **Step 3: Add the bridge and transport methods**

Use one consistent renderer signature:

```ts
projectBranches(
  path: string,
  providerId: string,
  refreshRemote: boolean,
): Promise<WorkspaceBranchDiscoveryDto>;
```

Export `WorkspaceBranchDiscoveryDto` from `api/types.ts` as:

```ts
export type WorkspaceBranchDiscoveryDto = RuntimeOperationOutput<"inspectProjectBranches">;
```

Add the matching `DesktopApi.inspectProjectBranches`, `createDesktopApi` request mapping, `ProductTransport.projectBranches`, `createDesktopTransport` mapping, and `unavailableTransport` entry.

In browser development transport, return the inspected snapshot value:

```ts
projectBranches: async (path, providerId) => {
  const project = (await snapshot()).projects.find((candidate) => candidate.path === path);
  if (!project) throw new Error("PROJECT_NOT_FOUND");
  const discovery = (await snapshot()).projectInspections?.[project.id]
    ?.workspaces[providerId]?.branches;
  if (!discovery) throw new Error(`WORKSPACE_BRANCH_DISCOVERY_NOT_AVAILABLE:${providerId}`);
  return discovery;
},
```

Browser preview deliberately returns snapshot data for both refresh values because it is read-only and cannot run Git.

- [ ] **Step 4: Run desktop transport tests and typecheck**

Run: `pnpm --filter @oh-my-bug/desktop test -- desktop-api.test.ts transport.test.ts browser-development-client.test.ts && pnpm --filter @oh-my-bug/desktop typecheck`

Expected: bridge, renderer, and browser-preview tests pass.

- [ ] **Step 5: Commit the transport layer**

```bash
git add apps/desktop/src/electron/desktop-api.ts apps/desktop/src/web/api apps/desktop/test/electron/desktop-api.test.ts apps/desktop/test/web/transport.test.ts apps/desktop/test/web/browser-development-client.test.ts
git commit -m "feat(desktop): bridge project branch discovery"
```

### Task 5: Build the reusable Switch and grouped branch Combobox

**Files:**
- Create: `apps/desktop/src/web/components/ui/switch.tsx`
- Create: `apps/desktop/src/web/projects/git-branch-combobox.tsx`
- Modify: `apps/desktop/test/web/projects.test.tsx`

- [ ] **Step 1: Write failing branch-picker interaction tests**

Add a focused test that renders `GitBranchCombobox` with a deferred refresh:

```tsx
it("shows local branches first, then appends searchable remote branches", async () => {
  let resolveRefresh!: (value: WorkspaceBranchDiscoveryDto) => void;
  const refresh = vi.fn(() => new Promise<WorkspaceBranchDiscoveryDto>((resolve) => {
    resolveRefresh = resolve;
  }));
  render(<GitBranchCombobox
    discovery={{ localBranches: ["main", "release"], remoteBranches: [] }}
    onChange={vi.fn()}
    onRefresh={refresh}
    value="main"
  />);

  fireEvent.click(screen.getByRole("button", { name: "打开基线分支" }));
  expect(screen.getByRole("group", { name: "本地分支" })).toHaveTextContent("main");
  expect(screen.getByText("正在加载远程分支…")).toBeVisible();
  resolveRefresh({
    localBranches: ["main", "release"],
    remoteBranches: ["origin/main", "origin/release"],
    remote: { name: "origin", url: "git@example.com:team/repo.git" },
  });
  expect(await screen.findByRole("group", { name: "远程分支" }))
    .toHaveTextContent("origin/release");
  fireEvent.change(screen.getByRole("combobox", { name: "基线分支" }), {
    target: { value: "release" },
  });
  expect(screen.queryByText("main")).not.toBeInTheDocument();
  expect(screen.getByText("release")).toBeVisible();
  expect(screen.getByText("origin/release")).toBeVisible();
});
```

Add a second test where refresh resolves with `refreshError`, then assert local options stay present and clicking “重试” calls `onRefresh` again.

- [ ] **Step 2: Run the focused renderer test and verify RED**

Run: `pnpm --filter @oh-my-bug/desktop test -- projects.test.tsx`

Expected: import fails because `git-branch-combobox.tsx` does not exist.

- [ ] **Step 3: Create the Base UI Switch wrapper**

Create `switch.tsx`:

```tsx
import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "../../lib/utils.js";

export function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return <SwitchPrimitive.Root
    className={cn("relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-border bg-muted outline-none transition-colors data-checked:bg-accent focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-default disabled:opacity-50", className)}
    data-slot="switch"
    {...props}
  >
    <SwitchPrimitive.Thumb className="block size-4 translate-x-0.5 rounded-full bg-[var(--surface)] shadow-sm transition-transform data-checked:translate-x-[18px]" />
  </SwitchPrimitive.Root>;
}
```

- [ ] **Step 4: Create the grouped Combobox**

Implement `GitBranchCombobox` with controlled `value`, internal `discovery`, `loading`, and `open` state. Use Base UI `Combobox.Root`, `InputGroup`, `Input`, `Trigger`, `Portal`, `Positioner`, `Popup`, `List`, `Group`, `GroupLabel`, `Collection`, `Item`, and `ItemIndicator`.

The component contract is:

```ts
interface GitBranchComboboxProps {
  value: string;
  discovery: WorkspaceBranchDiscoveryDto;
  onChange(value: string): void;
  onRefresh(): Promise<WorkspaceBranchDiscoveryDto>;
}
```

On every closed-to-open transition, set `loading`, call `onRefresh`, replace discovery with the result, and retain the current discovery on rejection by synthesizing `refreshError`. Ignore repeated open events while `loading` is true. Render groups with values `{ value: "local", label: "本地分支", items: [...] }` and `{ value: "remote", label: "远程分支", items: [...] }`; do not render per-option locality badges. The retry button calls the same refresh function.

- [ ] **Step 5: Run the renderer tests and typecheck**

Run: `pnpm --filter @oh-my-bug/desktop test -- projects.test.tsx && pnpm --filter @oh-my-bug/desktop typecheck`

Expected: grouped loading, search, failure, and retry tests pass.

- [ ] **Step 6: Commit the UI primitives**

```bash
git add apps/desktop/src/web/components/ui/switch.tsx apps/desktop/src/web/projects/git-branch-combobox.tsx apps/desktop/test/web/projects.test.tsx
git commit -m "feat(desktop): add grouped Git branch picker"
```

### Task 6: Integrate Git fields and refine project settings chrome

**Files:**
- Create: `apps/desktop/src/web/projects/git-workspace-fields.tsx`
- Modify: `apps/desktop/src/web/projects/project-form.tsx`
- Modify: `apps/desktop/src/web/app.tsx`
- Modify: `apps/desktop/src/web/styles/global.css`
- Modify: `apps/desktop/test/web/projects.test.tsx`
- Modify: `apps/desktop/test/web/app-workbench.test.tsx`
- Modify: `apps/desktop/test/web/project-settings-layout.test.ts`

- [ ] **Step 1: Write failing project-form and layout tests**

Update the Git project test to assert:

```ts
expect(screen.getByRole("combobox", { name: "基线分支" })).toHaveValue("main");
expect(screen.getByRole("switch", { name: "完成后推送到远程" })).not.toBeChecked();
expect(screen.getByText("git@example.com:team/checkout.git")).toBeVisible();
expect(screen.queryByDisplayValue("origin")).not.toBeInTheDocument();
```

Add an app-workbench assertion that editing a project has no top buttons named “保存项目（顶部）” or “返回项目列表”, while the form footer still contains “取消” and “保存项目”.

Extend `project-settings-layout.test.ts` with source assertions that `.project-settings-actions` remains inside `.project-settings-main`, has no shadow, uses a single-row minimum height, and `.project-path-control [data-slot="button"]` has `height: 32px`.

- [ ] **Step 2: Run the project renderer tests and verify RED**

Run: `pnpm --filter @oh-my-bug/desktop test -- projects.test.tsx app-workbench.test.tsx project-settings-layout.test.ts`

Expected: failures show the checkbox, top duplicate actions, and mismatched path-button height.

- [ ] **Step 3: Create `GitWorkspaceFields`**

Use this contract:

```ts
interface GitWorkspaceFieldsProps {
  config: Record<string, ConfigValue>;
  discovery: WorkspaceBranchDiscoveryDto;
  pushState?: WorkspaceInspectionFieldState;
  onChange(key: string, value: ConfigValue): void;
  onRefreshBranches(): Promise<WorkspaceBranchDiscoveryDto>;
}
```

Render `GitBranchCombobox` for `baseBranch`, then a full-width `.git-publication-field` containing a labeled `Switch`, a one-line explanation, the read-only remote URL in `<code>`, and the muted `Git remote: <name>` description. When `pushState.enabled` is false, disable the switch, force `pushToRemote` false when merging inspection data, and associate `pushState.reason` through `aria-describedby`.

- [ ] **Step 4: Integrate the Git-specific field renderer**

Add to `ProjectFormProps`:

```ts
onRefreshWorkspaceBranches?(
  path: string,
  providerId: string,
): Promise<WorkspaceBranchDiscoveryDto>;
```

In the workspace section, render `GitWorkspaceFields` when `project.workspace.provider === "git"`; render the existing `ConfigFields` for every other provider. Pass the inspection's initial `branches` and bind refresh to:

```ts
() => onRefreshWorkspaceBranches!(project.path, project.workspace.provider)
```

If the callback is absent, resolve the current inspection data so browser tests remain deterministic.

In `ProjectsWorkspace`, pass:

```tsx
onRefreshWorkspaceBranches={(path, providerId) => api.projectBranches(path, providerId, true)}
```

- [ ] **Step 5: Remove duplicate top actions and refine layout CSS**

In `app.tsx`, remove the `projectEditing` header actions branch so the view header only renders list-level project actions when not editing.

In `global.css`:

```css
.project-path-control [data-slot="button"] {
  height: 32px;
  flex: 0 0 auto;
}

.project-settings-main {
  position: relative;
}

.project-settings-actions {
  min-height: 54px;
  flex-wrap: nowrap;
  gap: 12px;
  border-top: 1px solid var(--border);
  background: var(--surface);
  padding: 10px clamp(24px, 3.5vw, 36px);
  box-shadow: none;
}

.project-save-alert {
  position: absolute;
  right: clamp(24px, 3.5vw, 36px);
  bottom: 62px;
  left: clamp(24px, 3.5vw, 36px);
}

.git-publication-field {
  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 4px 16px;
  border-top: 1px solid var(--border);
  padding-top: 12px;
}
```

Move `project-save-alert` out of the `<footer>` in `project-form.tsx` and render it as an absolutely positioned sibling immediately before the footer:

```tsx
{saveError ? <Alert className="project-save-alert" variant="destructive">
  <AlertDescription>{saveError}</AlertDescription>
</Alert> : null}
<footer className="project-settings-actions">
  <div className="project-settings-status">{/* existing status markup */}</div>
  <div className="project-settings-action-buttons">{/* existing buttons */}</div>
</footer>
```

Keep `.project-settings-main` as the two-row grid and keep the footer inside it. Do not change the outer `.project-settings-tabs` grid or span the footer beneath `.project-settings-nav`.

- [ ] **Step 6: Run the project renderer tests and typecheck**

Run: `pnpm --filter @oh-my-bug/desktop test -- projects.test.tsx app-workbench.test.tsx project-settings-layout.test.ts && pnpm --filter @oh-my-bug/desktop typecheck`

Expected: footer, header, Git field, remote URL, and path-control tests pass.

- [ ] **Step 7: Commit project settings integration**

```bash
git add apps/desktop/src/web/projects apps/desktop/src/web/app.tsx apps/desktop/src/web/styles/global.css apps/desktop/test/web
git commit -m "feat(desktop): refine Git workspace settings"
```

### Task 7: Reuse the Codex failure banner for evidence failure

**Files:**
- Modify: `apps/desktop/src/web/issues/issue-detail.tsx`
- Modify: `apps/desktop/test/web/issues.test.tsx`

- [ ] **Step 1: Tighten the evidence failure test**

Extend the existing evidence retry test:

```ts
const alert = screen.getByRole("alert");
expect(alert).toHaveClass("error-banner");
expect(alert).toHaveTextContent("证据采集失败；实现改动和工作目录已保留。");
expect(alert.querySelector("svg")).not.toBeNull();
expect(alert).not.toHaveAttribute("data-slot", "alert");
```

- [ ] **Step 2: Run the Issue renderer test and verify RED**

Run: `pnpm --filter @oh-my-bug/desktop test -- issues.test.tsx`

Expected: evidence failure still has `data-slot="alert"` and lacks `.error-banner`.

- [ ] **Step 3: Reuse the existing banner markup**

Replace the evidence-only `<Alert>` branch with:

```tsx
{issue.status === "EVIDENCE_FAILED" && !retrying
  ? <div className="error-banner" role="alert">
      <CircleAlert aria-hidden="true" size={15} />
      证据采集失败；实现改动和工作目录已保留。
    </div>
  : issue.lastFailure && !retrying
    ? <div className="error-banner" role="alert">
        <CircleAlert aria-hidden="true" size={15} />
        {failureMessage(issue.lastFailure)}
      </div>
    : null}
```

Do not change the recovery section or retry semantics.

- [ ] **Step 4: Run Issue tests and commit**

Run: `pnpm --filter @oh-my-bug/desktop test -- issues.test.tsx`

Expected: Issue renderer tests pass.

```bash
git add apps/desktop/src/web/issues/issue-detail.tsx apps/desktop/test/web/issues.test.tsx
git commit -m "fix(desktop): unify evidence failure banner"
```

### Task 8: Full verification and browser QA

**Files:**
- Verify: all modified source and test files

- [ ] **Step 1: Run the complete automated suite**

Run:

```bash
pnpm test
pnpm typecheck
pnpm exec oxlint apps packages scripts test vitest.config.ts vite.config.ts
pnpm build:web
git diff --check
```

Expected: all tests, type checks, scoped lint, production web build, and whitespace checks pass.

- [ ] **Step 2: Verify project settings in the browser**

At `http://localhost:5173/projects`, verify:

1. The top project-edit header has no duplicate actions.
2. The footer remains only under the right content column and stays fixed while the form scrolls.
3. The path input and “重新选择目录” button have equal computed heights of `32px`.
4. The branch popup displays “本地分支” before the remote Fetch resolves.
5. The popup appends “远程分支” without closing, search filters both groups, and options have no repetitive locality tags.
6. The remote URL is read-only and the publication control exposes `role="switch"`.
7. With no remote, local branches remain usable and remote publication is disabled with a visible reason.

- [ ] **Step 3: Verify the Issue failure banner in the browser**

At `http://localhost:5173/issues`, select an `EVIDENCE_FAILED` Issue and compare its banner with a normal Codex failure. Verify matching computed background, border, icon placement, padding, typography, and alert semantics.

- [ ] **Step 4: Review the final diff and commit any QA-only corrections**

Run:

```bash
git status --short
git diff --stat HEAD~7..HEAD
git log --oneline -8
```

Expected: only planned files are changed and the working tree is clean. If browser QA required a correction, first add a failing regression assertion, make the smallest fix, rerun the relevant focused test, then commit with a scope-specific message.
