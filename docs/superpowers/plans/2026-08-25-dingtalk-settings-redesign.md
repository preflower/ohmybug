# DingTalk Settings Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat DingTalk configuration form and separate credential save with a grouped, compact settings page and one rollback-safe save operation.

**Architecture:** Extend the serializable Integration Manifest with optional presentation sections, then let the generic Desktop form render those sections without a DingTalk-specific branch. Add a `saveProjectSettings` Runtime operation that validates the complete change, writes Keychain secrets, commits SQLite project/workspace state, and restores previous secrets if persistence fails. DingTalk continues to use Stream mode, but relies on `isInAtList` instead of a user-entered mention.

**Tech Stack:** TypeScript 6, React 19, Zod 4, Electron IPC, Vitest, Testing Library, Playwright, SQLite, cross-keychain, DingTalk Stream SDK.

**Design reference:** `docs/superpowers/specs/2026-08-25-dingtalk-settings-redesign.md`

---

## File map

- `packages/core/src/integration/plugin.ts`: Integration Manifest presentation contract and cross-reference validation.
- `packages/core/test/integration/plugin.test.ts`: Manifest serialization and invalid-section coverage.
- `packages/integration-dingtalk/src/plugin.ts`: DingTalk sections, Chinese field copy, optional legacy `mention` compatibility.
- `packages/integration-dingtalk/src/dingtalk-adapter.ts`: @-trigger handling without configured mention.
- `packages/integration-dingtalk/test/*.test.ts`: DingTalk manifest, validation, normalization, and compatibility tests.
- `apps/runtime/src/protocol/types.ts`: `SaveProjectSettingsInput` and Runtime API method.
- `apps/runtime/src/protocol/schema-definitions.ts`: strict discriminated save schema.
- `apps/runtime/src/protocol/operations.ts`: renderer-visible `saveProjectSettings` operation.
- `apps/runtime/src/service.ts`: atomic cross-store save orchestration and rollback helpers.
- `apps/runtime/test/protocol/*.test.ts`: protocol ordering/schema and cross-store rollback tests.
- `apps/desktop/src/electron/desktop-api.ts`: fixed preload bridge method.
- `apps/desktop/src/web/api/transport.ts`: Project Form value to unified save payload mapping.
- `apps/desktop/src/web/api/desktop-transport.ts`: renderer transport wiring.
- `apps/desktop/src/web/projects/integration-fields.tsx`: generic sections, secret replacement, and disclosure UI.
- `apps/desktop/src/web/projects/project-form.tsx`: shared dirty state, validation, one submit, and legacy-field pruning.
- `apps/desktop/src/web/projects/integration-health.tsx`: small generic Integration health presenter.
- `apps/desktop/src/web/app.tsx`: unified save callback and refreshed health state.
- `apps/desktop/src/web/styles/global.css`: reference-matched flat sections, credential rows, disclosure, status, and responsive layout.
- `apps/desktop/test/web/*.test.tsx`: form, transport, status, and accessibility coverage.
- `test/e2e/projects.spec.ts`: one user-visible save workflow.

---

### Task 1: Extend the Integration Manifest presentation contract

**Files:**
- Modify: `packages/core/src/integration/plugin.ts`
- Modify: `packages/core/test/integration/plugin.test.ts`

- [ ] **Step 1: Write failing Manifest serialization and section-reference tests**

Add a grouped Manifest case and an invalid reference case:

```ts
it("serializes optional Integration presentation sections", () => {
  const manifest: IntegrationPluginManifest = {
    id: "fixture",
    name: "Fixture",
    description: "Receive fixture events.",
    sections: [
      { id: "credentials", label: "Credentials", description: "Stored locally." },
      { id: "advanced", label: "Advanced", collapsed: true },
    ],
    configFields: [{
      key: "filter",
      type: "string",
      label: "Filter",
      required: false,
      section: "advanced",
      placeholder: "error",
    }],
    secretFields: [{
      key: "token",
      label: "Token",
      required: true,
      section: "credentials",
    }],
  };

  expect(integrationPluginManifestSchema.parse(manifest)).toEqual(manifest);
});

it("rejects duplicate sections and unknown field section references", () => {
  expect(() => integrationPluginManifestSchema.parse({
    id: "fixture",
    name: "Fixture",
    sections: [{ id: "rules", label: "Rules" }, { id: "rules", label: "More rules" }],
    configFields: [],
    secretFields: [],
  })).toThrow();
  expect(() => integrationPluginManifestSchema.parse({
    id: "fixture",
    name: "Fixture",
    sections: [{ id: "rules", label: "Rules" }],
    configFields: [{ key: "filter", type: "string", label: "Filter", required: false, section: "missing" }],
    secretFields: [],
  })).toThrow();
});
```

- [ ] **Step 2: Run the focused Core test and verify it fails**

Run: `pnpm --filter @oh-my-bug/core test -- test/integration/plugin.test.ts`

Expected: FAIL because `description`, `sections`, `section`, and `placeholder` are rejected by strict schemas.

