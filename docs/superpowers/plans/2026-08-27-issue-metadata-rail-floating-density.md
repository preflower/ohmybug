# Issue Metadata Rail Floating Density Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the Issue metadata card visually floating at every width, reserve a dedicated 280px column on wide screens, overlay it on narrower screens, and reduce metadata-row vertical spacing.

**Architecture:** The existing workspace grid already reserves a 280px rail column above the 1200px breakpoint and switches the rail to absolute positioning at 1200px and below. Move elevation, height constraint, and scrolling into the base card rules so both layout modes share one floating treatment; keep only width and inset overrides in responsive blocks. Tighten the existing metadata list without changing markup or content.

**Tech Stack:** React 19, TypeScript, CSS design tokens, Vitest, Testing Library, Vite, in-app Browser runtime validation.

---

## File map

- Modify `apps/desktop/test/web/project-settings-layout.test.ts`: lock the wide dedicated column, base floating-card treatment, compact metadata spacing, and narrow overlay widths.
- Modify `apps/desktop/src/web/styles/global.css`: move floating presentation to the base rail/card rules and tighten metadata row spacing.
- Create transient screenshots under `.artifacts/visual-diff/issue-metadata-rail-floating-density/`; keep them uncommitted.

### Task 1: Lock the persistent floating-card and density contracts

**Files:**
- Modify: `apps/desktop/test/web/project-settings-layout.test.ts:39-67`
- Test: `apps/desktop/test/web/project-settings-layout.test.ts`

- [ ] **Step 1: Replace breakpoint-only elevation assertions with base-card assertions**

Inside `locks the inset Issue metadata card rules`, add the base rail, card, and row contracts:

```ts
const rail = cssRule("\\.issue-metadata-rail");
const card = cssRule("\\.issue-metadata-card");
const metadataRow = cssRule("\\.issue-metadata-list > div");

expect(rail).toMatch(/overflow:\s*visible;/);
expect(rail).toMatch(/background:\s*transparent;/);
expect(rail).toMatch(/padding:\s*12px;/);
expect(rail).toMatch(/box-shadow:\s*none;/);
expect(card).toMatch(/max-height:\s*100%;/);
expect(card).toMatch(/overflow:\s*auto;/);
expect(card).toMatch(/box-shadow:\s*0 1px 3px rgb\(0 0 0 \/ 8%\),\s*0 10px 28px rgb\(0 0 0 \/ 10%\);/);
expect(metadataRow).toMatch(/gap:\s*6px;/);
expect(metadataRow).toMatch(/padding:\s*16px 0;/);
```

Keep the existing wide workspace assertion:

```ts
expect(styles).toMatch(/\.workspace\.metadata-open\s*\{[^}]*grid-template-columns:\s*320px minmax\(0,\s*1fr\) 280px;/s);
```

Remove the overlay-block expectation that repeats the card shadow; the base card rule now proves elevation at both wide and overlay widths. Keep the responsive width assertions for `280px` and `260px`.

- [ ] **Step 2: Run the focused CSS test and verify RED**

Run:

```bash
pnpm --dir apps/desktop exec vitest run --config vitest.config.ts test/web/project-settings-layout.test.ts -t "locks the inset Issue metadata card rules"
```

Expected: FAIL because the base rail is still canvas-backed and scrollable, the base card has no elevation or height constraint, and metadata rows still use an `8px` gap with `22px` vertical padding.

- [ ] **Step 3: Commit the failing contract**

```bash
git add apps/desktop/test/web/project-settings-layout.test.ts
git commit -m "test: define persistent floating Issue rail"
```

### Task 2: Apply the shared floating treatment and compact spacing

**Files:**
- Modify: `apps/desktop/src/web/styles/global.css:672-710`
- Modify: `apps/desktop/src/web/styles/global.css:820-840`
- Modify: `apps/desktop/src/web/styles/global.css:3905-3935`
- Test: `apps/desktop/test/web/project-settings-layout.test.ts`
- Test: `apps/desktop/test/web/app-workbench.test.tsx`

