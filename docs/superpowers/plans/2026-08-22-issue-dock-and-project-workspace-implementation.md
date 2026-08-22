# Issue Dock and Project Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Assessment actions fixed at the bottom of Issue detail and make Project workspace controls reflect read-only Git repository inspection, including an optional remote-push switch.

**Architecture:** Extend the workspace-provider contract with provider-owned project inspection. The Git provider resolves repository and remote metadata, while Runtime transports it as read-only form evidence. The Project form merges workspace settings into the Project tab. Issue detail separates its scrolling document from a persistent authorization footer and reuses the existing cancellation operation for closing an Issue.

**Tech Stack:** TypeScript 6, React 19, Base UI/shadcn primitives, Vitest, Testing Library, Electron, Playwright, Git CLI, Zod.

---

## File map

- `packages/module-api/src/workspace.ts`: provider inspection contract.
- `packages/module-api/test/contracts.test.ts`: contract compilation and shape coverage.
- `packages/workspace-git/src/git-client.ts`: non-throwing Git queries used during inspection.
- `packages/workspace-git/src/provider.ts`: Git inspection, remote resolution, new configuration, and legacy normalization.
- `packages/workspace-git/test/inspection.test.ts`: remote-resolution and inspection behavior.
- `packages/workspace-git/test/acquire.test.ts`: current and legacy configuration behavior.
- `packages/workspace-git/test/publish.test.ts`: remote snapshot and push behavior.
- `apps/runtime/src/modules/workspace-registry.ts`: inspection dispatch and failure isolation.
- `apps/runtime/src/protocol/types.ts`: Project inspection DTO.
- `apps/runtime/src/protocol/schema-definitions.ts`: DTO validation.
- `apps/runtime/src/service.ts`: canonical-path provider inspection.
- `apps/runtime/test/protocol/service.test.ts`: service-level inspection coverage.
- `apps/desktop/src/electron/desktop-api.ts`: renderer-accessible project inspection.
- `apps/desktop/src/web/api/transport.ts`: Product transport inspection method.
- `apps/desktop/src/web/api/desktop-transport.ts`: desktop transport implementation.
- `apps/desktop/src/web/api/browser-development-transport.ts`: read-only browser snapshot fallback.
- `apps/desktop/src/web/app.tsx`: load and refresh inspection and directory selection.
- `apps/desktop/src/web/projects/config-fields.tsx`: inspection-driven disabled states and read-only metadata.
- `apps/desktop/src/web/projects/project-form.tsx`: merged Project/workspace tab and read-only path selection.
- `apps/desktop/src/web/issues/approval-panel.tsx`: short actions and close confirmation.
- `apps/desktop/src/web/issues/issue-detail.tsx`: document/footer split and cancellation wiring.
- `apps/desktop/src/web/styles/global.css`: persistent footer, top shadow, Project layout, and responsive alignment.
- `apps/desktop/test/web/projects.test.tsx`: Project form behavior.
- `apps/desktop/test/web/approval-panel.test.tsx`: close and compact-label behavior.
- `apps/desktop/test/web/issues.test.tsx`: Issue detail structure and wiring.
- `apps/desktop/test/web/project-settings-layout.test.ts`: deterministic layout assertions.
- `apps/desktop/test/electron/e2e/first-project.spec.ts`: native directory and Git remote acceptance.
- `apps/desktop/test/electron/e2e/git-workspace.spec.ts`: isolated branch publication acceptance.

### Task 1: Define provider-owned project inspection

**Files:**
- Modify: `packages/module-api/src/workspace.ts`
- Modify: `packages/module-api/test/contracts.test.ts`

- [ ] **Step 1: Write the failing contract test**

Add a factory whose inspection returns generic provider status, field availability, read-only properties, and a hidden configuration patch:

```ts
it("allows a Workspace provider to describe read-only project capabilities", async () => {
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
    inspectProject: async () => ({
      available: true,
      configPatch: { remote: "origin" },
      fields: { pushToRemote: { enabled: true } },
      properties: [{ key: "remoteUrl", label: "远程仓库", value: "git@example.com:team/repo.git" }],
    }),
  };

  await expect(factory.inspectProject?.("/repo")).resolves.toMatchObject({
    available: true,
    configPatch: { remote: "origin" },
  });
});
```

