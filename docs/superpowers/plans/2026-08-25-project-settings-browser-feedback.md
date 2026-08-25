# Project Settings Browser Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the six reviewed project-settings defects with a real optional DingTalk group filter, truthful status presentation, shadcn toast feedback, and stable narrow-viewport layout.

**Architecture:** Extend the serializable integration manifest with declarative field visibility, then use one desktop helper for rendering, validation, and legacy-value hydration. DingTalk owns the receive-filter semantics and backward-compatible runtime normalization. The application mounts one shadcn Sonner toaster, while CSS keeps the narrow settings workspace as a fixed-height grid with an independently scrolling content row.

**Tech Stack:** TypeScript, React 19, Zod, shadcn, Sonner, Vitest, Testing Library, Playwright, CSS

---

### Task 1: Add Declarative Config Field Visibility

**Files:**
- Modify: `packages/core/src/integration/plugin.ts`
- Modify: `packages/core/test/integration/plugin.test.ts`

- [ ] **Step 1: Write the failing manifest contract tests**

Add a visible dependent field to the serializable-vocabulary test:

```ts
{
  key: "channels",
  type: "string[]",
  label: "Channels",
  required: true,
  visibleWhen: { key: "enabled", equals: true },
}
```

Add a focused rejection case:

```ts
it("rejects visibility references to unknown config fields", () => {
  expect(() => integrationPluginManifestSchema.parse({
    id: "fixture",
    name: "Fixture",
    configFields: [{
      key: "channels",
      type: "string[]",
      label: "Channels",
      required: true,
      visibleWhen: { key: "missing", equals: true },
    }],
    secretFields: [],
  })).toThrow("INTEGRATION_VISIBILITY_FIELD_NOT_FOUND");
});
```

- [ ] **Step 2: Run the core test and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/core exec vitest run test/integration/plugin.test.ts
```

Expected: FAIL because strict `configFieldSchema` rejects `visibleWhen`.

- [ ] **Step 3: Implement the serializable visibility schema**

In `packages/core/src/integration/plugin.ts`, add:

```ts
const configValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
]);

const fieldVisibilitySchema = z.object({
  key: z.string().regex(/^[a-z][a-zA-Z0-9]*$/),
  equals: configValueSchema,
}).strict();
```

Add `visibleWhen: fieldVisibilitySchema.optional()` to `fieldBase`. In the manifest `superRefine`, build a set of config-field keys and report the exact custom error for missing references:

```ts
const configFieldKeys = new Set(manifest.configFields.map((field) => field.key));
for (const [index, field] of manifest.configFields.entries()) {
  if (field.visibleWhen && !configFieldKeys.has(field.visibleWhen.key)) {
    context.addIssue({
      code: "custom",
      path: ["configFields", index, "visibleWhen", "key"],
      message: "INTEGRATION_VISIBILITY_FIELD_NOT_FOUND",
    });
  }
}
```

- [ ] **Step 4: Run the core test and verify GREEN**

Run:

```bash
pnpm --filter @oh-my-bug/core exec vitest run test/integration/plugin.test.ts
```

Expected: all integration manifest tests PASS.

- [ ] **Step 5: Commit the manifest contract**

```bash
git add packages/core/src/integration/plugin.ts packages/core/test/integration/plugin.test.ts
git commit -m "feat(core): support conditional integration fields"
```

### Task 2: Make DingTalk Group Filtering Optional

**Files:**
- Modify: `packages/integration-dingtalk/src/plugin.ts`
- Modify: `packages/integration-dingtalk/src/dingtalk-adapter.ts`
- Modify: `packages/integration-dingtalk/test/plugin.test.ts`
- Modify: `packages/integration-dingtalk/test/dingtalk-adapter.test.ts`

- [ ] **Step 1: Write failing plugin behavior tests**

Update the manifest expectation to remove the static rules summary and add these fields in order:

```ts
{
  key: "conversationFilterEnabled",
  type: "boolean",
  label: "群聊过滤",
  description: "开启后仅处理指定群聊；关闭时处理任意群聊中 @ 机器人的消息。",
  required: false,
  defaultValue: false,
  section: "rules",
},
{
  key: "conversationIds",
  type: "string[]",
  label: "群聊 ID",
  description: "仅处理来自这些群聊且 @ 机器人的消息。",
  required: true,
  section: "rules",
  addLabel: "添加群聊",
  visibleWhen: { key: "conversationFilterEnabled", equals: true },
},
```

Add validation cases:

```ts
it("allows an enabled integration without group IDs when filtering is disabled", () => {
  const plugin = dingTalkPlugin();
  expect(() => plugin.validate({
    ...context().configuration,
    config: { conversationFilterEnabled: false },
  })).not.toThrow();
});

