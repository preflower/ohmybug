# Project Settings Switch Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify Project Integration Boolean controls on the existing shadcn-style Switch and make the thumb color consistent across light and dark themes.

**Architecture:** Keep one reusable Base UI Switch wrapper as the control boundary. Project settings consume that wrapper directly, while semantic theme tokens own all colors and the surrounding project form owns only layout.

**Tech Stack:** React 19, TypeScript, Base UI Switch, Tailwind CSS, Vitest, Testing Library, Playwright

---

### Task 1: Specify the unified Switch contract

**Files:**
- Modify: `apps/desktop/test/web/ui-primitives.test.tsx`
- Modify: `apps/desktop/test/web/projects.test.tsx`

- [ ] **Step 1: Write the failing primitive test**

Add an assertion that the shared Switch thumb carries `bg-primary-foreground`.

```tsx
const thumb = checked.querySelector('[data-slot="switch-thumb"]');
expect(thumb).toHaveClass("bg-primary-foreground");
```

- [ ] **Step 2: Write the failing Project settings test**

Replace the Integration enable Checkbox expectation with the shared Switch contract.

```tsx
const enabled = screen.getByRole("switch", { name: "启用" });
expect(enabled).toHaveAttribute("data-slot", "switch");
expect(enabled).not.toHaveClass("integration-enabled-toggle");
```

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/web/ui-primitives.test.tsx test/web/projects.test.tsx
```

Expected: FAIL because the thumb still uses `bg-[var(--surface)]` and the Integration enabled control still has checkbox semantics.

### Task 2: Use the shared Switch everywhere

**Files:**
- Modify: `apps/desktop/src/web/components/ui/switch.tsx`
- Modify: `apps/desktop/src/web/projects/project-form.tsx`
- Modify: `apps/desktop/src/web/styles/global.css`
- Modify: `test/e2e/projects.spec.ts`

- [ ] **Step 1: Update the shared thumb token**

Change the thumb class from `bg-[var(--surface)]` to `bg-primary-foreground`, preserving all geometry and transitions.

- [ ] **Step 2: Replace the custom Integration toggle**

Import `Switch` in `project-form.tsx`, render it for `aria-label="启用"`, and preserve the existing `checked`, `disabled`, and `onCheckedChange` behavior.

- [ ] **Step 3: Remove obsolete custom CSS**

Delete `.integration-enabled-toggle` and its checked, indicator, pseudo-element, and transform rules. Keep `.integration-heading > .switch-row` unchanged.

- [ ] **Step 4: Update browser acceptance roles**

Change `getByRole("checkbox", { name: "启用" })` to `getByRole("switch", { name: "启用" })` in `test/e2e/projects.spec.ts`.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/web/ui-primitives.test.tsx test/web/projects.test.tsx
```

Expected: PASS with no failures.

### Task 3: Verify integration and themes

**Files:**
- Verify: `apps/desktop/src/web/components/ui/switch.tsx`
- Verify: `apps/desktop/src/web/projects/project-form.tsx`
- Verify: `apps/desktop/src/web/styles/global.css`

- [ ] **Step 1: Run TypeScript checking**

Run:

```bash
pnpm --filter @oh-my-bug/desktop typecheck
```

Expected: exit code 0.

- [ ] **Step 2: Run the focused browser acceptance**

Run:

```bash
pnpm exec playwright test test/e2e/projects.spec.ts --grep "DingTalk|Sentry|narrow project settings"
```

Expected: all selected tests pass.

- [ ] **Step 3: Inspect both themes in the local browser**

Verify that the Integration enabled and manifest Boolean Switches both report `36px × 20px`, use the same unchecked and checked track tokens, and show a near-white thumb in dark and light themes.