- [ ] **Step 2: Run the contract test and verify RED**

Run: `pnpm --filter @oh-my-bug/module-api test -- contracts.test.ts`

Expected: TypeScript/Vitest fails because `inspectProject` and its result type do not exist.

- [ ] **Step 3: Add the minimal contract**

Add these types and the optional factory method:

```ts
export interface WorkspaceInspectionFieldState {
  enabled: boolean;
  reason?: string;
}

export interface WorkspaceInspectionProperty {
  key: string;
  label: string;
  value: string;
  description?: string;
}

export interface WorkspaceProviderInspection {
  available: boolean;
  reason?: string;
  configPatch?: Record<string, ConfigValue>;
  fields?: Record<string, WorkspaceInspectionFieldState>;
  properties?: WorkspaceInspectionProperty[];
}

export interface WorkspaceProviderFactory {
  readonly id: string;
  readonly manifest: WorkspaceProviderManifest;
  validate(config: Record<string, ConfigValue>): void;
  create(config: Record<string, ConfigValue>): WorkspaceProvider;
  inspectProject?(projectPath: string): Promise<WorkspaceProviderInspection>;
}
```

- [ ] **Step 4: Run the contract test and verify GREEN**

Run: `pnpm --filter @oh-my-bug/module-api test -- contracts.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/module-api/src/workspace.ts packages/module-api/test/contracts.test.ts
git commit -m "feat(workspace): add project inspection contract"
```

### Task 2: Resolve Git repository and remote evidence

**Files:**
- Modify: `packages/workspace-git/src/git-client.ts`
- Modify: `packages/workspace-git/src/provider.ts`
- Create: `packages/workspace-git/test/inspection.test.ts`
- Modify: `packages/workspace-git/test/helpers.ts`

- [ ] **Step 1: Write failing remote-resolution tests**

Create fixtures for four cases: branch upstream, `origin`, one non-origin remote, and ambiguous multiple remotes. Assert that the UI property contains the URL/path while `configPatch.remote` contains the internal remote name:

```ts
it("prefers origin and exposes its URL as read-only evidence", async () => {
  const fixture = await createGitFixture();
  await git(fixture.repository, "remote", "add", "origin", "/srv/git/checkout.git");
  const factory = gitWorkspaceFactory({ state: fixture.state, worktreeRoot: fixture.worktreeRoot });

  await expect(factory.inspectProject?.(fixture.repository)).resolves.toMatchObject({
    available: true,
    configPatch: { remote: "origin" },
    fields: { pushToRemote: { enabled: true } },
    properties: [{ key: "remoteUrl", label: "远程仓库", value: "/srv/git/checkout.git" }],
  });
});

it("keeps local Worktree available when no remote exists", async () => {
  const fixture = await createGitFixture();
  const result = await gitWorkspaceFactory({ state: fixture.state, worktreeRoot: fixture.worktreeRoot })
    .inspectProject?.(fixture.repository);

  expect(result).toMatchObject({
    available: true,
    fields: { pushToRemote: { enabled: false, reason: "当前 Git 仓库未配置远程仓库" } },
  });
});
```

Also assert that a non-Git directory returns `available: false`, and multiple remotes without upstream/origin disable only `pushToRemote` with an unambiguous explanation.

- [ ] **Step 2: Run the new tests and verify RED**

Run: `pnpm --filter @oh-my-bug/workspace-git test -- inspection.test.ts`

Expected: FAIL because the factory has no inspection implementation.

- [ ] **Step 3: Add non-throwing Git queries and deterministic resolution**

Add a helper that distinguishes an absent optional Git value from an operational failure:

```ts
export async function tryRunGit(cwd: string, args: readonly string[]): Promise<string | undefined> {
  try {
    return await runGit(cwd, args);
  } catch (error) {
    const cause = error instanceof Error ? error.cause : undefined;
    if (cause && typeof cause === "object" && "code" in cause && cause.code === 1) {
      return undefined;
    }
    throw error;
  }
}
```

Implement inspection in `gitWorkspaceFactory`. Resolve the repository root, list remotes, read the current branch's configured remote, then apply upstream, `origin`, sole-remote, ambiguous ordering. Resolve the selected URL with `git remote get-url <name>` and return:

```ts
return {
  available: true,
  ...(remoteName ? { configPatch: { remote: remoteName } } : {}),
  fields: {
    pushToRemote: remoteName
      ? { enabled: true }
      : { enabled: false, reason },
  },
  properties: remoteUrl
    ? [{ key: "remoteUrl", label: "远程仓库", value: remoteUrl, description: `Git remote: ${remoteName}` }]
    : [],
};
```

- [ ] **Step 4: Run the inspection tests and verify GREEN**

Run: `pnpm --filter @oh-my-bug/workspace-git test -- inspection.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/workspace-git/src/git-client.ts packages/workspace-git/src/provider.ts packages/workspace-git/test/helpers.ts packages/workspace-git/test/inspection.test.ts
git commit -m "feat(git): inspect repository remote evidence"
```

### Task 3: Replace delivery text with a remote-push switch and preserve legacy projects

**Files:**
- Modify: `packages/workspace-git/src/provider.ts`
- Modify: `packages/workspace-git/test/acquire.test.ts`
- Modify: `packages/workspace-git/test/publish.test.ts`

- [ ] **Step 1: Write failing configuration tests**

Assert the manifest and both configuration generations:

```ts
it("models remote publication as a Boolean capability", () => {
  const factory = gitWorkspaceFactory({ state: new MemoryModuleState(), worktreeRoot: "/tmp/worktrees" });
  expect(factory.manifest.configFields).toContainEqual(expect.objectContaining({
    key: "pushToRemote",
    type: "boolean",
    label: "完成后推送到远程",
    defaultValue: false,
  }));
  expect(factory.manifest.configFields).not.toContainEqual(expect.objectContaining({ key: "delivery" }));
});

it("accepts legacy delivery configuration", () => {
  const factory = gitWorkspaceFactory({ state: new MemoryModuleState(), worktreeRoot: "/tmp/worktrees" });
  expect(() => factory.validate({ baseBranch: "main", delivery: "remote", remote: "delivery" }))
    .not.toThrow();
});
```

Update publication tests to configure `{ baseBranch: "main", pushToRemote: true, remote: "delivery" }` and assert the state snapshots both `remote: "delivery"` and `remoteUrl` from inspection/acquisition.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm --filter @oh-my-bug/workspace-git test -- acquire.test.ts publish.test.ts`

Expected: FAIL because the manifest and parser still require `delivery`.

- [ ] **Step 3: Implement current and legacy schemas**

Use a union that normalizes both shapes into one internal configuration:

```ts
type GitWorkspaceConfig = {
  baseBranch: string;
  pushToRemote: boolean;
  remote?: string;
};