it("requires unique group IDs when filtering is enabled", () => {
  const plugin = dingTalkPlugin();
  expect(() => plugin.validate({
    ...context().configuration,
    config: { conversationFilterEnabled: true, conversationIds: [] },
  })).toThrow("DINGTALK_CONFIG_CONVERSATION_IDS_INVALID");
});

it("preserves the legacy allowlist when the explicit switch is absent", () => {
  const plugin = dingTalkPlugin();
  expect(() => plugin.validate({
    ...context().configuration,
    config: { conversationIds: ["allowed"] },
  })).not.toThrow();
});
```

- [ ] **Step 2: Write the failing adapter allow-any-group test**

```ts
it("accepts any mentioned group when conversation filtering is disabled", async () => {
  const adapter = new DingTalkIntegrationAdapter({
    conversationFilterEnabled: false,
    conversationIds: ["previously-allowed"],
  });

  await expect(adapter.adapt({
    ...message,
    conversationId: "another-group",
  })).resolves.toMatchObject({ inputKey: "msg-20260819-1" });
});
```

Update existing adapter fixtures that exercise allowlisting to pass `conversationFilterEnabled: true`.

- [ ] **Step 3: Run the DingTalk tests and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/integration-dingtalk test
```

Expected: FAIL because the manifest, validation result, and adapter option do not yet support the switch.

- [ ] **Step 4: Implement manifest and runtime normalization**

In `packages/integration-dingtalk/src/plugin.ts`:

- change the description to `从群聊接收 @ 机器人的消息并创建 Issue。`;
- remove the `rules.summary` object;
- add the two fields from Step 1;
- add `conversationFilterEnabled` to the allowed config keys.

Normalize the config with this behavior:

```ts
const rawFilterEnabled = configuration.config.conversationFilterEnabled;
if (rawFilterEnabled !== undefined && typeof rawFilterEnabled !== "boolean") {
  throw new Error("DINGTALK_CONFIG_CONVERSATION_FILTER_ENABLED_INVALID");
}
const rawIds = configuration.config.conversationIds;
const legacyFilterEnabled = rawFilterEnabled === undefined && Array.isArray(rawIds) && rawIds.length > 0;
const conversationFilterEnabled = rawFilterEnabled ?? legacyFilterEnabled;
if (rawIds !== undefined && !Array.isArray(rawIds)) {
  throw new Error("DINGTALK_CONFIG_CONVERSATION_IDS_INVALID");
}
const conversationIds = (rawIds ?? []).map((value) => value.trim());
if (conversationFilterEnabled && (
  conversationIds.length === 0
  || conversationIds.some((value) => !value)
  || new Set(conversationIds).size !== conversationIds.length
)) {
  throw new Error("DINGTALK_CONFIG_CONVERSATION_IDS_INVALID");
}
```

Return `conversationFilterEnabled` with `conversationIds`, and pass both to `DingTalkIntegrationAdapter`.

- [ ] **Step 5: Apply the filter only when enabled**

Add the boolean to `DingTalkAdapterOptions` and guard membership:

```ts
conversationFilterEnabled: boolean;
conversationIds: string[];
```

