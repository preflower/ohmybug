# Shadcn Interactive Controls Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate every reusable renderer interaction to checked-in shadcn/ui primitives while preserving the product layouts, workflow semantics, and visual contract in `DESIGN.md`.

**Architecture:** Expand the existing `components/ui` foundation in two layers: lightweight styled controls and Base UI-backed behavioral surfaces. Feature components consume those primitives, after which an architecture test locks the boundary and obsolete generic control/modal CSS is removed.

**Tech Stack:** Electron 43, React 19, TypeScript 6, Vite 8, Tailwind CSS 4, shadcn/ui 4.18 (`base-nova`), Base UI, class-variance-authority, Vitest, Testing Library, Playwright.

**Spec:** [`docs/superpowers/specs/2026-08-21-shadcn-theme-system-design.md`](../specs/2026-08-21-shadcn-theme-system-design.md)

**Prerequisite:** Complete [`2026-08-21-three-state-theme-system.md`](./2026-08-21-three-state-theme-system.md) first.

## Global Constraints

- `DESIGN.md` controls palette, density, typography, shape, focus, motion, and hierarchy.
- Shadcn is the checked-in interaction primitive layer, not a replacement product aesthetic.
- Do not introduce a generic `Card`; product reports, approval panels, rows, and settings sections retain their semantic components.
- Do not change route structure, product wording, keyboard shortcuts, persistence APIs, workflow transitions, Runtime, Agent, integrations, or IPC.
- Every icon-only action requires an accessible name, tooltip, hover state, and visible keyboard focus.
- Dialogs trap focus, close on Escape, and restore focus to their triggers.
- Existing validation/error placement and dangerous-action safeguards must remain unchanged.
- Use `@base-ui/react`, `class-variance-authority`, `clsx`, and `tailwind-merge`; add no additional component framework or form framework.
- Every production behavior is introduced or protected by a test observed failing first.

---

### Task 1: Add lightweight form and status primitives

**Files:**
- Create: `apps/desktop/src/web/components/ui/input.tsx`
- Create: `apps/desktop/src/web/components/ui/textarea.tsx`
- Create: `apps/desktop/src/web/components/ui/badge.tsx`
- Create: `apps/desktop/src/web/components/ui/separator.tsx`
- Modify: `apps/desktop/src/web/components/ui/button.tsx`
- Create: `apps/desktop/test/web/ui-primitives.test.tsx`

**Interfaces:**
- Consumes: `cn`, semantic Tailwind colors, and the existing `Button` API.
- Produces: `Input`, `Textarea`, `Badge`, `BadgeVariant`, `badgeVariants`, and `Separator`; design-contract-aligned `Button` variants and sizes.

- [ ] **Step 1: Write failing primitive contract tests**

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { Badge } from "../../src/web/components/ui/badge.js";
import { Button } from "../../src/web/components/ui/button.js";
import { Input } from "../../src/web/components/ui/input.js";
import { Separator } from "../../src/web/components/ui/separator.js";
import { Textarea } from "../../src/web/components/ui/textarea.js";

it("exposes stable slots and native form semantics", () => {
  render(<><Input aria-label="标题" invalid /><Textarea aria-label="意见" /><Button>保存</Button></>);
  expect(screen.getByLabelText("标题")).toHaveAttribute("data-slot", "input");
  expect(screen.getByLabelText("标题")).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByLabelText("意见")).toHaveAttribute("data-slot", "textarea");
  expect(screen.getByRole("button", { name: "保存" })).toHaveAttribute("data-slot", "button");
});