function parseConfiguration(config: Record<string, ConfigValue>): GitWorkspaceConfig {
  const current = currentGitWorkspaceConfigSchema.safeParse(config);
  if (current.success) return current.data;
  const legacy = legacyGitWorkspaceConfigSchema.safeParse(config);
  if (legacy.success) return {
    baseBranch: legacy.data.baseBranch,
    pushToRemote: legacy.data.delivery === "remote",
    ...(legacy.data.remote ? { remote: legacy.data.remote } : {}),
  };
  if (current.error.issues.some((issue) => issue.message === "GIT_REMOTE_REQUIRED")) {
    throw new Error("GIT_REMOTE_REQUIRED");
  }
  throw new Error("GIT_WORKSPACE_CONFIG_INVALID", {
    cause: new AggregateError([current.error, legacy.error]),
  });
}
```

Require a resolved internal `remote` only when `pushToRemote` is true. Store the resolved remote name and URL in `GitWorkspaceState`, and push only when `pushToRemote` is true. Keep returned `BranchInfo.remote` as the remote name for compatibility.

- [ ] **Step 4: Run the Git workspace suite and verify GREEN**

Run: `pnpm --filter @oh-my-bug/workspace-git test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/workspace-git/src/provider.ts packages/workspace-git/test/acquire.test.ts packages/workspace-git/test/publish.test.ts
git commit -m "feat(git): make remote publication optional"
```

### Task 4: Transport provider inspection through Runtime

**Files:**
- Modify: `apps/runtime/src/modules/workspace-registry.ts`
- Modify: `apps/runtime/src/protocol/types.ts`
- Modify: `apps/runtime/src/protocol/schema-definitions.ts`
- Modify: `apps/runtime/src/service.ts`
- Modify: `apps/runtime/test/protocol/service.test.ts`

- [ ] **Step 1: Write a failing RuntimeService inspection test**

Register a fixture factory with `inspectProject` and assert provider evidence is returned without changing the canonical path fields:

```ts
await expect(service.inspectProject({ path: projectDirectory })).resolves.toEqual({
  path: await realpath(projectDirectory),
  name: "checkout app",
  key: "CHECKOUT-APP",
  workspaces: {
    local: { available: true },
    fixture: {
      available: true,
      configPatch: { remote: "origin" },
      fields: { pushToRemote: { enabled: true } },
      properties: [{ key: "remoteUrl", label: "远程仓库", value: "/srv/git/checkout.git" }],
    },
  },
});
```

Add a second factory that throws during inspection and assert the registry returns `{ available: false, reason: "…" }` for only that provider.

- [ ] **Step 2: Run the service test and verify RED**

Run: `pnpm --filter @oh-my-bug/runtime test -- protocol/service.test.ts`

Expected: FAIL because `ProjectInspection` has no `workspaces` field and the registry cannot inspect.

- [ ] **Step 3: Implement registry dispatch and DTO schemas**

Add:

```ts
export interface ProjectInspection {
  path: string;
  name: string;
  key: string;
  workspaces: Record<string, WorkspaceProviderInspection>;
}
```

Add matching strict Zod schemas. Implement `WorkspaceRegistry.inspectProject(path)` with `Promise.all` over factories; providers without inspection return `{ available: true }`, and provider failures become provider-scoped unavailable results. Update `RuntimeService.inspectProject` to canonicalize once and include the registry result.

Use these DTO schemas:

```ts
const workspaceInspectionFieldStateSchema = z.object({
  enabled: z.boolean(),
  reason: z.string().min(1).optional(),
}).strict();
const workspaceInspectionPropertySchema = z.object({
  key: identifierSchema,
  label: identifierSchema,
  value: z.string().min(1),
  description: z.string().min(1).optional(),
}).strict();
const workspaceProviderInspectionSchema = z.object({
  available: z.boolean(),
  reason: z.string().min(1).optional(),
  configPatch: configSchema.optional(),
  fields: z.record(identifierSchema, workspaceInspectionFieldStateSchema).optional(),
  properties: z.array(workspaceInspectionPropertySchema).optional(),
}).strict();
```

- [ ] **Step 4: Run Runtime and protocol tests and verify GREEN**

Run: `pnpm --filter @oh-my-bug/runtime test -- protocol/service.test.ts protocol/operations.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/runtime/src/modules/workspace-registry.ts apps/runtime/src/protocol/types.ts apps/runtime/src/protocol/schema-definitions.ts apps/runtime/src/service.ts apps/runtime/test/protocol/service.test.ts
git commit -m "feat(runtime): expose workspace project inspection"
```

### Task 5: Expose inspection and directory reselection to the renderer

**Files:**
- Modify: `apps/desktop/src/electron/desktop-api.ts`
- Modify: `apps/desktop/src/web/api/transport.ts`
- Modify: `apps/desktop/src/web/api/desktop-transport.ts`
- Modify: `apps/desktop/src/web/api/browser-development-transport.ts`
- Modify: `apps/desktop/test/electron/desktop-api.test.ts`
- Modify: `apps/desktop/test/web/transport.test.ts`
- Modify: `apps/desktop/test/web/browser-development-client.test.ts`

- [ ] **Step 1: Write failing transport tests**

Assert that `createDesktopApi().inspectProject(path)` invokes the existing runtime request channel and that ProductTransport forwards it:

```ts
await api.inspectProject("/work/checkout");
expect(ipc.invoke).toHaveBeenCalledWith(DESKTOP_REQUEST_CHANNEL, {
  operation: "inspectProject",
  payload: { path: "/work/checkout" },
});
```

For browser development mode, derive a minimal inspection from the snapshot project and mark provider evidence unavailable when the snapshot contains none.

- [ ] **Step 2: Run transport tests and verify RED**

Run: `pnpm --filter @oh-my-bug/desktop test -- desktop-api.test.ts transport.test.ts browser-development-client.test.ts`

Expected: FAIL because the APIs do not expose `inspectProject`.

- [ ] **Step 3: Add the transport methods**

Add `inspectProject(path: string): Promise<ProjectInspection>` to `DesktopApi` and `ProductTransport`. Implement it with the existing `inspectProject` runtime operation on desktop. Keep `openProjectDirectory` as the native picker that returns the same enriched inspection object.

```ts
// DesktopApi implementation
inspectProject: (path) => request("inspectProject", { path }),

