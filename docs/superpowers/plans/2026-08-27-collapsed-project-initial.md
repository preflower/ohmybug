# Collapsed Project Initial Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each project shortcut readable in the 48px collapsed sidebar by showing a compact project initial.

**Architecture:** Derive the display label and initial in the existing project navigation render path. Keep both expanded and collapsed representations in the button, then switch their visibility at the existing 980px responsive breakpoint. Preserve the full label through `aria-label` and `title`.

**Tech Stack:** React 19, TypeScript, CSS, Vitest, Testing Library

---

### Task 1: Add and verify the collapsed project marker

**Files:**
- Modify: `apps/desktop/src/web/app.tsx`
- Modify: `apps/desktop/src/web/styles/global.css`
- Test: `apps/desktop/test/web/app-shell.test.tsx`
- Test: `apps/desktop/test/web/project-settings-layout.test.ts`

- [ ] **Step 1: Write failing component and CSS contract tests**

Render a named project, then assert that its shortcut exposes the complete label and title while containing `M` in `.project-initial`. Assert that the base stylesheet hides `.project-initial` and the collapsed media query shows it while hiding `.project-dot` and `.project-name`.

- [ ] **Step 2: Run the focused tests and verify the new assertions fail**

Run: `pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/web/app-shell.test.tsx test/web/project-settings-layout.test.ts`

Expected: FAIL because the project initial markup and responsive rules do not exist.

- [ ] **Step 3: Add the minimal initial markup and responsive CSS**

Derive the label from `project.name ?? project.key`, trim it, uppercase the first character, and render it in `.project-initial`. Add `.project-name` to the full label. Keep the initial hidden by default and reveal it only inside the existing collapsed-sidebar media query.

- [ ] **Step 4: Run focused and full desktop verification**

Run the focused test command again, followed by `pnpm --filter @oh-my-bug/desktop test`, `pnpm --filter @oh-my-bug/desktop typecheck`, and `pnpm --filter @oh-my-bug/desktop build:web`.

Expected: all commands exit successfully with zero failed tests or type errors.

- [ ] **Step 5: Commit the implementation**

Commit the source, styles, and regression tests with message `fix: identify projects in collapsed sidebar`.