- [ ] **Step 3: Implement the finite presentation schema**

In `plugin.ts`, extend the field base and Manifest while keeping every property serializable:

```ts
const fieldPresentation = {
  section: z.string().regex(/^[a-z][a-zA-Z0-9]*$/).optional(),
  placeholder: z.string().trim().min(1).optional(),
};

const fieldBase = {
  key: z.string().regex(/^[a-z][a-zA-Z0-9]*$/),
  label: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  required: z.boolean(),
  ...fieldPresentation,
};

export const integrationSectionSchema = z.object({
  id: z.string().regex(/^[a-z][a-zA-Z0-9]*$/),
  label: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  collapsed: z.boolean().optional(),
}).strict();

export const integrationPluginManifestSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  sections: z.array(integrationSectionSchema).optional(),
  configFields: z.array(configFieldSchema),
  secretFields: z.array(secretFieldSchema),
}).strict().superRefine((manifest, context) => {
  const ids = new Set<string>();
  for (const [index, section] of (manifest.sections ?? []).entries()) {
    if (ids.has(section.id)) context.addIssue({ code: "custom", path: ["sections", index, "id"], message: "DUPLICATE_INTEGRATION_SECTION" });
    ids.add(section.id);
  }
  for (const [collection, fields] of [["configFields", manifest.configFields], ["secretFields", manifest.secretFields]] as const) {
    for (const [index, field] of fields.entries()) {
      if (field.section && !ids.has(field.section)) context.addIssue({ code: "custom", path: [collection, index, "section"], message: "INTEGRATION_SECTION_NOT_FOUND" });
    }
  }
});
```

Also add `...fieldPresentation` to `secretFieldSchema`.

- [ ] **Step 4: Run Core tests and typecheck**

Run: `pnpm --filter @oh-my-bug/core test -- test/integration/plugin.test.ts && pnpm --filter @oh-my-bug/core typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the contract change**

```bash
git add packages/core/src/integration/plugin.ts packages/core/test/integration/plugin.test.ts
git commit -m "feat(integrations): add manifest presentation sections"
```

---

### Task 2: Simplify DingTalk configuration and @ handling

**Files:**
- Modify: `packages/integration-dingtalk/src/plugin.ts`
- Modify: `packages/integration-dingtalk/src/dingtalk-adapter.ts`
- Modify: `packages/integration-dingtalk/test/plugin.test.ts`
- Modify: `packages/integration-dingtalk/test/dingtalk-adapter.test.ts`
- Modify: `packages/integration-dingtalk/test/dingtalk-stream.test.ts`

- [ ] **Step 1: Write failing DingTalk Manifest and adapter tests**

Change the Manifest expectation to include `description`, three sections, Chinese field copy, and no `mention` field. Add these adapter assertions:

```ts
it("uses DingTalk at metadata and removes only a leading robot mention", async () => {
  const adapter = new DingTalkIntegrationAdapter({ conversationIds: ["allowed"] });

  await expect(adapter.adapt({
    conversationId: "allowed",
    msgId: "message-1",
    isInAtList: true,
    text: { content: "@OhMyBug checkout fails; notify @Alice" },
  })).resolves.toMatchObject({
    data: { content: "checkout fails; notify @Alice" },
  });
});

it("accepts legacy mention configuration without requiring it", () => {
  const plugin = dingTalkPlugin();
  const current = context().configuration;
  expect(() => plugin.validate({
    ...current,
    config: { conversationIds: ["allowed"] },
  })).not.toThrow();
  expect(() => plugin.validate({
    ...current,
    config: { conversationIds: ["allowed"], mention: "@Old Bot" },
  })).not.toThrow();
});
```

- [ ] **Step 2: Run DingTalk tests and verify they fail**

Run: `pnpm --filter @oh-my-bug/integration-dingtalk test`

Expected: FAIL because the current Manifest requires `mention` and the adapter requires both `mention` text and `isInAtList`.

- [ ] **Step 3: Implement the grouped Manifest and legacy-compatible config parser**

Use this Manifest structure:

```ts
const manifest = {
  id: "dingtalk",
  name: "DingTalk",
  description: "从指定群聊接收消息并创建 Issue。",
  sections: [
    { id: "credentials", label: "应用凭证", description: "凭证仅保存在这台电脑的系统钥匙串中。" },
    { id: "rules", label: "接收规则" },
    { id: "advanced", label: "高级设置", description: "关键词过滤与消息归并", collapsed: true },
  ],
  configFields: [
    { key: "conversationIds", type: "string[]", label: "群聊 ID", description: "仅处理来自这些群聊且 @ 机器人的消息。", required: true, section: "rules" },
    { key: "messageRule", type: "string", label: "消息关键词", required: false, section: "advanced" },
    { key: "threadKeyField", type: "string", label: "消息归并字段", required: false, section: "advanced" },
  ],
  secretFields: [
    { key: "clientId", label: "Client ID", required: true, section: "credentials" },
    { key: "clientSecret", label: "Client Secret", required: true, section: "credentials" },
  ],
} as const satisfies IntegrationPluginManifest;
```

Keep `mention` in the validator allow-list for stored legacy configurations, remove it from `dingTalkConfig()` return data, and stop requiring it.

- [ ] **Step 4: Implement @ normalization without configuration**

Remove `mention` from `DingTalkAdapterOptions`, require `isInAtList === true`, and normalize content with a focused helper:

```ts
function removeLeadingMention(value: string): string {
  return value.replace(/^\s*@[^\s]+\s*/u, "").trim();
}
```

Use `removeLeadingMention(text)` before the empty-content check. Do not remove later `@name` occurrences.

- [ ] **Step 5: Update existing fixtures and run package verification**

Replace adapter construction that passes `mention` and use single-token robot names such as `@OhMyBug` in new-message fixtures. Keep one legacy config test with `mention: "@Old Bot"`.

Run: `pnpm --filter @oh-my-bug/integration-dingtalk test && pnpm --filter @oh-my-bug/integration-dingtalk typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the DingTalk behavior change**

