# Issue Detail Unified Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the Issue document, metadata rail, and action footer in one layout container so the footer spans the complete Issue detail surface while the metadata card still reserves width on wide screens and overlays only the document on narrow screens.

**Architecture:** `App` keeps metadata state and creates the rail, then passes it to `IssueDetail` as a composition slot. `IssueDetail` becomes a two-row grid whose first row holds the document and optional rail and whose second row holds `IssueActions`; a small internal action track keeps controls aligned to the document column while the footer surface spans both columns.

**Tech Stack:** React 19, TypeScript, CSS Grid, Vitest, Testing Library, Vite.

---

## File map

- Modify `apps/desktop/test/web/app-workbench.test.tsx`: prove the document, metadata rail, and action footer share the same Issue detail article.
- Modify `apps/desktop/test/web/project-settings-layout.test.ts`: lock the two-column workspace, nested Issue-detail grid, spanning footer, and narrow shared-cell overlay.
- Modify `apps/desktop/src/web/app.tsx`: pass the metadata rail into `IssueDetail` instead of rendering it as a workspace sibling.
- Modify `apps/desktop/src/web/issues/issue-detail.tsx`: accept and place the metadata rail between the document and action footer.
- Modify `apps/desktop/src/web/issues/issue-actions.tsx`: add one content track inside the spanning footer.
- Modify `apps/desktop/src/web/styles/global.css`: move the 280px track into the Issue detail grid and make the narrow rail share the document grid cell.
- Create transient reference and validation files under `.artifacts/`; keep them uncommitted.

### Task 1: Lock the unified DOM and grid contracts

**Files:**
- Modify: `apps/desktop/test/web/app-workbench.test.tsx`
- Modify: `apps/desktop/test/web/project-settings-layout.test.ts`
- Test: `apps/desktop/test/web/app-workbench.test.tsx`
- Test: `apps/desktop/test/web/project-settings-layout.test.ts`

- [ ] **Step 1: Add a component ownership assertion**

Extend `groups every Issue metadata field and action inside a finite card surface` after the rail is found:

```ts
const detail = document.querySelector<HTMLElement>(".issue-detail");
const actions = screen.getByRole("region", { name: "Issue 操作" });
expect(detail).not.toBeNull();
expect(rail.parentElement).toBe(detail);
expect(actions.parentElement).toBe(detail);
expect(detail?.querySelector(":scope > .issue-detail-document")).not.toBeNull();
```

- [ ] **Step 2: Replace the sibling-column CSS assertions with nested-grid assertions**

In `locks the inset Issue metadata card rules`, assert:

```ts
expect(cssRule("\\.workspace")).toMatch(/grid-template-columns:\s*320px minmax\(0,\s*1fr\);/);
expect(cssRule("\\.workspace\\.metadata-open")).toMatch(/grid-template-columns:\s*320px minmax\(0,\s*1fr\);/);
expect(cssRule("\\.issue-detail")).toMatch(/position:\s*relative;/);
expect(cssRule("\\.issue-detail")).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\);/);
expect(cssRule("\\.issue-detail")).toMatch(/grid-template-rows:\s*minmax\(0,\s*1fr\) auto;/);
expect(cssRule("\\.workspace\\.metadata-open \\.issue-detail")).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\) 280px;/);
expect(cssRule("\\.issue-detail-document")).toMatch(/grid-column:\s*1;/);
expect(cssRule("\\.issue-detail-document")).toMatch(/grid-row:\s*1;/);
expect(rail).toMatch(/grid-column:\s*2;/);
expect(rail).toMatch(/grid-row:\s*1;/);
expect(cssRule("\\.issue-actions")).toMatch(/grid-column:\s*1 \/ -1;/);
expect(cssRule("\\.issue-actions")).toMatch(/grid-row:\s*2;/);
```

For the `681px` to `1200px` block, replace absolute-position assertions with:

```ts
expect(overlay).toMatch(/\.workspace\.metadata-open \.issue-detail\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s);
expect(overlay).toMatch(/\.issue-metadata-rail\s*\{[^}]*grid-column:\s*1;[^}]*grid-row:\s*1;[^}]*justify-self:\s*end;/s);
expect(overlay).not.toMatch(/\.issue-metadata-rail\s*\{[^}]*position:\s*absolute;/s);
```

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```bash
pnpm --dir apps/desktop exec vitest run --config vitest.config.ts test/web/project-settings-layout.test.ts test/web/app-workbench.test.tsx
```

Expected: FAIL because the metadata rail is still a workspace sibling, the workspace still owns the 280px track, and the footer does not span a nested Issue-detail grid.

- [ ] **Step 4: Commit the failing contract**

```bash
git add apps/desktop/test/web/app-workbench.test.tsx apps/desktop/test/web/project-settings-layout.test.ts
git commit -m "test: define unified Issue detail container"
```

### Task 2: Move metadata into the Issue detail component

**Files:**
- Modify: `apps/desktop/src/web/app.tsx`
- Modify: `apps/desktop/src/web/issues/issue-detail.tsx`
- Test: `apps/desktop/test/web/app-workbench.test.tsx`

- [ ] **Step 1: Add the metadata composition slot**

Add this property to `IssueDetailProps`:

```ts
metadataRail?: ReactNode;
```

Destructure it in `IssueDetail`, then render it after `.issue-detail-document` and before `IssueActions`:

```tsx
</div>
{metadataRail}
<IssueActions
```

- [ ] **Step 2: Compose the rail inside `IssueDetail` from `App`**

Build the optional node at the existing `IssueDetail` call site:

```tsx
metadataRail={metadataOpen ? <IssueMetadataRail
  issue={selected}
  project={selectedProject}
  terminalAction={terminalVisible ? undefined : terminalAction}
  workspace={workspaceInfo}
  onClose={() => setMetadataOpen(false)}
/> : undefined}
```

Remove the sibling `{selected && metadataOpen ? <IssueMetadataRail ... /> : null}` after the detail pane.

- [ ] **Step 3: Run the component test and verify the DOM contract passes**

Run:

```bash
pnpm --dir apps/desktop exec vitest run --config vitest.config.ts test/web/app-workbench.test.tsx -t "groups every Issue metadata field and action inside a finite card surface"
```

Expected: PASS.

- [ ] **Step 4: Commit the component composition**

```bash
git add apps/desktop/src/web/app.tsx apps/desktop/src/web/issues/issue-detail.tsx
git commit -m "refactor: unify Issue detail composition"
```

### Task 3: Make the footer span the unified layout

**Files:**
- Modify: `apps/desktop/src/web/issues/issue-actions.tsx`
- Modify: `apps/desktop/src/web/styles/global.css`
- Test: `apps/desktop/test/web/project-settings-layout.test.ts`
- Test: `apps/desktop/test/web/app-workbench.test.tsx`

- [ ] **Step 1: Add a document-aligned action track**

Wrap the current `IssueActions` content without changing any action renderer:

```tsx
return <section aria-label="Issue 操作" className="issue-actions">
  <div className="issue-actions-track">
    {error ? <Alert className="form-error" variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
    {content}
  </div>
</section>;
```

- [ ] **Step 2: Move the wide metadata track into the Issue detail**

Keep the workspace at two columns in both metadata states:

```css
.workspace,
.workspace.metadata-open {
  grid-template-columns: 320px minmax(0, 1fr);
}
```

Turn `IssueDetail` into the nested layout:

```css
.issue-detail {
  position: relative;
  display: grid;
  width: 100%;
  height: 100%;
  min-height: 0;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr) auto;
}

.workspace.metadata-open .issue-detail {
  grid-template-columns: minmax(0, 1fr) 280px;
}

.issue-detail-document {
  min-width: 0;
  min-height: 0;
  grid-column: 1;
  grid-row: 1;
  overflow: auto;
}
```