// ProductTransport desktop adapter
inspectProject: (path) => bridge.inspectProject(path),

// Browser preview fallback
inspectProject: async (path) => {
  const project = (await snapshot()).projects.find((candidate) => candidate.path === path);
  if (!project) throw new Error("PROJECT_NOT_FOUND");
  return { path: project.path, name: project.name ?? project.key, key: project.key, workspaces: {} };
},
```

- [ ] **Step 4: Run transport tests and verify GREEN**

Run: `pnpm --filter @oh-my-bug/desktop test -- desktop-api.test.ts transport.test.ts browser-development-client.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/electron/desktop-api.ts apps/desktop/src/web/api/transport.ts apps/desktop/src/web/api/desktop-transport.ts apps/desktop/src/web/api/browser-development-transport.ts apps/desktop/test/electron/desktop-api.test.ts apps/desktop/test/web/transport.test.ts apps/desktop/test/web/browser-development-client.test.ts
git commit -m "feat(desktop): expose project workspace inspection"
```

### Task 6: Merge workspace settings into Project and make paths read-only

**Files:**
- Modify: `apps/desktop/src/web/app.tsx`
- Modify: `apps/desktop/src/web/projects/project-form.tsx`
- Modify: `apps/desktop/src/web/projects/config-fields.tsx`
- Modify: `apps/desktop/src/web/styles/global.css`
- Modify: `apps/desktop/test/web/projects.test.tsx`
- Modify: `apps/desktop/test/web/app-shell.test.tsx`

- [ ] **Step 1: Write failing Project form tests**

Cover the approved UI contract:

```ts
expect(within(screen.getByRole("tablist", { name: "项目配置" }))
  .queryByRole("tab", { name: "工作目录" })).not.toBeInTheDocument();