```bash
git add packages/integration-dingtalk
git commit -m "feat(dingtalk): simplify message intake configuration"
```

---

### Task 3: Add the strict unified project-settings protocol

**Files:**
- Modify: `apps/runtime/src/protocol/types.ts`
- Modify: `apps/runtime/src/protocol/schema-definitions.ts`
- Modify: `apps/runtime/src/protocol/operations.ts`
- Modify: `apps/runtime/test/protocol/operations.test.ts`

- [ ] **Step 1: Write a failing protocol schema test**

Add a create and update parse test:

```ts
it("validates one project-settings save with grouped secret patches", () => {
  const create = {
    mode: "create",
    project: { path: "/repo", key: "OMB", integrations: { dingtalk: { enabled: true, config: { conversationIds: ["cid-1"] } } } },
    secretPatches: { dingtalk: { clientId: "client-id", clientSecret: "client-secret" } },
  } as const;
  const update = { ...create, mode: "update", id: "project-1", expectedRevision: 3 } as const;

  expect(runtimeOperations.saveProjectSettings.input.parse(create)).toEqual(create);
  expect(runtimeOperations.saveProjectSettings.input.parse(update)).toEqual(update);
  expect(() => runtimeOperations.saveProjectSettings.input.parse({ ...update, expectedRevision: 0 })).toThrow();
  expect(() => runtimeOperations.saveProjectSettings.input.parse({ ...create, extra: true })).toThrow();
});
```

Add `saveProjectSettings` immediately after `getProject` in the ordered operation expectation.

- [ ] **Step 2: Run the protocol test and verify it fails**

Run: `pnpm --filter @oh-my-bug/runtime test -- test/protocol/operations.test.ts`

Expected: FAIL because `saveProjectSettings` is not a Runtime operation.

- [ ] **Step 3: Define shared types and strict schemas**

In `protocol/types.ts` add:

```ts
export type IntegrationSecretPatches = Record<string, Record<string, string | null>>;

export type SaveProjectSettingsInput =
  | { mode: "create"; project: CreateProjectInput; secretPatches: IntegrationSecretPatches }
  | { mode: "update"; id: string; expectedRevision: number; project: CreateProjectInput; secretPatches: IntegrationSecretPatches };
```

Add `saveProjectSettings(input: SaveProjectSettingsInput): Promise<ProductProject>` to `RuntimeApi`.

In `schema-definitions.ts` add the strict schemas:

```ts
export const integrationSecretPatchesSchema = z.record(
  identifierSchema,
  z.record(identifierSchema, z.string().min(1).nullable()),
);

export const saveProjectSettingsInputSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("create"),
    project: createProjectInputSchema,
    secretPatches: integrationSecretPatchesSchema,
  }).strict(),
  z.object({
    mode: z.literal("update"),
    id: identifierSchema,
    expectedRevision: z.number().int().positive(),
    project: createProjectInputSchema,
    secretPatches: integrationSecretPatchesSchema,
  }).strict(),
]);
```

- [ ] **Step 4: Register the operation**

In `operations.ts` add:

```ts
saveProjectSettings: operation({
  input: saveProjectSettingsInputSchema,
  output: productProjectSchema,
  renderer: true,
  invoke: (service, input) => service.saveProjectSettings(input),
}),
```

- [ ] **Step 5: Run the protocol test, then continue directly to Task 4**

Run: `pnpm --filter @oh-my-bug/runtime test -- test/protocol/operations.test.ts`

Expected: the schema assertions PASS. Do not commit Task 3 separately because the new RuntimeApi method is not complete until Task 4. Continue directly to the service tests and implementation.

---

### Task 4: Implement rollback-safe cross-store saving

**Files:**
- Modify: `apps/runtime/src/service.ts`
- Modify: `apps/runtime/test/protocol/service.test.ts`

- [ ] **Step 1: Write failing create/update atomicity tests**

Add tests covering one-call create, stale-update rollback, and Keychain failure:

```ts
it("creates a project and required secrets in one settings save", async () => {
  const { root, service, secrets } = await harness();
  const path = join(root, "project");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(path));

  const saved = await service.saveProjectSettings({
    mode: "create",
    project: { path, key: "SHOP", integrations: { fixture: { enabled: true, config: { workspace: "shop" } } } },
    secretPatches: { fixture: { token: "token-value", secret: "secret-value" } },
  });

  expect(saved.integrations?.fixture?.secretConfigured).toEqual({ token: true, secret: true });
  await expect(secrets.get(`integration-secret:${saved.id}:fixture:token`)).resolves.toBe("token-value");
});

it("restores secrets when a stale SQLite update rejects", async () => {
  const { root, service, secrets } = await harness();
  const path = join(root, "project");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(path));
  const created = await service.saveProjectSettings({
    mode: "create",
    project: { path, key: "SHOP", integrations: { fixture: { enabled: true, config: { workspace: "shop" } } } },
    secretPatches: { fixture: { token: "old-token", secret: "old-secret" } },
  });

  await expect(service.saveProjectSettings({
    mode: "update",
    id: created.id,
    expectedRevision: created.revision - 1,
    project: { path, key: "SHOP", integrations: { fixture: { enabled: true, config: { workspace: "changed" } } } },
    secretPatches: { fixture: { token: "new-token" } },
  })).rejects.toThrow("CONCURRENT_UPDATE");

  await expect(secrets.get(`integration-secret:${created.id}:fixture:token`)).resolves.toBe("old-token");
});
```

Extend the existing failing secret store to assert SQLite remains unchanged and add a store whose rollback `set()` fails, expecting `PROJECT_SETTINGS_ROLLBACK_FAILED`.

- [ ] **Step 2: Run service tests and verify the new tests fail**

Run: `pnpm --filter @oh-my-bug/runtime test -- test/protocol/service.test.ts`

Expected: FAIL because `RuntimeService.saveProjectSettings` is not implemented.

- [ ] **Step 3: Implement validation and secret change preparation**

Add private helpers in `service.ts`:

```ts
interface SecretChange { ref: string; value: string | null; previous: string | null }

private async prepareSecretChanges(
  projectId: string,
  integrations: NonNullable<RuntimeProject["integrations"]>,
  patches: IntegrationSecretPatches,
): Promise<{ integrations: RuntimeProject["integrations"]; changes: SecretChange[] }> {
  const next = structuredClone(integrations);
  const changes: SecretChange[] = [];
  for (const [pluginId, patch] of Object.entries(patches)) {
    const plugin = this.dependencies.integrationRegistry.require(pluginId);
    const configuration = next[pluginId];
    if (!configuration) throw new Error(`PROJECT_INTEGRATION_NOT_FOUND:${pluginId}`);
    const declared = new Set(plugin.manifest.secretFields.map(({ key }) => key));
    for (const [key, value] of Object.entries(patch)) {
      if (!declared.has(key)) throw new Error(`SECRET_FIELD_NOT_DECLARED:${key}`);
      const ref = configuration.secretRefs[key] ?? secretReference(projectId, pluginId, key);
      changes.push({ ref, value, previous: await this.dependencies.secrets.get(ref) });
      if (value === null) delete configuration.secretRefs[key];
      else configuration.secretRefs[key] = ref;
    }
  }
  return { integrations: next, changes };
}
```

After inserting refs, call `validateIntegrations(nextProject)` before writing any secret.

- [ ] **Step 4: Implement apply/rollback helpers**

```ts
private async writeSecret(change: SecretChange, value: string | null): Promise<void> {
  if (value === null) await this.dependencies.secrets.delete(change.ref);
  else await this.dependencies.secrets.set(change.ref, value);
}

private async rollbackSecrets(applied: SecretChange[]): Promise<void> {
  for (const change of [...applied].reverse()) await this.writeSecret(change, change.previous);
}
```

If any Keychain or SQLite step fails, use this exact error structure so domain errors such as `CONCURRENT_UPDATE` survive:

```ts
try {
  // apply secret changes, then persist SQLite
} catch (error) {
  try {
    await this.rollbackSecrets(applied);
  } catch (rollbackError) {
    throw new Error("PROJECT_SETTINGS_ROLLBACK_FAILED", { cause: rollbackError });
  }
  throw error;
}
```

- [ ] **Step 5: Implement `saveProjectSettings`**

Within `mutateProject`, construct the complete next RuntimeProject and selected Workspace before secret writes. For create, generate the ID once. For update, require the current project and use the supplied expected revision. The persistence branch must be exactly one workspace transaction:

```ts
const persisted = this.dependencies.workspacePersistence.transaction(() => {
  if (input.mode === "create") {
    this.dependencies.runtime.registerProject(nextProject);
    this.dependencies.workspacePersistence.setProjectConfiguration(projectId, selectedWorkspace);
    return this.requireProject(projectId);
  }
  const saved = this.dependencies.store.updateProject(nextProject, input.expectedRevision);
  this.dependencies.workspacePersistence.setProjectConfiguration(projectId, selectedWorkspace);
  return saved;
});
```