```ts
if (
  this.options.conversationFilterEnabled
  && !this.options.conversationIds.includes(conversationId)
) {
  throw new Error("DINGTALK_CONVERSATION_NOT_ALLOWED");
}
```

- [ ] **Step 6: Run the DingTalk tests and verify GREEN**

Run:

```bash
pnpm --filter @oh-my-bug/integration-dingtalk test
```

Expected: all DingTalk tests PASS.

- [ ] **Step 7: Commit the DingTalk behavior**

```bash
git add packages/integration-dingtalk/src/plugin.ts packages/integration-dingtalk/src/dingtalk-adapter.ts packages/integration-dingtalk/test/plugin.test.ts packages/integration-dingtalk/test/dingtalk-adapter.test.ts
git commit -m "feat(dingtalk): make group filtering optional"
```

### Task 3: Render and Validate Conditional Integration Fields

**Files:**
- Create: `apps/desktop/src/web/projects/config-field-visibility.ts`
- Create: `apps/desktop/test/web/config-field-visibility.test.ts`
- Modify: `apps/desktop/src/web/projects/config-fields.tsx`
- Modify: `apps/desktop/src/web/projects/project-form.tsx`
- Modify: `apps/desktop/src/web/projects/integration-health.tsx`
- Modify: `apps/desktop/test/web/projects.test.tsx`

- [ ] **Step 1: Write failing visibility helper tests**

Create `config-field-visibility.test.ts` with fields matching the DingTalk switch and list. Assert:

```ts
expect(isConfigFieldVisible(conversationIds, fields, {
  conversationFilterEnabled: false,
})).toBe(false);
expect(isConfigFieldVisible(conversationIds, fields, {
  conversationFilterEnabled: true,
})).toBe(true);
expect(withConditionalConfigDefaults(fields, {
  conversationIds: ["legacy-group"],
})).toEqual({
  conversationFilterEnabled: true,
  conversationIds: ["legacy-group"],
});
expect(withConditionalConfigDefaults(fields, {})).toEqual({
  conversationFilterEnabled: false,
});
```

- [ ] **Step 2: Write failing component tests**

Update the DingTalk test manifest and add assertions that:

```ts
expect(screen.getByRole("checkbox", { name: "群聊过滤" })).not.toBeChecked();
expect(screen.queryByRole("button", { name: "添加群聊" })).not.toBeInTheDocument();
```

Rerender with `conversationFilterEnabled: true` and confirm the add button appears. Add a `ProjectForm` legacy-config test that confirms a project with `conversationIds` and no explicit boolean renders the filter checked.

Change the disabled health case to:

```ts
render(<IntegrationHealthStatus enabled={false} />);
expect(screen.queryByRole("status")).not.toBeInTheDocument();
```

- [ ] **Step 3: Run desktop tests and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/web/config-field-visibility.test.ts test/web/projects.test.tsx
```

Expected: FAIL because visibility hydration and hidden disabled health do not exist.

- [ ] **Step 4: Implement the shared visibility helper**

Create `config-field-visibility.ts`:

```ts
import type { ConfigValue, IntegrationPluginManifest } from "../api/types.js";

type ConfigField = IntegrationPluginManifest["configFields"][number];

export function isConfigFieldVisible(
  field: ConfigField,
  fields: ConfigField[],
  config: Record<string, ConfigValue>,
): boolean {
  if (!field.visibleWhen) return true;
  const controller = fields.find((candidate) => candidate.key === field.visibleWhen?.key);
  const value = config[field.visibleWhen.key] ?? controller?.defaultValue;
  return JSON.stringify(value) === JSON.stringify(field.visibleWhen.equals);
}

export function withConditionalConfigDefaults(
  fields: ConfigField[],
  stored: Record<string, ConfigValue>,
): Record<string, ConfigValue> {
  const hydrated = Object.fromEntries(fields.flatMap((field) =>
    field.defaultValue === undefined ? [] : [[field.key, field.defaultValue]],
  ));
  Object.assign(hydrated, stored);
  for (const field of fields) {
    if (!field.visibleWhen || field.visibleWhen.key in stored || !hasValue(stored[field.key])) continue;
    hydrated[field.visibleWhen.key] = field.visibleWhen.equals;
  }
  return hydrated;
}

