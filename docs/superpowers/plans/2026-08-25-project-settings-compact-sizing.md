# Project Settings Compact Sizing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the entire project settings experience, including DingTalk, to Oh My Bug ?!'s compact desktop product scale.

**Architecture:** Keep the existing vertical-tab settings structure and responsive breakpoint. Correct the regression in the shared project-settings and integration CSS, with one sizing vocabulary for Project, Agent, Commands, Sentry, and DingTalk. Lock the contract in source-level tests and in the real browser acceptance test that already exercises DingTalk settings.

**Tech Stack:** React, CSS, Vitest, Playwright

---

### Task 1: Lock the compact sizing contract

**Files:**
- Modify: `apps/desktop/test/web/project-settings-layout.test.ts`
- Modify: `test/e2e/projects.spec.ts`

- [x] **Step 1: Write the failing source-level regression test**

Assert the shared layout uses a `240px` rail, `38px` navigation rows, a `54px` footer, `30px` footer buttons, a `20px` integration title, and `32px` integration inputs.

- [x] **Step 2: Run the source-level test to verify it fails**

Run: `pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/web/project-settings-layout.test.ts`

Expected: FAIL because the current CSS still contains the oversized `329px`, `60px`, `108px`, `56px`, `34px`, and `50px` values.

- [x] **Step 3: Update the real browser visual contract**

Change the existing DingTalk acceptance metrics to:

```ts
expect(visualContract).toEqual({
  navRowHeight: 38,
  titleSize: 20,
  inputHeight: 32,
  footerHeight: 54,
});
```

### Task 2: Restore the shared compact scale

**Files:**
- Modify: `apps/desktop/src/web/styles/global.css`

- [x] **Step 1: Compact the shared project settings chrome**

Use the established project scale: `240px` navigation rail, `38px` rows, `13px` navigation text, `16px` icons, a `54px` footer, `11px` save status, and `30px` buttons.

- [x] **Step 2: Compact integration content without a DingTalk exception**

Use a `20px` integration title, `13px` description, `38px × 22px` enable switch, `16px` section titles, `12px` supporting copy, `32px` inputs, and `30px` buttons. Preserve the existing information hierarchy, responsive reflow, active states, validation, and secret handling.

- [x] **Step 3: Run the focused unit test to verify it passes**

Run: `pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/web/project-settings-layout.test.ts`

Expected: PASS.

### Task 3: Verify the real UI and integration

**Files:**
- Evidence: `.oh-my-bug-tmp-evidence-1vK2RY/project-settings-compact.png`

- [x] **Step 1: Run desktop web tests and typecheck**

Run: `pnpm --filter @oh-my-bug/desktop test && pnpm --filter @oh-my-bug/desktop typecheck`

Expected: all tests pass and TypeScript exits successfully.

- [x] **Step 2: Run the DingTalk browser acceptance**

Run: `pnpm exec playwright test test/e2e/projects.spec.ts --grep "renders streamlined DingTalk settings with one save action"`

Expected: PASS with compact measured dimensions and a real browser screenshot.

- [x] **Step 3: Preserve the acceptance screenshot as Issue evidence**

Copy the Playwright-produced `.artifacts/visual-diff/dingtalk-settings/actual.png` to `.oh-my-bug-tmp-evidence-1vK2RY/project-settings-compact.png`.

- [x] **Step 4: Commit the integrated change**

```bash
git add apps/desktop/src/web/styles/global.css \
  apps/desktop/test/web/project-settings-layout.test.ts \
  test/e2e/projects.spec.ts \
  docs/superpowers/plans/2026-08-25-project-settings-compact-sizing.md
git commit -m "fix(desktop): restore compact project settings scale"
```
