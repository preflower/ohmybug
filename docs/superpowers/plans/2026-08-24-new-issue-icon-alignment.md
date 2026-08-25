# New Issue Icon Alignment Implementation Plan

> **For agentic workers:** Implement this plan task-by-task using test-driven development. Do not perform Git operations for this Oh My Bug repair stage.

**Goal:** Right-align the plus icon in the expanded “新建 Issue” sidebar button without changing its centered collapsed state.

**Architecture:** Preserve the existing React structure and responsive breakpoint. Express the layout change in the component's existing CSS rule, lock both rules in a focused unit test, and verify geometry through the real packaged Electron runtime.

**Tech Stack:** React 19, CSS, Playwright, Vitest, TypeScript, Vite

---

### Task 1: Lock the responsive button layout

**Files:**
- Create: `apps/desktop/test/web/sidebar-layout.test.ts`
- Create: `apps/desktop/test/electron/e2e/sidebar-layout.spec.ts`

- [ ] **Step 1: Write the failing browser regression test**

Add a stylesheet test that requires `space-between` for the expanded button and `center` inside the existing 980px media query. Add a packaged-Electron test that creates a real temporary project, measures the rendered button and icon, and captures the desktop acceptance screenshot.

- [ ] **Step 2: Verify the test fails for the missing desktop alignment**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/web/sidebar-layout.test.ts
```

Expected: the stylesheet assertion fails because `.new-issue` currently uses `justify-content: flex-start`.

### Task 2: Implement the minimal layout change

**Files:**
- Modify: `apps/desktop/src/web/styles/global.css`

- [ ] **Step 1: Change the expanded alignment**

Replace:

```css
justify-content: flex-start;
```

with:

```css
justify-content: space-between;
```

inside `.new-issue`. Do not change the existing `@media (max-width: 980px)` override:

```css
.new-issue {
  justify-content: center;
  padding: 0;
}
```

- [ ] **Step 2: Verify the regression test passes**

Run the focused Vitest command from Task 1 and expect one passing test.

### Task 3: Verify and capture acceptance evidence

**Files:**
- Create: `.oh-my-bug-tmp-evidence-ULqFs4/new-issue-icon-right-aligned.png`

- [ ] **Step 1: Run focused and repository checks**

Run:

```bash
pnpm --filter @oh-my-bug/desktop test
pnpm --filter @oh-my-bug/desktop typecheck
pnpm build:web
env -u OMB_RENDERER_URL -u OMB_VITE_DEV OH_MY_BUG_EVIDENCE_DIR="$PWD/.oh-my-bug-tmp-evidence-ULqFs4" pnpm exec playwright test -c apps/desktop/playwright.config.ts sidebar-layout.spec.ts
```

Expected: every command exits successfully with zero failures.

- [ ] **Step 2: Capture the real rendered acceptance state**

Use the packaged Electron application with its real Runtime, create a temporary local project, verify expanded right-edge and collapsed centering geometry, and save a screenshot to the evidence path above.