function hasValue(value: ConfigValue | undefined): boolean {
  return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== "";
}
```

- [ ] **Step 5: Use visibility consistently in rendering and validation**

In `ConfigFields`, filter before mapping:

```tsx
return <>{fields.filter((field) => isConfigFieldVisible(field, fields, config)).map((field) => {
```

In `ProjectForm.initialValue`, replace raw stored config/default selection with:

```ts
config: withConditionalConfigDefaults(manifest.configFields, stored?.config ?? {}),
```

In `validateIntegrations`, skip hidden fields before required/list validation:

```ts
if (!isConfigFieldVisible(field, manifest.configFields, integration.config)) continue;
```

Keep normalization over all fields so hidden group IDs are retained while ignored.

- [ ] **Step 6: Remove the redundant disabled health line**

At the start of `IntegrationHealthStatus`, return nothing when disabled:

```tsx
if (!enabled) return null;
const state = health?.state ?? "stopped";
```

Keep the existing enabled-state labels and retry detail unchanged.

- [ ] **Step 7: Run desktop tests and verify GREEN**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/web/config-field-visibility.test.ts test/web/projects.test.tsx
```

Expected: all focused desktop tests PASS.

- [ ] **Step 8: Commit conditional form behavior**

```bash
git add apps/desktop/src/web/projects/config-field-visibility.ts apps/desktop/test/web/config-field-visibility.test.ts apps/desktop/src/web/projects/config-fields.tsx apps/desktop/src/web/projects/project-form.tsx apps/desktop/src/web/projects/integration-health.tsx apps/desktop/test/web/projects.test.tsx
git commit -m "fix(desktop): clarify integration filtering controls"
```

### Task 4: Replace the Save Alert with a shadcn Toast

**Files:**
- Create: `apps/desktop/src/web/components/ui/sonner.tsx`
- Modify: `apps/desktop/src/web/app.tsx`
- Modify: `apps/desktop/src/web/projects/project-form.tsx`
- Modify: `apps/desktop/test/web/projects.test.tsx`
- Modify: `apps/desktop/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Add Sonner through the desktop workspace**

Run:

```bash
pnpm --filter @oh-my-bug/desktop add sonner
```

Expected: `sonner` appears in the desktop dependencies and the lockfile is updated.

- [ ] **Step 2: Write the failing save-error toast test**

Render `ProjectForm` beside the checked-in `Toaster`, provide a valid configured project, and reject the save:

```tsx
render(<ThemeProvider>
  <ProjectForm
    initial={configuredProject}
    manifests={manifests}
    onSave={async () => { throw new Error("浏览器样式预览为只读模式"); }}
  />
  <Toaster />
</ThemeProvider>);
fireEvent.click(screen.getByRole("button", { name: "保存更改" }));
expect(await screen.findByText("浏览器样式预览为只读模式")).toBeVisible();
expect(document.querySelector(".project-save-alert")).not.toBeInTheDocument();
```

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/web/projects.test.tsx
```

Expected: FAIL because the toaster primitive is missing and the form still renders an inline alert.

- [ ] **Step 4: Add the checked-in shadcn Sonner primitive**

Create `components/ui/sonner.tsx`:

```tsx
import { Toaster as Sonner, type ToasterProps } from "sonner";

import { useTheme } from "../../theme/theme-context.js";

export function Toaster(props: ToasterProps) {
  const { resolvedTheme } = useTheme();
  return <Sonner
    closeButton
    richColors
    theme={resolvedTheme}
    position="bottom-right"
    toastOptions={{ duration: 5_000 }}
    {...props}
  />;
}
```

Mount it once inside `ThemeProvider`, after `AppContent` and within `TooltipProvider`:

```tsx
<TooltipProvider>
  <AppContent />
  <Toaster />
</TooltipProvider>
```

- [ ] **Step 5: Send persistence failures to the toast**

In `project-form.tsx`, import `toast` from `sonner`, remove `saveError` state and the `.project-save-alert` rendering, and replace the catch body with:

```ts
} catch (error) {
  toast.error(error instanceof Error ? error.message : "保存更改失败");
} finally {
```

Do not change the inline integration validation alert.

- [ ] **Step 6: Run the focused test and verify GREEN**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/web/projects.test.tsx
```

Expected: the save-error toast test and existing validation tests PASS.

- [ ] **Step 7: Commit the toast integration**

```bash
git add apps/desktop/src/web/components/ui/sonner.tsx apps/desktop/src/web/app.tsx apps/desktop/src/web/projects/project-form.tsx apps/desktop/test/web/projects.test.tsx apps/desktop/package.json pnpm-lock.yaml
git commit -m "fix(desktop): show project save failures as toast"
```

### Task 5: Correct Disclosure and Narrow Workspace Layout

**Files:**
- Modify: `apps/desktop/src/web/styles/global.css`
- Modify: `apps/desktop/test/web/project-settings-layout.test.ts`
- Modify: `test/e2e/runtime-protocol-fixture.ts`
- Modify: `test/e2e/projects.spec.ts`

- [ ] **Step 1: Write failing CSS contract assertions**

Add assertions for:

```ts
expect(styles).toMatch(/\.integration-section-collapsed > summary\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*7px minmax\(0,\s*1fr\);/s);
expect(styles).toMatch(/\.integration-section-collapsed > summary::before\s*\{[^}]*margin-top:\s*8px;/s);
```

Extract the `max-width: 760px` block and assert it keeps full-height rows:

```ts
expect(narrow).toMatch(/\.project-settings-tabs\s*\{[^}]*height:\s*100%;[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\);/s);
expect(narrow).toMatch(/\.project-settings-main\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\) auto;/s);
expect(narrow).not.toMatch(/\.integration-section-fields > fieldset[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
```

Extract the `max-width: 520px` block and assert the one-column integration fields live there.

Mirror the production DingTalk manifest in `runtime-protocol-fixture.ts`. In the existing DingTalk flow, click “群聊过滤” before “添加群聊”. Add a `693 × 755` acceptance test that opens DingTalk and asserts:

```ts
await page.setViewportSize({ width: 693, height: 755 });
await page.getByRole("tab", { name: "DingTalk" }).click();
await expect(page.getByRole("checkbox", { name: "群聊过滤" })).not.toBeChecked();
await expect(page.getByRole("button", { name: "添加群聊" })).not.toBeVisible();
await page.getByRole("checkbox", { name: "群聊过滤" }).click();
await expect(page.getByRole("button", { name: "添加群聊" })).toBeVisible();
```

Measure layout:

```ts
const metrics = await page.locator(".project-settings-tabs").evaluate((root) => {
  const fieldset = root.querySelector<HTMLElement>('[data-config-key="conversationIds"]')!;
  const footer = root.querySelector<HTMLElement>(".project-settings-actions")!;
  const tabsRect = root.getBoundingClientRect();
  const footerRect = footer.getBoundingClientRect();
  return {
    fieldsetColumns: getComputedStyle(fieldset).gridTemplateColumns,
    bottomGap: Math.round(tabsRect.bottom - footerRect.bottom),
  };
});
expect(metrics.fieldsetColumns).toContain("160px");
expect(metrics.bottomGap).toBe(0);

await page.screenshot({
  path: resolve(".artifacts/project-settings-browser-feedback/filter-on.png"),
  fullPage: false,
});
```

- [ ] **Step 2: Run the layout test and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/web/project-settings-layout.test.ts
pnpm exec playwright test test/e2e/projects.spec.ts --grep "reviewed narrow project settings"
```

Expected: both commands FAIL on disclosure layout, narrow row sizing, breakpoint ownership, or footer placement.

- [ ] **Step 3: Align the disclosure indicator with the title**

Change the summary to a two-column grid:

```css
.integration-section-collapsed > summary {
  display: grid;
  min-height: 64px;
  grid-template-columns: 7px minmax(0, 1fr);
  align-items: start;
  gap: 12px;
  cursor: pointer;
  list-style: none;
  outline: none;
  padding-block: 12px;
}

.integration-section-collapsed > summary::before {
  width: 7px;
  height: 7px;
  margin-top: 8px;
  border-right: 1.5px solid var(--text-secondary);
  border-bottom: 1.5px solid var(--text-secondary);
  content: "";
  transform: rotate(-45deg);
  transition: transform 120ms ease;
}
```

- [ ] **Step 4: Keep the narrow settings grid viewport-bound**

In `@media (max-width: 760px)`, use:

```css
.project-settings-tabs {
  height: 100%;
  min-height: 0;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr);
}

.project-editor-page {
  display: block;
  overflow: hidden;
}

.project-settings-main {
  min-height: 0;
  grid-template-rows: minmax(0, 1fr) auto;
}

.project-settings-content {
  overflow: auto;
  padding: 18px 16px 24px;
}

.project-settings-actions {
  position: static;
  padding: 12px 16px;
}
```

Remove the integration field/fieldset/secret one-column selectors from this breakpoint.

- [ ] **Step 5: Move phone stacking to 520px**

Inside `@media (max-width: 520px)`, add the one-column selectors previously owned by the 760px block, including legend, small-copy, credential row, and secret editing grid placement. This keeps the 693px layout aligned while preserving phone usability.

- [ ] **Step 6: Run the layout test and verify GREEN**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/web/project-settings-layout.test.ts
pnpm exec playwright test test/e2e/projects.spec.ts --grep "reviewed narrow project settings"
```

Expected: the layout unit tests and narrow Playwright acceptance PASS.

- [ ] **Step 7: Commit the layout correction**

```bash
git add apps/desktop/src/web/styles/global.css apps/desktop/test/web/project-settings-layout.test.ts test/e2e/runtime-protocol-fixture.ts test/e2e/projects.spec.ts
git commit -m "fix(desktop): stabilize narrow project settings layout"
```

### Task 6: Verify the Reviewed Viewport and Full Build

**Files:**
- Evidence only: `.artifacts/project-settings-browser-feedback/`

- [ ] **Step 1: Run both focused browser acceptances**

Run:

```bash
pnpm exec playwright test test/e2e/projects.spec.ts --grep "DingTalk settings|reviewed narrow project settings"
```

Expected: both focused Playwright tests PASS at their declared viewports.

- [ ] **Step 2: Inspect deterministic visual evidence**

Open `.artifacts/project-settings-browser-feedback/filter-on.png` and confirm the screenshot dimensions are `693 × 755`, the group filter controls remain aligned, and the footer touches the bottom of the settings workspace. Keep `.artifacts/` uncommitted.

- [ ] **Step 3: Run the complete verification suite**

Run each command separately and require exit code 0:

```bash
pnpm --filter @oh-my-bug/core test
pnpm --filter @oh-my-bug/integration-dingtalk test
pnpm --filter @oh-my-bug/desktop test
pnpm --filter @oh-my-bug/desktop typecheck
pnpm build:web
pnpm exec playwright test test/e2e/projects.spec.ts
git diff --check
```

Expected: all tests and typechecks PASS, the web build succeeds, Playwright reports no failures, and `git diff --check` prints nothing.

- [ ] **Step 4: Inspect the real browser preview**

At `http://localhost:5173/projects`, inspect the actual `693 × 755` view. Confirm the disclosure indicator is title-aligned, disabled health is not duplicated, the group editor conditionally appears without early stacking, the save failure appears as a toast, and the footer bottom edge matches the settings workspace bottom edge.