Place the base metadata rail in the first row and second column:

```css
.issue-metadata-rail {
  grid-column: 2;
  grid-row: 1;
  /* preserve the existing card boundary properties */
}
```

- [ ] **Step 3: Span the footer surface and align its controls to the document track**

Replace the direct-child layout with:

```css
.issue-actions {
  z-index: 2;
  display: grid;
  max-height: min(58vh, 620px);
  grid-column: 1 / -1;
  grid-row: 2;
  grid-template-columns: minmax(0, 1fr);
  overflow: auto;
  border-top: 1px solid var(--border);
  background: var(--surface-raised);
}

.workspace.metadata-open .issue-actions {
  grid-template-columns: minmax(0, 1fr) 280px;
}

.issue-actions-track {
  box-sizing: border-box;
  width: min(760px, 100%);
  grid-column: 1;
  margin: 0 auto;
  padding: 0 clamp(20px, 3.5vw, 36px);
}

.issue-actions-track > .failure-actions,
.issue-actions-track > .capability-request-panel {
  margin: 12px 0;
}
```

Update selectors that currently depend on `.issue-actions > *` to target `.issue-actions-track`.

- [ ] **Step 4: Overlay metadata in the document cell on narrow screens**

In both responsive ranges, keep the Issue detail to one column and make the rail share row 1 with the document:

```css
.workspace.metadata-open .issue-detail {
  grid-template-columns: minmax(0, 1fr);
}

.issue-metadata-rail {
  z-index: 4;
  width: min(280px, calc(100% - 48px));
  grid-column: 1;
  grid-row: 1;
  justify-self: end;
  padding: 12px;
}
```

Keep the phone width at `min(260px, calc(100% - 40px))` and phone padding at `10px`. Remove the obsolete absolute-position declarations.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
pnpm --dir apps/desktop exec vitest run --config vitest.config.ts test/web/project-settings-layout.test.ts test/web/app-workbench.test.tsx test/web/review-panel.test.tsx
```

Expected: all three files PASS.

- [ ] **Step 6: Commit the layout implementation**

```bash
git add apps/desktop/src/web/issues/issue-actions.tsx apps/desktop/src/web/styles/global.css
git commit -m "fix: unify Issue detail layout"
```

### Task 4: Validate the reference state and regression safety

**Files:**
- Create transient: `.artifacts/image-reference/issue-detail-layout-defect/`
- Create transient: `.artifacts/visual-diff/issue-detail-unified-layout/`

- [ ] **Step 1: Prepare and inventory the supplied defect reference**

Run:

```bash
/Users/starrblink/.agents/skills/implement-ui-design/scripts/prepare-image-reference.swift \
  --input /var/folders/5g/dc2p_n2d7b3f3__fyjs12y800000gn/T/codex-clipboard-89f44bae-10b8-4169-9f55-e2e7d7f3bb0a.png \
  --name issue-detail-layout-defect
```

Record that every visible element is code-owned or text-owned and that no raster production asset is required. The image documents the defect and is not a pixel-match target because the approved design intentionally changes its container geometry.

- [ ] **Step 2: Run desktop typecheck**

```bash
pnpm --filter @oh-my-bug/desktop typecheck
```

Expected: exit code `0`.

- [ ] **Step 3: Run the complete desktop suite serially**

```bash
pnpm --filter @oh-my-bug/desktop test
```

Expected: all desktop test files and tests PASS.

- [ ] **Step 4: Inspect wide and narrow runtime states**

At a wide viewport, verify that the footer surface reaches the right edge of the Issue detail container, the controls remain aligned to the document track, and the metadata card occupies the 280px first-row track. At a narrow viewport, verify that the metadata card overlays only the document row and stops above the footer.

If the in-app Browser blocks the local URL, do not bypass the policy; report the runtime visual-validation limitation explicitly.

- [ ] **Step 5: Verify the committed state**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors and no uncommitted product changes; `.artifacts/` remains ignored.