Refresh Integrations only after successful persistence and return `toProductProject(persisted)`. Keep `createProject`, `updateProject`, and `setIntegrationSecrets` as compatibility operations.

- [ ] **Step 6: Run focused and full Runtime verification**

Run: `pnpm --filter @oh-my-bug/runtime test -- test/protocol/service.test.ts && pnpm --filter @oh-my-bug/runtime test && pnpm --filter @oh-my-bug/runtime typecheck`

Expected: PASS.

- [ ] **Step 7: Commit atomic saving**

```bash
git add apps/runtime/src/protocol apps/runtime/src/service.ts apps/runtime/test/protocol/operations.test.ts apps/runtime/test/protocol/service.test.ts
git commit -m "feat(runtime): save project settings atomically"
```

---

### Task 5: Wire one save operation through Electron and renderer transports

**Files:**
- Modify: `apps/desktop/src/electron/desktop-api.ts`
- Modify: `apps/desktop/src/web/api/transport.ts`
- Modify: `apps/desktop/src/web/api/desktop-transport.ts`
- Modify: `apps/desktop/src/web/api/client.ts`
- Modify: `apps/desktop/test/electron/desktop-api.test.ts`
- Modify: `apps/desktop/test/web/transport.test.ts`

- [ ] **Step 1: Write failing bridge and payload tests**

Expect `saveProjectSettings` in the frozen API and verify a form value with secret drafts maps to one request:

```ts
expect(saveProjectSettingsPayload(
  formValue,
  { dingtalk: { clientId: "client-id" } },
)).toEqual({
  mode: "update",
  id: "project-1",
  expectedRevision: 3,
  project: createProjectPayload(formValue),
  secretPatches: { dingtalk: { clientId: "client-id" } },
});
```

Assert the preload invokes `{ operation: "saveProjectSettings", payload }`.

- [ ] **Step 2: Run Desktop transport tests and verify they fail**

Run: `pnpm --filter @oh-my-bug/desktop test -- test/electron/desktop-api.test.ts test/web/transport.test.ts`

Expected: FAIL because no unified bridge method exists.

- [ ] **Step 3: Add bridge and transport methods**

Add to `DesktopApi` and `createDesktopApi`:

```ts
saveProjectSettings(
  input: RuntimeOperationInput<"saveProjectSettings">,
): Promise<RuntimeOperationOutput<"saveProjectSettings">>;
// implementation
saveProjectSettings: (input) => request("saveProjectSettings", input),
```

Add this method to ProductTransport while retaining the old methods until Task 7 removes their Project Form call sites:

```ts
saveProjectSettings(
  project: ProjectFormValue,
  secretPatches: Record<string, Record<string, string | null>>,
): Promise<ProjectDto>;
```

Implement the payload mapping exactly once in `transport.ts`:

```ts
export function saveProjectSettingsPayload(
  project: ProjectFormValue,
  secretPatches: Record<string, Record<string, string | null>>,
): RuntimeOperationInput<"saveProjectSettings"> {
  const payload = { project: createProjectPayload(project), secretPatches };
  if (!project.id) return { mode: "create", ...payload };
  if (!project.revision) throw new Error("PROJECT_REVISION_REQUIRED");
  return {
    mode: "update",
    id: project.id,
    expectedRevision: project.revision,
    ...payload,
  };
}
```

Keep lower-level compatibility bridge methods.

In `app.tsx`, add a compile-safe callback whose second argument defaults to an empty patch until ProjectForm begins passing drafts in Task 7:

```ts
const saveProjectSettings = async (
  value: ProjectFormValue,
  secretPatches: Record<string, Record<string, string | null>> = {},
) => {
  const saved = await api.saveProjectSettings(value, secretPatches);
  rememberProject(saved);
  return saved;
};
```

- [ ] **Step 4: Run transport, preload, and type verification**

Run: `pnpm --filter @oh-my-bug/desktop test -- test/electron/desktop-api.test.ts test/web/transport.test.ts && pnpm --filter @oh-my-bug/desktop typecheck`

Expected: PASS. ProjectForm still calls the callback with one argument, which uses the default empty patch until Task 7.

- [ ] **Step 5: Commit transport wiring**

```bash
git add apps/desktop/src/electron/desktop-api.ts apps/desktop/src/web/api apps/desktop/test/electron/desktop-api.test.ts apps/desktop/test/web/transport.test.ts apps/desktop/src/web/app.tsx
git commit -m "feat(desktop): expose unified project settings save"
```

---

### Task 6: Build generic grouped Integration fields and health status

**Files:**
- Create: `apps/desktop/src/web/projects/integration-health.tsx`
- Modify: `apps/desktop/src/web/projects/integration-fields.tsx`
- Modify: `apps/desktop/test/web/projects.test.tsx`

- [ ] **Step 1: Write failing grouped-field and credential-replacement tests**