it("renders textual badges and semantic separators", () => {
  render(<><Badge variant="review">待确认</Badge><Separator /></>);
  expect(screen.getByText("待确认")).toHaveAttribute("data-slot", "badge");
  expect(screen.getByRole("separator")).toHaveAttribute("data-slot", "separator");
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm --filter @oh-my-bug/desktop exec vitest run test/web/ui-primitives.test.tsx`

Expected: FAIL because four primitive modules do not exist.

- [ ] **Step 3: Implement the minimal primitives**

Use native prop passthrough and stable slots. The form controls must use the 32px/6px design contract and semantic focus token:

```tsx
export function Input({ className, invalid, ...props }: React.ComponentProps<"input"> & { invalid?: boolean }) {
  return <input
    aria-invalid={invalid || undefined}
    className={cn("h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50", className)}
    data-slot="input"
    {...props}
  />;
}

export function Textarea({ className, invalid, ...props }: React.ComponentProps<"textarea"> & { invalid?: boolean }) {
  return <textarea
    aria-invalid={invalid || undefined}
    className={cn("min-h-20 w-full resize-y rounded-md border border-input bg-background px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50", className)}
    data-slot="textarea"
    {...props}
  />;
}
```

Implement `Badge` with `default | review | success | warning | destructive | neutral` variants backed by semantic variables, and export `type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>`. Implement `Separator` as a native `div role="separator"` supporting horizontal/vertical orientation. Align `Button` default height to 30px, standard radius to 6px, active background to `--accent-pressed`, and cursor behavior through `cursor-pointer disabled:cursor-default` so the later global button cleanup does not change affordance. Do not change its public props.

- [ ] **Step 4: Run the test and verify GREEN**

Run: `pnpm --filter @oh-my-bug/desktop exec vitest run test/web/ui-primitives.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit the lightweight primitives**

```bash
git add apps/desktop/src/web/components/ui apps/desktop/test/web/ui-primitives.test.tsx
git commit -m "feat(desktop): add shadcn form and status primitives"
```

### Task 2: Add Base UI-backed selection primitives

**Files:**
- Create: `apps/desktop/src/web/components/ui/select.tsx`
- Create: `apps/desktop/src/web/components/ui/checkbox.tsx`
- Modify: `apps/desktop/test/web/ui-primitives.test.tsx`

**Interfaces:**
- Consumes: `Select` and `Checkbox` namespaces from the installed `@base-ui/react` package, `cn`, and Lucide `Check`/`ChevronDown` icons.
- Produces: `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`, and `Checkbox` with shadcn-compatible props.

- [ ] **Step 1: Add failing keyboard and selection tests**

```tsx
it("selects a Base UI option with the keyboard", () => {
  render(<Select defaultValue="codex">
    <SelectTrigger aria-label="Agent 插件"><SelectValue /></SelectTrigger>
    <SelectContent><SelectItem value="codex">Codex</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent>
  </Select>);
  const trigger = screen.getByRole("combobox", { name: "Agent 插件" });
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  fireEvent.keyDown(screen.getByRole("listbox"), { key: "ArrowDown" });
  fireEvent.keyDown(screen.getByRole("listbox"), { key: "Enter" });
  expect(screen.getByRole("combobox", { name: "Agent 插件" })).toHaveTextContent("Other");
});

it("toggles an accessible checkbox", () => {
  render(<label><Checkbox aria-label="启用" />启用</label>);
  fireEvent.click(screen.getByRole("checkbox", { name: "启用" }));
  expect(screen.getByRole("checkbox", { name: "启用" })).toBeChecked();
});
```

Add `fireEvent` to the Testing Library imports; no new test dependency is required.

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm --filter @oh-my-bug/desktop exec vitest run test/web/ui-primitives.test.tsx`

Expected: FAIL because `select.tsx` and `checkbox.tsx` do not exist.

- [ ] **Step 3: Implement checked-in shadcn-compatible wrappers**

Use `SelectPrimitive.Root`, `Trigger`, `Value`, `Portal`, `Positioner`, `Popup`, `List`, `Item`, and `ItemIndicator`. The trigger must expose `data-slot="select-trigger"`, `role="combobox"` through Base UI, a 32px height, semantic border/background, and a Lucide chevron. Content uses a portal and positioner, `--surface-raised`, `--border`, 8px radius, a restrained shadow, and `data-slot="select-content"`.

Use `CheckboxPrimitive.Root` and `Indicator` with this public shape:

```tsx
export function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return <CheckboxPrimitive.Root
    className={cn("peer size-4 shrink-0 rounded-xs border border-input outline-none focus-visible:ring-3 focus-visible:ring-ring/30 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground disabled:pointer-events-none disabled:opacity-50", className)}
    data-slot="checkbox"
    {...props}
  >
    <CheckboxPrimitive.Indicator data-slot="checkbox-indicator"><Check size={12} /></CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>;
}
```

- [ ] **Step 4: Run the primitive tests and verify GREEN**

Run: `pnpm --filter @oh-my-bug/desktop exec vitest run test/web/ui-primitives.test.tsx`

Expected: PASS without portal cleanup or act warnings.

- [ ] **Step 5: Commit selection primitives**

```bash
git add apps/desktop/src/web/components/ui/select.tsx apps/desktop/src/web/components/ui/checkbox.tsx apps/desktop/test/web/ui-primitives.test.tsx
git commit -m "feat(desktop): add shadcn selection primitives"
```

### Task 3: Add accessible dialog and tooltip primitives

**Files:**
- Create: `apps/desktop/src/web/components/ui/dialog.tsx`
- Create: `apps/desktop/src/web/components/ui/tooltip.tsx`
- Modify: `apps/desktop/test/web/ui-primitives.test.tsx`

**Interfaces:**
- Consumes: `Dialog` and `Tooltip` namespaces from `@base-ui/react`, `cn`, and semantic overlay/surface variables.
- Produces: `Dialog`, `DialogTrigger`, `DialogPortal`, `DialogOverlay`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`, `DialogClose`, `TooltipProvider`, `Tooltip`, `TooltipTrigger`, and `TooltipContent`.

- [ ] **Step 1: Add failing focus-management and tooltip tests**

```tsx
it("closes a dialog with Escape and restores trigger focus", () => {
  render(<Dialog><DialogTrigger render={<Button>新建 Issue</Button>} /><DialogContent><DialogTitle>新建 Issue</DialogTitle></DialogContent></Dialog>);
  const trigger = screen.getByRole("button", { name: "新建 Issue" });
  fireEvent.click(trigger);
  expect(screen.getByRole("dialog", { name: "新建 Issue" })).toBeVisible();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "新建 Issue" })).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

it("shows accessible help for an icon-only action", async () => {
  render(<TooltipProvider delay={0}><Tooltip><TooltipTrigger render={<Button aria-label="关闭" size="icon"><X /></Button>} /><TooltipContent>关闭</TooltipContent></Tooltip></TooltipProvider>);
  fireEvent.focus(screen.getByRole("button", { name: "关闭" }));
  expect(await screen.findByRole("tooltip")).toHaveTextContent("关闭");
});
```

Add `fireEvent` and the Lucide `X` icon to the test imports; no new test dependency is required.

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm --filter @oh-my-bug/desktop exec vitest run test/web/ui-primitives.test.tsx`

Expected: FAIL because the dialog and tooltip modules do not exist.

- [ ] **Step 3: Implement the Base UI wrappers**

Use Base UI portals and the native `render` composition API. `DialogContent` must render `DialogOverlay`, set `data-slot="dialog-content"`, use the semantic overlay, 10px radius, restrained shadow, 140–180ms transitions, and reduced-motion-safe animation utilities. Do not inject a universal close button; feature dialogs render their own labeled close action so tooltips and product layout stay explicit.

`TooltipContent` must portal above dialogs, use compact UI typography, and expose `data-slot="tooltip-content"`. `TooltipProvider` is mounted once around the application in `App` after these primitives land.

- [ ] **Step 4: Run the primitive tests and verify GREEN**

Run: `pnpm --filter @oh-my-bug/desktop exec vitest run test/web/ui-primitives.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit behavioral primitives**

```bash
git add apps/desktop/src/web/components/ui/dialog.tsx apps/desktop/src/web/components/ui/tooltip.tsx apps/desktop/test/web/ui-primitives.test.tsx
git commit -m "feat(desktop): add shadcn dialog and tooltip primitives"
```

### Task 4: Migrate project settings form controls

**Files:**
- Modify: `apps/desktop/src/web/projects/project-form.tsx`
- Modify: `apps/desktop/src/web/projects/integration-fields.tsx`
- Modify: `apps/desktop/test/web/projects.test.tsx`

**Interfaces:**
- Consumes: `Input`, `Textarea`, `Select*`, `Checkbox`, `Button`, `Tabs`, and `Alert`.
- Produces: unchanged `ProjectFormProps`, `ProjectFormValue`, `onSave`, and `onSaveSecrets` behavior with no direct native form controls in project feature files.

- [ ] **Step 1: Add failing primitive-usage and behavior assertions**

Extend existing tests without replacing their persistence assertions:

```tsx
expect(screen.getByLabelText("项目名称")).toHaveAttribute("data-slot", "input");
expect(screen.getByLabelText("项目指令")).toHaveAttribute("data-slot", "textarea");

selectTab("Agent");
expect(screen.getByRole("combobox", { name: "Agent 插件" })).toHaveAttribute("data-slot", "select-trigger");

selectTab("Example source");
expect(screen.getByRole("checkbox", { name: "启用" })).toHaveAttribute("data-slot", "checkbox");
```

Update the existing Agent and integration selection interactions to use `fireEvent` with Base UI roles while retaining exact saved-value assertions.

- [ ] **Step 2: Run project tests and verify RED**

Run: `pnpm --filter @oh-my-bug/desktop exec vitest run test/web/projects.test.tsx`

Expected: FAIL because native input/select/textarea/checkbox elements lack the UI primitive slots.

- [ ] **Step 3: Migrate project and integration controls**

Replace text/number/password inputs with `Input`, instructions with `Textarea`, Agent plugin with the Select composition, and booleans with `Checkbox`. Preserve `aria-describedby`, `required`, password autocomplete behavior, controlled values, numeric conversion, array editing, inline field-error placement, and save-feedback placement.

For the controlled Agent select:

```tsx
<Select value={project.agentPlugin} onValueChange={(agentPlugin) => setProject((current) => ({ ...current, agentPlugin }))}>
  <SelectTrigger aria-label="Agent 插件"><SelectValue /></SelectTrigger>
  <SelectContent>
    <SelectItem value="codex">Codex</SelectItem>
    {project.agentPlugin !== "codex" ? <SelectItem value={project.agentPlugin}>{project.agentPlugin}</SelectItem> : null}
  </SelectContent>
</Select>
```

Checkbox labels must keep their visible text and use `checked={...}` plus `onCheckedChange={(checked) => ... Boolean(checked)}`.

- [ ] **Step 4: Run project and shell tests and verify GREEN**

Run: `pnpm --filter @oh-my-bug/desktop exec vitest run test/web/projects.test.tsx test/web/app-shell.test.tsx`

Expected: PASS with existing values, validation, credential handling, and save feedback unchanged.

- [ ] **Step 5: Commit project settings migration**

```bash
git add apps/desktop/src/web/projects/project-form.tsx apps/desktop/src/web/projects/integration-fields.tsx apps/desktop/test/web/projects.test.tsx
git commit -m "refactor(desktop): migrate project controls to shadcn"
```

### Task 5: Migrate New Issue and command dialogs

**Files:**
- Create: `apps/desktop/src/web/dialogs/new-issue-dialog.tsx`
- Create: `apps/desktop/src/web/command/command-menu.tsx`
- Modify: `apps/desktop/src/web/app.tsx`
- Modify: `apps/desktop/test/web/keyboard.test.tsx`
- Modify: `apps/desktop/test/web/app-workbench.test.tsx`

**Interfaces:**
- Consumes: `Dialog*`, `Tooltip*`, `Button`, `Input`, `Textarea`, `Select*`, `useTheme`, existing `ProjectDto`, `IssueDto`, and API callbacks.
- Produces: `NewIssueDialog({ open, trigger, projects, onOpenChange, onCreated })` and `CommandMenu({ open, canCreateIssue, onOpenChange, onNavigate, onNewIssue })`; removes the two inline dialog implementations from `app.tsx`.

- [ ] **Step 1: Add failing focus, close, and form regression tests**

Add to `keyboard.test.tsx`:

```tsx
const createTrigger = screen.getByRole("button", { name: "新建 Issue" });
fireEvent.click(createTrigger);
expect(screen.getByRole("dialog", { name: "新建 Issue" })).toHaveAttribute("data-slot", "dialog-content");
fireEvent.keyDown(document, { key: "Escape" });
expect(createTrigger).toHaveFocus();
```

In `app-workbench.test.tsx`, retain project selection and creation assertions, and assert `项目` is a shadcn Select trigger, summary is an `Input`, and content is a `Textarea`.

- [ ] **Step 2: Run dialog-facing tests and verify RED**

Run: `pnpm --filter @oh-my-bug/desktop exec vitest run test/web/keyboard.test.tsx test/web/app-workbench.test.tsx`

Expected: FAIL because the hand-built modals do not use Base UI Dialog or shadcn form slots and do not restore focus reliably.

- [ ] **Step 3: Extract and migrate New Issue**

Use a controlled Base UI Dialog. Accept `trigger?: React.ReactElement` and pass it through `DialogTrigger render={trigger}` so clicking the sidebar action restores focus to that action after close; keyboard and command-menu openings continue to use the controlled `open` prop. Preserve project initialization, validation, API error wording, busy state, and `onCreated` behavior. The close icon uses `Button size="icon-sm" variant="ghost"`, `aria-label="关闭"`, and a Tooltip. The cancel button uses `DialogClose render={<Button variant="outline" />}`. The form submit button remains the only primary action.

The component owns its existing `projectId`, `summary`, `content`, `busy`, and `error` state, resetting transient values only when the dialog is newly opened or successfully created.

- [ ] **Step 4: Extract and migrate the command menu**

Use a controlled Dialog with its existing `Cmd/Ctrl + K` behavior and safe navigation/theme actions. Render command rows as full-width ghost Buttons. Preserve the rule that no approval action appears. Close through `onOpenChange(false)` after navigation, Issue creation, or a theme choice.

Mount one `TooltipProvider` around `AppContent`, then replace the inline components with imports from the new focused files.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `pnpm --filter @oh-my-bug/desktop exec vitest run test/web/keyboard.test.tsx test/web/app-workbench.test.tsx test/web/app-shell.test.tsx`

Expected: PASS with Escape handling, focus restoration, creation, navigation, and themes intact.

- [ ] **Step 6: Commit dialog migration**

```bash
git add apps/desktop/src/web/dialogs/new-issue-dialog.tsx apps/desktop/src/web/command/command-menu.tsx apps/desktop/src/web/app.tsx apps/desktop/test/web/keyboard.test.tsx apps/desktop/test/web/app-workbench.test.tsx
git commit -m "refactor(desktop): migrate dialogs to shadcn"
```

### Task 6: Migrate application shell and project actions

**Files:**
- Create: `apps/desktop/src/web/issues/issue-status.tsx`
- Modify: `apps/desktop/src/web/app.tsx`
- Modify: `apps/desktop/test/web/app-shell.test.tsx`
- Modify: `apps/desktop/test/web/app-workbench.test.tsx`

**Interfaces:**
- Consumes: `Button`, `Badge`, `Separator`, and `Tooltip` primitives.
- Produces: unchanged route and project-selection behavior with shadcn buttons for all shell/project actions; `IssueStatusBadge({ status, label? })` shared by list and detail views.

- [ ] **Step 1: Add failing shell slot assertions**

```tsx
expect(await screen.findByRole("button", { name: "打开项目目录" })).toHaveAttribute("data-slot", "button");
expect(screen.getByRole("button", { name: "高级：手动输入路径" })).toHaveAttribute("data-slot", "button");
```

For a populated fixture, assert New Issue, filter, project shortcut, Issue row, project card, and back action expose the Button slot while preserving their accessible names and `aria-current` state.

- [ ] **Step 2: Run shell tests and verify RED**

Run: `pnpm --filter @oh-my-bug/desktop exec vitest run test/web/app-shell.test.tsx test/web/app-workbench.test.tsx`

Expected: FAIL because shell actions still render native buttons directly.

- [ ] **Step 3: Migrate shell and project actions**

Replace direct native buttons with `Button` while keeping product layout classes through `className`. Use variants intentionally: accent for New Issue/open directory, ghost for navigation rows and filter/back actions, secondary for manual entry, and ghost plus full-width alignment for project/Issue rows.

Create `issues/issue-status.tsx` with a single stable mapping and composite:

```tsx
const statusVariants: Record<IssueDto["status"], BadgeVariant> = {
  RECEIVED: "neutral",
  ASSESSING: "default",
  ASSESSMENT_REVIEW: "review",
  ASSESSMENT_FAILED: "destructive",
  REPAIRING: "default",
  EVIDENCE_CHECK: "default",
  REPAIR_FAILED: "destructive",
  ACCEPTANCE_REVIEW: "review",
  CLOSED: "success",
  CANCELED: "neutral",
};

export function IssueStatusBadge({ status, label = status }: { status: IssueDto["status"]; label?: string }) {
  return <Badge variant={statusVariants[status]}>{label}</Badge>;
}
```

Import `Badge` and `BadgeVariant` from `components/ui/badge`. Use the composite anywhere current status text uses `status-*`; pass the existing Chinese `stateLabels[status]` in the Issue list and retain the current enum label in detail so this refactor does not change product wording. Do not turn project metadata or ordinary labels into badges.

Navigation anchors remain anchors because they carry routes. Continue to use `aria-current`; do not wrap anchors in buttons.

- [ ] **Step 4: Run shell and route tests and verify GREEN**

Run: `pnpm --filter @oh-my-bug/desktop exec vitest run test/web/app-shell.test.tsx test/web/app-workbench.test.tsx test/web/keyboard.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit shell migration**

```bash
git add apps/desktop/src/web/app.tsx apps/desktop/src/web/issues/issue-status.tsx apps/desktop/test/web/app-shell.test.tsx apps/desktop/test/web/app-workbench.test.tsx
git commit -m "refactor(desktop): migrate shell actions to shadcn"
```

### Task 7: Migrate Issue activity, recovery, and approval controls

**Files:**
- Modify: `apps/desktop/src/web/issues/agent-activity.tsx`
- Modify: `apps/desktop/src/web/issues/approval-panel.tsx`
- Modify: `apps/desktop/src/web/issues/issue-detail.tsx`
- Modify: `apps/desktop/test/web/agent-activity.test.tsx`
- Modify: `apps/desktop/test/web/approval-panel.test.tsx`
- Modify: `apps/desktop/test/web/issues.test.tsx`

**Interfaces:**
- Consumes: `Button`, `Input`, `Textarea`, `Alert`, `Separator`, `Tooltip`, and `IssueStatusBadge` from Task 6.
- Produces: unchanged approval payloads, retry/cancel/rebuild callbacks, and activity expansion behavior with no direct feature-level native controls.

- [ ] **Step 1: Add failing primitive and error assertions**

Keep every existing callback/payload assertion, then add:

```tsx
expect(screen.getByLabelText("修改意见（可选）")).toHaveAttribute("data-slot", "textarea");
expect(screen.getByRole("button", { name: "确认是 Bug 并开始修复" })).toHaveAttribute("data-slot", "button");
```

For retry/cancel/rebuild failures, reject the callback and assert a destructive `Alert` remains visible beside the relevant action without hiding the action. For Agent activity, assert the expansion action is a Button and retains `aria-expanded`.

- [ ] **Step 2: Run Issue-facing tests and verify RED**

Run: `pnpm --filter @oh-my-bug/desktop exec vitest run test/web/agent-activity.test.tsx test/web/approval-panel.test.tsx test/web/issues.test.tsx`

Expected: FAIL because Issue features render native form controls/buttons and plain error paragraphs.

- [ ] **Step 3: Migrate approval and recovery controls**

Replace approval title/duplicate fields with `Input`, feedback with `Textarea`, actions with Button variants, and async error output with destructive `Alert`. Preserve the exact revision/hash payload and existing explicit approval labels.

Replace retry/cancel/rebuild actions with secondary Buttons and their failures with Alerts. Keep state-specific sections product-owned and keep cancel neutral unless its semantics become destructive in a separate approved change.

Replace the Agent activity expansion control with a full-width ghost Button. If the chevron is the only visible affordance at a narrow width, wrap it with the existing textual button label rather than adding an icon-only control.

- [ ] **Step 4: Migrate Issue status presentation**

Use `IssueStatusBadge` from Task 6 for Issue detail status. Keep failures, progress, review, success, and neutral mappings consistent between list and detail; text remains present so color is never the only signal.

- [ ] **Step 5: Run Issue and workflow tests and verify GREEN**

Run: `pnpm --filter @oh-my-bug/desktop exec vitest run test/web/agent-activity.test.tsx test/web/approval-panel.test.tsx test/web/issues.test.tsx test/web/app-workbench.test.tsx`

Expected: PASS with all payloads and workflow actions unchanged.

- [ ] **Step 6: Commit Issue migration**

```bash
git add apps/desktop/src/web/issues apps/desktop/test/web/agent-activity.test.tsx apps/desktop/test/web/approval-panel.test.tsx apps/desktop/test/web/issues.test.tsx
git commit -m "refactor(desktop): migrate issue controls to shadcn"
```

### Task 8: Enforce the boundary and remove obsolete primitive CSS

**Files:**
- Create: `apps/desktop/test/architecture/shadcn-boundary.test.ts`
- Modify: `apps/desktop/src/web/styles/global.css`
- Modify: `apps/desktop/src/web/styles/tokens.css`

**Interfaces:**
- Consumes: all migrated feature files and checked-in UI primitives from Tasks 1–7.
- Produces: a regression boundary forbidding direct feature-level button/input/select/textarea elements and obsolete generic control classes.

- [ ] **Step 1: Write the failing architecture test**

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const featureFiles = [
  "src/web/app.tsx",
  "src/web/command/command-menu.tsx",
  "src/web/dialogs/new-issue-dialog.tsx",
  "src/web/issues/agent-activity.tsx",
  "src/web/issues/approval-panel.tsx",
  "src/web/issues/issue-detail.tsx",
  "src/web/projects/integration-fields.tsx",
  "src/web/projects/project-form.tsx",
  "src/web/settings/theme-selector.tsx",
];

it("keeps reusable native controls behind checked-in UI primitives", () => {
  for (const file of featureFiles) {
    const source = readFileSync(resolve(import.meta.dirname, "../..", file), "utf8");
    expect(source, file).not.toMatch(/<(button|input|select|textarea)(?:\s|>)/);
  }
});

it("does not restore legacy generic control classes", () => {
  const source = readFileSync(resolve(import.meta.dirname, "../../src/web/styles/global.css"), "utf8");
  expect(source).not.toMatch(/\.(primary-button|secondary-button|icon-button|modal-backdrop)\b/);
});
```

- [ ] **Step 2: Run the boundary test and verify RED**

Run: `pnpm --filter @oh-my-bug/desktop exec vitest run test/architecture/shadcn-boundary.test.ts`

Expected: FAIL while any remaining feature-level native control or legacy generic primitive class exists.

- [ ] **Step 3: Remove the proven-dead primitive rules**

Use `rg` to confirm each selector has no TSX consumer, then remove only:

- generic `input`, `select`, and `textarea` visual/focus rules now owned by primitives;
- `.primary-button`, `.secondary-button`, and `.icon-button` rules;
- hand-built `.modal-backdrop` and generic `.modal` behavior rules now owned by Dialog;
- duplicated generic button focus/disabled/hover rules.

Retain product layout selectors such as `.new-issue`, `.nav-item`, `.issue-row`, `.project-card`, `.approval-panel`, `.report-card`, `.command-menu`, and `.settings-card` when they still describe product structure. Move any necessary layout-only declaration off a removed generic class and onto the consuming product selector.

- [ ] **Step 4: Complete missing tooltips and native-control migration**

Run:

```bash
rg -n '<(button|input|select|textarea)(\s|>)' apps/desktop/src/web -g '*.tsx' -g '!components/ui/**'
rg -n 'primary-button|secondary-button|icon-button|modal-backdrop' apps/desktop/src/web
```

Expected: no output. If an icon-only UI primitive remains, add an accessible Tooltip composition and a focused interaction assertion before removing the final legacy selector.

- [ ] **Step 5: Run boundary and complete web tests**

Run: `pnpm --filter @oh-my-bug/desktop exec vitest run test/architecture/shadcn-boundary.test.ts`

Run: `pnpm --filter @oh-my-bug/desktop test`

Expected: all PASS with no act, accessibility, or portal cleanup warnings.

- [ ] **Step 6: Commit the boundary and CSS cleanup**

```bash
git add apps/desktop/test/architecture/shadcn-boundary.test.ts apps/desktop/src/web/styles/global.css apps/desktop/src/web/styles/tokens.css
git commit -m "refactor(desktop): enforce shadcn interaction boundary"
```

### Task 9: Verify and visually accept the complete migration

**Files:**
- Modify: `apps/desktop/test/electron/e2e/first-project.spec.ts`
- Modify: `apps/desktop/test/electron/e2e/manual-workflow.spec.ts`
- Generate locally (Git-ignored): `.acceptance/2026-08-21-shadcn-theme-migration/acceptance-report.md`
- Generate locally (Git-ignored): `.acceptance/2026-08-21-shadcn-theme-migration/dark-issues.png`
- Generate locally (Git-ignored): `.acceptance/2026-08-21-shadcn-theme-migration/light-settings.png`
- Generate locally (Git-ignored): `.acceptance/2026-08-21-shadcn-theme-migration/dark-projects.png`
- Generate locally (Git-ignored): `.acceptance/2026-08-21-shadcn-theme-migration/light-dialog.png`

**Interfaces:**
- Consumes: the complete theme plan and Tasks 1–8.
- Produces: packaged workflow regressions and fresh visual acceptance evidence against `DESIGN.md`.

- [ ] **Step 1: Extend packaged regressions for migrated controls**

In `first-project.spec.ts`, retain the directory, tab, integration, and save flow, and assert the project text controls expose shadcn slots. In `manual-workflow.spec.ts`, retain the full two-gate flow and add focus restoration after closing/reopening New Issue plus the unchanged explicit approval labels.

```ts
await expect(desktop.page.getByLabel("项目名称")).toHaveAttribute("data-slot", "input");
await expect(desktop.page.getByRole("button", { name: "保存项目" })).toHaveAttribute("data-slot", "button");
```

- [ ] **Step 2: Run focused packaged regressions**

Run: `pnpm build:desktop && pnpm package`

Run: `pnpm test:e2e:electron -- apps/desktop/test/electron/e2e/theme.spec.ts apps/desktop/test/electron/e2e/first-project.spec.ts apps/desktop/test/electron/e2e/manual-workflow.spec.ts`

Expected: all PASS.

- [ ] **Step 3: Run fresh engineering verification**

Invoke `verification-before-completion`, then run:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm package
git diff --check
```

Expected: every command exits 0 with no new warnings or unhandled renderer errors.

- [ ] **Step 4: Run user-observable acceptance**

Invoke `acceptance` after the fresh verification. Exercise the packaged Electron app at a standard desktop width and below 720px in both dark and light themes. Inspect Issues, project settings, Settings appearance, New Issue, command menu, Assessment approval, and Delivery approval.

Capture the four named screenshots and write `acceptance-report.md` with:

- exact build/package tested;
- routes and theme preference used for each capture;
- keyboard focus, Escape close, focus restoration, and system-theme observations;
- density, contrast, overflow, and reduced-motion observations against `DESIGN.md`;
- any deliberately retained product-specific control composite and why it is not a generic primitive.

- [ ] **Step 5: Commit regression tests and retain local acceptance evidence**

```bash
git add apps/desktop/test/electron/e2e/first-project.spec.ts apps/desktop/test/electron/e2e/manual-workflow.spec.ts
git commit -m "test(desktop): accept shadcn and theme migration"
```

The `.acceptance` directory is intentionally Git-ignored. Report its absolute paths in the completion handoff instead of forcing ignored binary evidence into Git.

## Final Completion

The implementation is complete only when:

- theme preference supports `system`, `light`, and `dark` before React startup;
- every current reusable interaction uses a checked-in primitive or documented product composite;
- no feature-level direct button/input/select/textarea remains;
- obsolete generic primitive CSS is gone;
- existing workflow payloads, error placement, keyboard behavior, and IPC remain unchanged;
- all engineering verification and packaged tests pass;
- dark/light acceptance evidence has been inspected and recorded.