expect(screen.getByLabelText("本机项目路径")).toHaveAttribute("readonly");
expect(screen.getByRole("button", { name: "重新选择目录" })).toBeEnabled();
expect(screen.queryByText("本机项目已注册")).not.toBeInTheDocument();
expect(screen.getByText("项目路径和配置仅保存在这台电脑上。")).toBeVisible();
expect(screen.getByRole("checkbox", { name: "完成后推送到远程" })).toBeDisabled();
expect(screen.getByText("当前 Git 仓库未配置远程仓库")).toBeVisible();
```

Add a resolved-remote case that asserts the checkbox is enabled, the URL `/srv/git/checkout.git` is displayed in a read-only code/value element, and `origin` is not rendered as an editable input. Add a reselection case that updates only the unsaved path when the picker returns a selection and changes nothing when canceled.

- [ ] **Step 2: Run the Project tests and verify RED**

Run: `pnpm --filter @oh-my-bug/desktop test -- projects.test.tsx app-shell.test.tsx`

Expected: FAIL on the separate tab, editable path, missing inspection state, and text input delivery field.

- [ ] **Step 3: Implement inspection-aware generic config fields**

Extend `ConfigFields` with optional inspection state and read-only properties:

```ts
interface ConfigFieldsProps {
  fields: WorkspaceProviderManifest["configFields"];
  config: Record<string, ConfigValue>;
  inspection?: WorkspaceProviderInspection;
  onChange(key: string, value: ConfigValue): void;
}
```

For Boolean fields, pass `disabled={!fieldState?.enabled}` when a field state is supplied and render its reason in associated helper text. Render `inspection.properties` after editable config fields as read-only definition rows. Merge `inspection.configPatch` into hidden form configuration when a provider or directory is selected; do not render `remote` as an input.

- [ ] **Step 4: Implement the merged Project tab and selection flow**

Remove the Workspace tab trigger and panel. Render workspace mode and provider fields below the path in the Project panel. Make directory-derived and saved paths read-only; preserve editable path only for the explicit advanced manual-entry flow. Add a `重新选择目录` button that calls a passed picker callback and applies the returned inspection without saving.

In `App`, load `api.inspectProject(existing.path)` when an existing project enters edit mode. Pass inspection and a non-navigating directory picker callback to `ProjectForm`. Keep the existing top-level `打开项目目录` flow for creating a new project.

- [ ] **Step 5: Run the Project tests and verify GREEN**

Run: `pnpm --filter @oh-my-bug/desktop test -- projects.test.tsx app-shell.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/web/app.tsx apps/desktop/src/web/projects/project-form.tsx apps/desktop/src/web/projects/config-fields.tsx apps/desktop/src/web/styles/global.css apps/desktop/test/web/projects.test.tsx apps/desktop/test/web/app-shell.test.tsx
git commit -m "feat(desktop): merge project workspace controls"
```

### Task 7: Make the Assessment dock persistent and add close cancellation

**Files:**
- Modify: `apps/desktop/src/web/issues/approval-panel.tsx`
- Modify: `apps/desktop/src/web/issues/issue-detail.tsx`
- Modify: `apps/desktop/src/web/styles/global.css`
- Modify: `apps/desktop/test/web/approval-panel.test.tsx`
- Modify: `apps/desktop/test/web/issues.test.tsx`
- Modify: `apps/desktop/test/web/project-settings-layout.test.ts`

- [ ] **Step 1: Write failing component and structure tests**

Assert short labels and explicit confirmation:

```ts
expect(screen.getByRole("button", { name: "重新分析" })).toBeVisible();
expect(screen.getByRole("button", { name: "开始实现" })).toBeVisible();
fireEvent.click(screen.getByRole("button", { name: "关闭 Issue" }));
expect(screen.getByRole("dialog", { name: "关闭 Issue" })).toHaveTextContent("关闭后，此 Issue 将标记为已取消");
fireEvent.click(screen.getByRole("button", { name: "确认关闭" }));
expect(onClose).toHaveBeenCalledOnce();
```

In Issue detail, assert the scroll document and authorization footer are siblings, with the footer following the document. In the layout test, assert the detail pane itself is non-scrolling, `.issue-detail-document` has `overflow: auto`, and `.approval-dock` is not positioned inside the scrolling element.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm --filter @oh-my-bug/desktop test -- approval-panel.test.tsx issues.test.tsx project-settings-layout.test.ts`

Expected: FAIL because labels are long, close is absent, and the whole detail pane owns scrolling.

- [ ] **Step 3: Implement close confirmation and short actions**

Add `onClose?: () => Promise<void>` to Assessment props. Use the existing Dialog primitives:

```tsx
<Dialog>
  <DialogTrigger render={<Button type="button" variant="ghost">关闭 Issue</Button>} />
  <DialogContent aria-describedby="close-issue-description">
    <DialogTitle>关闭 Issue</DialogTitle>
    <p id="close-issue-description">关闭后，此 Issue 将标记为已取消，且无法继续当前实现流程。</p>
    <div className="dialog-actions">
      <DialogClose render={<Button type="button" variant="secondary" />}>取消</DialogClose>
      <Button type="button" onClick={() => void run(props.onClose!)}>确认关闭</Button>
    </div>
  </DialogContent>
</Dialog>
```

Rename compact actions to `重新分析` and `开始修复`/`开始实现`. Pass `IssueDetail.onCancel` through the existing `refreshAfter` wrapper so the current cancellation operation refreshes the Issue to `CANCELED`.

- [ ] **Step 4: Split scrolling content from the footer**

In `IssueDetail`, compute the compact Assessment authorization element once. Render document content in `.issue-detail-document > .issue-detail-content` and render the compact dock as a sibling footer. Keep non-compact NOT_A_BUG, duplicate, UNCERTAIN, and Delivery panels inside the document.

Update CSS:

```css
.detail-pane-scroll { overflow: hidden; }
.issue-detail { display: grid; height: 100%; width: 100%; grid-template-rows: minmax(0, 1fr) auto; padding: 0; }
.issue-detail-document { min-height: 0; overflow: auto; }
.issue-detail-content { width: min(760px, 100%); margin: 0 auto; padding: 24px clamp(20px, 3.5vw, 36px) 48px; }
.approval-dock { position: relative; bottom: auto; margin: 0; border-width: 1px 0 0; border-radius: 0; box-shadow: 0 -12px 24px rgb(0 0 0 / 10%); }
.approval-actions { justify-content: flex-end; }
```