Add sections to the fixture Manifest and assert:

```ts
selectTab("Example source");
expect(screen.getByRole("heading", { name: "Credentials" })).toBeVisible();
expect(screen.getByRole("heading", { name: "Rules" })).toBeVisible();
expect(screen.getByText("Advanced").closest("details")).not.toHaveAttribute("open");
expect(screen.queryByLabelText("API token")).not.toBeInTheDocument();
fireEvent.click(screen.getByRole("button", { name: "替换 API token" }));
expect(screen.getByLabelText("API token")).toHaveValue("");
```

Add status tests for `connected`, `connecting`, `backoff`, and disabled states, including visible text and no secret leakage.

- [ ] **Step 2: Run the focused component test and verify it fails**

Run: `pnpm --filter @oh-my-bug/desktop test -- test/web/projects.test.tsx`

Expected: FAIL because fields are flat and configured secrets always render password inputs.

- [ ] **Step 3: Implement the small generic health presenter**

Create `integration-health.tsx` with this public API:

```ts
export function IntegrationHealthStatus({
  enabled,
  health,
}: {
  enabled: boolean;
  health?: IntegrationHealth;
}) {
  const state = !enabled ? "stopped" : health?.state ?? "connecting";
  const label = state === "connected" ? "已连接"
    : state === "connecting" ? "正在连接"
      : state === "backoff" ? "连接失败，正在重试"
        : "已停用";
  return <div className={`integration-health integration-health-${state}`} role="status">
    <i aria-hidden="true" className="state-dot" />
    <span>{label}</span>
    {state === "backoff" && health?.lastError ? <small>{health.lastError}</small> : null}
    {state === "backoff" && health?.nextRetryAt ? <small>{`下次重试：${new Date(health.nextRetryAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`}</small> : null}
  </div>;
}
```

Do not render raw configuration or secret values.

- [ ] **Step 4: Refactor IntegrationFields around Manifest sections**

Change props to include `editingSecrets`, `onBeginSecretEdit`, and the existing draft callbacks. Render each declared section in order; use `<details>`/`<summary>` when `collapsed` is true. Config fields can reuse `ConfigFields` with a filtered field array. Secret fields use this state branch:

```tsx
{secretConfigured[field.key] && !editingSecrets[field.key]
  ? <div className="configured-secret-row">
      <span>已配置</span>
      <Button aria-label={`替换 ${field.label}`} size="sm" type="button" variant="outline" onClick={() => onBeginSecretEdit(field.key)}>替换</Button>
    </div>
  : <Input autoComplete="off" aria-label={field.label} type="password" value={secretValues[field.key] ?? ""} onChange={(event) => onSecretChange(field.key, event.target.value)} />}
```

If `manifest.sections` is absent, render the previous flat ordering for backward compatibility.

- [ ] **Step 5: Run component tests**

Run: `pnpm --filter @oh-my-bug/desktop test -- test/web/projects.test.tsx`

Expected: grouped/secret/status tests PASS; old ungrouped Manifest tests remain PASS.

- [ ] **Step 6: Commit generic Integration presentation**

```bash
git add apps/desktop/src/web/projects/integration-fields.tsx apps/desktop/src/web/projects/integration-health.tsx apps/desktop/test/web/projects.test.tsx
git commit -m "feat(desktop): render grouped integration settings"
```

---

### Task 7: Make Project Form submit configuration and secrets once

**Files:**
- Modify: `apps/desktop/src/web/projects/project-form.tsx`
- Modify: `apps/desktop/src/web/app.tsx`
- Modify: `apps/desktop/test/web/projects.test.tsx`
- Modify: `apps/desktop/test/web/app-workbench.test.tsx`

- [ ] **Step 1: Replace old credential-save tests with one-submit tests**

Write a test that changes a normal field and two secrets, then clicks one button:

```ts
const onSave = vi.fn(async () => savedProject);
render(<ProjectForm initial={configuredProject} manifests={groupedManifests} onSave={onSave} />);
selectTab("Example source");
fireEvent.change(screen.getByLabelText("Workspace slug"), { target: { value: "new-workspace" } });
fireEvent.click(screen.getByRole("button", { name: "替换 API token" }));
fireEvent.change(screen.getByLabelText("API token"), { target: { value: "secret-token" } });
fireEvent.click(screen.getByRole("button", { name: "替换 Signing key" }));
fireEvent.change(screen.getByLabelText("Signing key"), { target: { value: "signing-key" } });
fireEvent.click(screen.getByRole("button", { name: "保存更改" }));

await waitFor(() => expect(onSave).toHaveBeenCalledWith(
  expect.objectContaining({ integrations: expect.objectContaining({ example: expect.any(Object) }) }),
  { example: { apiToken: "secret-token", signingKey: "signing-key" } },
));
expect(screen.queryByRole("button", { name: /保存 .* 凭证/ })).not.toBeInTheDocument();
```

Add tests that empty replacement drafts are omitted, cancel calls `onCancel` without saving, legacy undeclared `mention` is pruned for installed plugins, and unavailable plugin config is retained.

- [ ] **Step 2: Run Project Form tests and verify they fail**

Run: `pnpm --filter @oh-my-bug/desktop test -- test/web/projects.test.tsx`

Expected: FAIL because ProjectForm still owns a separate credential save block.

- [ ] **Step 3: Change the Project Form save contract and state**

Use:

```ts
onSave(
  project: ProjectFormValue,
  secretPatches: Record<string, Record<string, string | null>>,
): Promise<ProjectDto | void>;
```

Replace per-plugin feedback with one `saveError`, one `saving`, `secretValues`, and `editingSecrets`. In `submit`, build patches by trimming out empty draft values, then call `onSave(normalizedProject, patches)` exactly once. On success, replace form state from the returned ProductProject and clear every secret draft/edit state. On failure, keep all drafts.

- [ ] **Step 4: Prune only installed Manifest fields on save**

Add:

```ts
function declaredConfig(
  manifest: IntegrationPluginManifest,
  config: Record<string, ConfigValue>,
  unavailable: boolean,
): Record<string, ConfigValue> {
  if (unavailable) return { ...config };
  const declared = new Set(manifest.configFields.map(({ key }) => key));
  return Object.fromEntries(Object.entries(config).filter(([key]) => declared.has(key)));
}
```

Use it when creating initial form state and immediately before submit. This removes legacy DingTalk `mention` on the next save without discarding configuration for a missing plugin.

- [ ] **Step 5: Add generic local Integration validation and first-error focus**

Add a `validateIntegrationFields()` helper that returns errors keyed as `${pluginId}.${fieldKey}`. Its exact rules are:

```ts
function missing(value: ConfigValue | undefined): boolean {
  return value === undefined
    || (typeof value === "string" && value.trim() === "")
    || (Array.isArray(value) && (value.length === 0 || value.some((entry) => !entry.trim())));
}
```

- When an Integration is disabled, skip required config and secret validation.
- For every required config field, reject `missing(value)`.
- For `string[]`, trim entries and reject duplicates after trimming.
- For every required secret, accept either `secretConfigured[key] === true` or a non-empty replacement draft.
- On failure, activate the affected Integration tab, focus the first invalid control through its stable DOM id, render the field message through `aria-describedby`, and do not call `onSave`.
- Before submit, trim every string and string-array value and omit blank optional string fields.

Extend the component test with an enabled DingTalk-like Manifest that has no conversation ID or credential, click “保存更改”, and assert the first field error is visible, focused, and no save request occurs.

- [ ] **Step 6: Add Integration health and truthful save status**

Pass `health?: Record<string, IntegrationHealth>` into ProjectForm. For an existing project, read `health[`${project.id}:${manifest.id}`]` and render `IntegrationHealthStatus` beside the enabled switch. Keep save success separate from connection state.

- [ ] **Step 7: Wire App to unified transport and refresh health**

Replace `saveProject` and `saveProjectSecrets` with:

```ts
const saveProjectSettings = async (
  value: ProjectFormValue,
  secretPatches: Record<string, Record<string, string | null>>,
) => {
  const saved = await api.saveProjectSettings(value, secretPatches);
  rememberProject(saved);
  setHealth(await api.integrationHealth());
  return saved;
};
```

Pass `health` and this one callback through `ProjectsWorkspace`; remove `onSaveSecrets` props and code.

- [ ] **Step 8: Run Desktop form and workbench tests**

Run: `pnpm --filter @oh-my-bug/desktop test -- test/web/projects.test.tsx test/web/app-workbench.test.tsx && pnpm --filter @oh-my-bug/desktop typecheck`

Expected: PASS.

- [ ] **Step 9: Commit one-save behavior**

```bash
git add apps/desktop/src/web/projects/project-form.tsx apps/desktop/src/web/app.tsx apps/desktop/test/web/projects.test.tsx apps/desktop/test/web/app-workbench.test.tsx
git commit -m "feat(desktop): save project settings once"
```

---

### Task 8: Match the approved DingTalk visual hierarchy

**Files:**
- Modify: `apps/desktop/src/web/styles/global.css`
- Modify: `apps/desktop/src/web/projects/integration-fields.tsx`
- Modify: `apps/desktop/src/web/projects/project-form.tsx`
- Modify: `apps/desktop/test/web/project-settings-layout.test.ts`
- Modify: `test/e2e/projects.spec.ts`

- [ ] **Step 1: Add failing structure and E2E assertions**

Assert the integration page has, in order, its heading/status, credentials, rules, collapsed advanced disclosure, and footer. Assert only “保存更改” submits and that no separate credential save button exists. Extend `project-settings-layout.test.ts` with these exact source-contract assertions:

```ts
expect(styles).toMatch(/\.integration-section\s*\{[^}]*border-top:\s*1px solid var\(--border\);/s);
expect(styles).toMatch(/\.configured-secret-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto;/s);
expect(styles).toMatch(/\.integration-advanced > summary\s*\{[^}]*cursor:\s*pointer;/s);
expect(styles).toMatch(/\.integration-health-backoff\s*\{[^}]*color:\s*var\(--danger\);/s);
```

In `test/e2e/projects.spec.ts`, add a `DingTalk settings` test that captures dark and light themes and ends each theme branch with:

```ts
await expect(page.getByTestId("project-settings-form")).toHaveScreenshot(
  `dingtalk-settings-${theme}.png`,
  { animations: "disabled" },
);
```

Set the viewport to `1440×900` for the reference snapshots. Add a second `720×450` assertion that the form scrolls, the footer remains visible, and no control intersects the footer; this approximates the available CSS pixels at 200% zoom without relying on browser-specific zoom APIs.

- [ ] **Step 2: Run the focused layout tests and verify they fail**

Run: `pnpm --filter @oh-my-bug/desktop test -- test/web/project-settings-layout.test.ts test/web/projects.test.tsx`

Expected: FAIL until the new structure and class rules are present.

- [ ] **Step 3: Implement the approved flat visual hierarchy**

Use existing semantic tokens only. Add rules with these responsibilities:

```css
.integration-heading { align-items: flex-start; padding-bottom: 20px; }
.integration-status-line { display: flex; align-items: center; gap: 10px; }
.integration-section { padding-block: 22px; border-top: 1px solid var(--border); }
.integration-section-heading { margin-bottom: 14px; }
.configured-secret-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; }
.integration-advanced > summary { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 12px; cursor: pointer; }
.integration-health { display: flex; align-items: center; gap: 8px; color: var(--text-secondary); }
.integration-health-backoff { color: var(--danger); }
```

Keep sections flat, avoid card backgrounds and shadows, retain the 240px settings rail, cap readable form width, and preserve the sticky bottom bar. Change the primary label from “保存项目” to “保存更改”. At the existing narrow breakpoint, collapse two-column fields to one column and keep actions visible.

- [ ] **Step 4: Run component and layout tests in both themes**

Run: `pnpm --filter @oh-my-bug/desktop test -- test/web/project-settings-layout.test.ts test/web/projects.test.tsx test/web/theme.test.ts`

Expected: PASS.

- [ ] **Step 5: Run deterministic visual verification**

Run: `pnpm test:e2e --grep "DingTalk settings" --update-snapshots`

Inspect the newly written Playwright snapshot and compare its information hierarchy against the approved ImageGen reference at:

`/Users/starrblink/.codex/generated_images/01a03786-2f08-7cf1-ad4f-88f12a432f43/exec-089209b0-9558-4158-9a1b-36ca077c2330.png`

Verify: no editable mention, credentials above rules, advanced collapsed, one save action, no overlap at desktop or constrained viewport, and readable dark/light states. Then rerun without updating:

Run: `pnpm test:e2e --grep "DingTalk settings"`

Expected: PASS against the committed deterministic snapshot. The component tests continue to cover light theme and narrow layout tokens.

- [ ] **Step 6: Commit visual implementation**

```bash
git add apps/desktop/src/web/styles/global.css apps/desktop/src/web/projects apps/desktop/test/web test/e2e/projects.spec.ts
git commit -m "feat(desktop): redesign DingTalk settings page"
```

---

### Task 9: Update docs and run repository-wide verification

**Files:**
- Modify: `docs/configuration.md`
- Modify: `README.md` only if command or user-facing setup text changes

- [ ] **Step 1: Update DingTalk configuration documentation**

Replace the DingTalk bullet with exact current behavior:

```md
- DingTalk：启用时需要至少一个群聊 ID，以及 Client ID 和 Client Secret。系统仅处理白名单群聊中 @ 机器人的消息；消息关键词和消息归并字段位于高级设置。普通配置与系统钥匙串凭证通过同一个“保存更改”操作提交。
```

- [ ] **Step 2: Run package-focused verification**

Run:

```bash
pnpm --filter @oh-my-bug/core test
pnpm --filter @oh-my-bug/integration-dingtalk test
pnpm --filter @oh-my-bug/runtime test
pnpm --filter @oh-my-bug/desktop test
```

Expected: all PASS.

- [ ] **Step 3: Run repository gates**

Run:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build:desktop
```

Expected: all commands exit 0. Record any pre-existing failure separately with the exact command and output; do not claim completion while a new failure remains.

- [ ] **Step 4: Run the relevant E2E workflow**

Run: `pnpm test:e2e --grep "project|DingTalk|settings"`

Expected: relevant project configuration scenarios PASS.

- [ ] **Step 5: Commit documentation and any final test fixture updates**

```bash
git add docs/configuration.md README.md test apps/desktop/test packages apps/runtime/test
git commit -m "docs: explain streamlined DingTalk setup"
```

- [ ] **Step 6: Inspect final diff and commit history**

Run: `git status --short && git diff --check && git log --oneline -10`

Expected: clean worktree, no whitespace errors, and focused commits matching Tasks 1–9.