- [ ] **Step 1: Make the base rail a transparent, shadow-safe layout boundary**

Replace the base rail rule with:

```css
.issue-metadata-rail {
  box-sizing: border-box;
  min-width: 0;
  min-height: 0;
  overflow: visible;
  background: transparent;
  padding: 12px;
  box-shadow: none;
}
```

- [ ] **Step 2: Make the base card own elevation, height, and scrolling**

Update the base card rule to:

```css
.issue-metadata-card {
  max-height: 100%;
  min-width: 0;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  box-shadow: 0 1px 3px rgb(0 0 0 / 8%), 0 10px 28px rgb(0 0 0 / 10%);
}
```

This preserves rounded clipping and makes the card, rather than the transparent outer rail, own scrolling when the viewport is short.

- [ ] **Step 3: Tighten metadata row spacing**

Update the row rule to:

```css
.issue-metadata-list > div {
  display: grid;
  gap: 6px;
  border-bottom: 1px solid var(--border);
  padding: 16px 0;
}
```

- [ ] **Step 4: Remove duplicated card treatment from responsive blocks**

Keep the phone rail override limited to its bounded width and inset:

```css
@media (max-width: 680px) {
  .issue-metadata-rail {
    width: min(260px, calc(100% - 40px));
    padding: 10px;
  }
}
```

Keep the `681px`–`1200px` rail absolutely positioned with its existing `280px` width and `12px` inset, but remove duplicated `overflow`, `background`, `box-shadow`, and `.issue-metadata-card` declarations already supplied by the base rules.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
pnpm --dir apps/desktop exec vitest run --config vitest.config.ts test/web/project-settings-layout.test.ts test/web/app-workbench.test.tsx
```

Expected: both files PASS, with 50 tests passing.

- [ ] **Step 6: Commit the implementation**

```bash
git add apps/desktop/src/web/styles/global.css
git commit -m "style: keep Issue metadata card floating"
```

### Task 3: Validate wide reflow, narrow overlay, and complete regression safety

**Files:**
- Create transient: `.artifacts/visual-diff/issue-metadata-rail-floating-density/wide-column.png`
- Create transient: `.artifacts/visual-diff/issue-metadata-rail-floating-density/phone-overlay.png`
- Create transient: `.artifacts/visual-diff/issue-metadata-rail-floating-density/metrics.json`

- [ ] **Step 1: Capture the wide dedicated-column state**

At a deterministic `1440×900` viewport with OHMYBUG-30 selected and the metadata card open, save `wide-column.png` and record computed styles for `.workspace`, `.detail-pane`, `.issue-metadata-rail`, and `.issue-metadata-card`.

Expected:

- the workspace has a dedicated `280px` final grid column;
- the card does not overlap the Issue detail;
- the rail is transparent and shadowless;
- the card owns the natural two-layer shadow;
- metadata rows compute to `16px` top and bottom padding with a `6px` gap.

- [ ] **Step 2: Capture the narrow overlay state**

At `566×753`, save `phone-overlay.png` with the same Issue and card open.

Expected:

- rail width remains `260px` with `10px` inset;
- the card overlays the detail rather than compressing it;
- the same card-owned shadow remains visible and unclipped;
- all six metadata fields and the Terminal action remain present;
- the shorter row spacing visibly reduces card height without changing content.

- [ ] **Step 3: Run desktop typecheck**

```bash
pnpm --filter @oh-my-bug/desktop typecheck
```

Expected: exit code `0`.

- [ ] **Step 4: Run the complete desktop test suite serially**

```bash
pnpm --filter @oh-my-bug/desktop test
```

Expected: 41 test files and 315 tests PASS. Run this serially after typecheck to avoid the known favicon test timeout under concurrent CPU load.

- [ ] **Step 5: Verify the committed state**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors and no uncommitted product changes; `.artifacts/` remains ignored.