Use semantic theme variables for the actual shadow color where available and retain right alignment in the narrow media query.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `pnpm --filter @oh-my-bug/desktop test -- approval-panel.test.tsx issues.test.tsx project-settings-layout.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/web/issues/approval-panel.tsx apps/desktop/src/web/issues/issue-detail.tsx apps/desktop/src/web/styles/global.css apps/desktop/test/web/approval-panel.test.tsx apps/desktop/test/web/issues.test.tsx apps/desktop/test/web/project-settings-layout.test.ts
git commit -m "feat(desktop): persist assessment authorization dock"
```

### Task 8: Verify native directory and remote behavior end to end

**Files:**
- Modify: `apps/desktop/test/electron/e2e/first-project.spec.ts`
- Modify: `apps/desktop/test/electron/e2e/git-workspace.spec.ts`

- [ ] **Step 1: Add Electron acceptance cases**

Create a temporary Git repository with a local bare remote. Open it through the native picker, choose Git Worktree, and assert:

```ts
await expect(desktop.page.getByLabel("本机项目路径")).toHaveAttribute("readonly", "");
await expect(desktop.page.getByText(remotePath, { exact: true })).toBeVisible();
await expect(desktop.page.getByRole("checkbox", { name: "完成后推送到远程" })).toBeEnabled();
```

Add a no-remote repository case that leaves Git Worktree selectable but disables only the push switch. Add a reselection case that updates the path only after a non-canceled picker result. Create the remote fixture directly in the spec:

```ts
const repository = await createTempDir("oh-my-bug-git-project-");
const remote = await createTempDir("oh-my-bug-git-remote-");
await execFileAsync("git", ["init", "-b", "main"], { cwd: repository.path });
await execFileAsync("git", ["init", "--bare"], { cwd: remote.path });
await execFileAsync("git", ["remote", "add", "origin", remote.path], { cwd: repository.path });
```

- [ ] **Step 2: Build and run the Electron cases**

Run: `pnpm build:desktop && pnpm exec playwright test -c apps/desktop/playwright.config.ts apps/desktop/test/electron/e2e/first-project.spec.ts apps/desktop/test/electron/e2e/git-workspace.spec.ts`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/test/electron/e2e/first-project.spec.ts apps/desktop/test/electron/e2e/git-workspace.spec.ts
git commit -m "test(desktop): cover workspace inspection flows"
```

### Task 9: Full verification and visual QA

**Files:**
- No product files expected.
- Keep generated screenshots and diffs under `.artifacts/` and uncommitted.

- [ ] **Step 1: Run focused workspace and renderer suites**

Run:

```bash
pnpm --filter @oh-my-bug/module-api test
pnpm --filter @oh-my-bug/workspace-git test
pnpm --filter @oh-my-bug/runtime test
pnpm --filter @oh-my-bug/desktop test
```

Expected: all PASS with no unhandled warnings.

- [ ] **Step 2: Run repository typecheck and lint**

Run:

```bash
pnpm typecheck
pnpm lint
```

Expected: both exit 0.

- [ ] **Step 3: Verify the live browser states**

At `787x756`, verify an `ASSESSMENT_REVIEW` Feature Issue:

- the Assessment document scrolls while the dock remains fixed;
- the dock has a restrained upper shadow and no nested-card appearance;
- buttons are right-aligned and use short labels;
- close confirmation produces `已取消` after confirmation.

On `/projects`, verify:

- no Workspace tab exists;
- the selected path is read-only and reselectable;
- Git Worktree without a remote keeps local delivery available and disables push;
- Git Worktree with a remote shows its URL/path read-only and enables push;
- `origin` is never presented as a user-editable repository address.

- [ ] **Step 4: Run the complete repository test suite**

Run: `pnpm test`

Expected: all workspace and repository tests PASS.

- [ ] **Step 5: Inspect the final diff**

Run:

```bash
git diff --check
git status --short
git log --oneline --decorate -12
```

Expected: no whitespace errors; only intentional changes or the task's planned commits are present; `.artifacts/` remains untracked or ignored.
