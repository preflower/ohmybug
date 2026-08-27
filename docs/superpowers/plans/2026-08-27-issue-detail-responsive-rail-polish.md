# Issue Detail Responsive Rail Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shrink the responsive Issue metadata rail, move floating elevation onto the card, relocate the phone return action beside the Issues heading, and keep the Issue action footer fully inside the viewport.

**Architecture:** `IssueWorkspace` continues to own selection and deselection, but renders the return action in the stable outer `view-header` instead of an internal detail toolbar. Removing that extra child lets `detail-pane-scroll` become a single-row grid whose `IssueDetail` fills the available height and keeps `IssueActions` visible. Responsive CSS keeps the rail as a transparent positioning boundary while the existing inner card owns its surface and overlay shadow.

**Tech Stack:** React 19, TypeScript, CSS design tokens, Testing Library, Vitest, Vite, in-app Browser runtime validation.

---

## File map

- Modify `apps/desktop/test/web/app-workbench.test.tsx`: lock the return action's header ownership and existing deselection behavior.
- Modify `apps/desktop/test/web/project-settings-layout.test.ts`: lock rail widths, shadow ownership, and the single-row detail layout.
- Modify `apps/desktop/src/web/app.tsx`: move the existing return action from the detail pane into the Issues header.
- Modify `apps/desktop/src/web/styles/global.css`: implement the 280px/260px widths, card-owned overlay elevation, back-button visibility, and footer-safe grid.
- Create transient screenshots under `.artifacts/visual-diff/issue-detail-responsive-rail/`; do not commit them.

### Task 1: Lock the responsive structure and layout contracts

**Files:**
- Modify: `apps/desktop/test/web/app-workbench.test.tsx:1260-1280`
- Modify: `apps/desktop/test/web/project-settings-layout.test.ts:36-48`
- Test: `apps/desktop/test/web/app-workbench.test.tsx`
- Test: `apps/desktop/test/web/project-settings-layout.test.ts`

- [ ] **Step 1: Extend the existing workbench test before the return click**

Add these assertions to the test that loads the Issue workspace and already clicks `返回 Issue 列表`:

```tsx
const returnAction = screen.getByRole("button", { name: "返回 Issue 列表" });
expect(returnAction.closest(".view-header")).toBe(issuesHeader);
expect(returnAction.closest(".detail-pane")).toBeNull();
expect(document.querySelector(".mobile-detail-toolbar")).toBeNull();

fireEvent.click(returnAction);
expect(screen.queryByRole("region", { name: "Issue 详情" })).not.toBeInTheDocument();
```

Replace the existing direct `fireEvent.click(screen.getByRole(...))` and keep the existing post-click assertion only once.

- [ ] **Step 2: Replace the metadata CSS contract with the approved responsive contract**

Add a helper that isolates a media block:

```ts
function mediaBlock(startMarker: string, endMarker?: string): string {
  const start = styles.lastIndexOf(startMarker);
  const end = endMarker ? styles.indexOf(endMarker, start) : styles.length;
  return styles.slice(start, end < 0 ? styles.length : end);
}
```

Extend `locks the inset Issue metadata card rules`:

```ts
expect(styles).toMatch(/\.workspace\.metadata-open\s*\{[^}]*grid-template-columns:\s*320px minmax\(0,\s*1fr\) 280px;/s);
expect(cssRule("\\.detail-pane-scroll")).toMatch(/grid-template-rows:\s*minmax\(0,\s*1fr\);/);

const overlay = mediaBlock("@media (max-width: 1200px) and (min-width: 681px)", "@media (max-width: 900px)");
expect(overlay).toMatch(/\.issue-metadata-rail\s*\{[^}]*width:\s*min\(280px,\s*calc\(100% - 48px\)\);/s);
expect(overlay).toMatch(/\.issue-metadata-rail\s*\{[^}]*background:\s*transparent;/s);
expect(overlay).toMatch(/\.issue-metadata-rail\s*\{[^}]*box-shadow:\s*none;/s);
expect(overlay).toMatch(/\.issue-metadata-card\s*\{[^}]*box-shadow:\s*0 12px 32px rgb\(0 0 0 \/ 18%\);/s);

const phone = mediaBlock("@media (max-width: 680px)");
expect(phone).toMatch(/\.issue-metadata-rail\s*\{[^}]*width:\s*min\(260px,\s*calc\(100% - 40px\)\);/s);
expect(phone).toMatch(/\.issue-list-back-action\s*\{[^}]*display:\s*inline-flex;/s);
```

- [ ] **Step 3: Run both focused tests and verify RED**

Run:

```bash
pnpm --dir apps/desktop exec vitest run --config vitest.config.ts test/web/app-workbench.test.tsx test/web/project-settings-layout.test.ts -t "loads Runtime issues|inset Issue metadata card"
```

Expected: FAIL because the return action is still inside `.mobile-detail-toolbar`, the desktop rail is still `320px`, the detail grid still has two rows, and overlay shadow remains on the rail.

- [ ] **Step 4: Commit the failing contracts**

```bash
git add apps/desktop/test/web/app-workbench.test.tsx apps/desktop/test/web/project-settings-layout.test.ts
git commit -m "test: define responsive issue rail polish"
```

### Task 2: Move the return action into the outer Issues header

**Files:**
- Modify: `apps/desktop/src/web/app.tsx:496-513`
- Test: `apps/desktop/test/web/app-workbench.test.tsx`

- [ ] **Step 1: Group the Issues title with the selected-Issue return action**

Replace the direct heading in `IssueWorkspace` with:

```tsx
<div className="view-title">
  {selected ? (
    <Button
      aria-label="返回 Issue 列表"
      className="issue-list-back-action"
      size="icon-sm"
      type="button"
      variant="ghost"
      onClick={onDeselect}
    >
      <ChevronLeft aria-hidden="true" size={15} />
    </Button>
  ) : null}
  <h1>Issues</h1>
</div>
```

Keep the status filter and metadata toggle in the existing `filters` container.

- [ ] **Step 2: Remove the internal mobile toolbar without changing IssueDetail props**

Replace:

```tsx
{selected ? <><div className="mobile-detail-toolbar"><Button type="button" variant="ghost" onClick={onDeselect}><ChevronLeft aria-hidden="true" size={15} />返回 Issue 列表</Button></div><IssueDetail ... /></> : <Welcome />}
```

with the existing `IssueDetail` expression directly:

```tsx
{selected ? <IssueDetail
  agentActive={active}
  agentEvents={events}
  agentSessionId={selected.agentSession?.sessionId}
  branch={selectedBranch}
  issue={selected}
  terminalAction={terminalVisible ? terminalAction : undefined}
  workspaceBranch={workspaceInfo?.branch}
  onRefresh={onRefresh}
  onSubmitReview={(input) => action(api.submitReview(selected.id, input))}
  onApproveDelivery={() => approveDelivery(selected)}
  onPause={() => action(api.pause(selected.id))}
  onResume={() => action(api.resume(selected.id))}
  onCancel={() => action(api.cancel(selected.id))}
  onRetry={() => action(api.retry(selected.id))}
  onRebuildSession={() => action(api.rebuildSession(selected.id, selected.revision))}
  onGrantCapabilities={(expectedRevision, requestId) => action(api.grantIssueCapabilities(selected.id, expectedRevision, requestId))}
/> : <Welcome />}
```

- [ ] **Step 3: Run the focused workbench test**

Run:

```bash
pnpm --dir apps/desktop exec vitest run --config vitest.config.ts test/web/app-workbench.test.tsx -t "loads Runtime issues"
```

Expected: PASS; the return action is owned by `.view-header`, removes the selected Issue, and no internal toolbar remains.

- [ ] **Step 4: Commit the markup change**

```bash
git add apps/desktop/src/web/app.tsx
git commit -m "refactor: move Issue return action to header"
```

### Task 3: Implement the smaller card-owned overlay and footer-safe layout

**Files:**
- Modify: `apps/desktop/src/web/styles/global.css:240-285`
- Modify: `apps/desktop/src/web/styles/global.css:350-360`
- Modify: `apps/desktop/src/web/styles/global.css:654-825`
- Modify: `apps/desktop/src/web/styles/global.css:3895-3930`
- Test: `apps/desktop/test/web/project-settings-layout.test.ts`

- [ ] **Step 1: Add the title group and desktop-hidden return action**

```css
.view-title {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 4px;
}

.issue-list-back-action {
  display: none;
  flex: 0 0 auto;
}
```

- [ ] **Step 2: Shrink the desktop rail and make the detail pane a single-row grid**

```css
.workspace.metadata-open {
  grid-template-columns: 320px minmax(0, 1fr) 280px;
}

.detail-pane-scroll {
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  overflow: hidden;
  padding: 0;
}

.issue-metadata-rail {
  box-sizing: border-box;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  background: var(--canvas);
  padding: 12px;
}
```

- [ ] **Step 3: Remove obsolete mobile-toolbar styles**

Delete the base `.mobile-detail-toolbar { display: none; }` rule and the entire mobile `.mobile-detail-toolbar` block. In the existing `@media (max-width: 680px)` block near the card styles, show only the new header action:

```css
@media (max-width: 680px) {
  .location-header,
  .view-header {
    padding-inline: 12px;
  }

  .system-state {
    display: none;
  }

  .issue-list-back-action {
    display: inline-flex;
  }
}
```

- [ ] **Step 4: Move narrow-desktop elevation from the rail to the card**

Inside `@media (max-width: 1200px) and (min-width: 681px)` use:

```css
.issue-metadata-rail {
  position: absolute;
  z-index: 4;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(280px, calc(100% - 48px));
  background: transparent;
  padding: 12px;
  box-shadow: none;
}

.issue-metadata-card {
  box-shadow: 0 12px 32px rgb(0 0 0 / 18%);
}
```

- [ ] **Step 5: Add the phone-specific rail treatment after the base card rules**

```css
@media (max-width: 680px) {
  .issue-metadata-rail {
    width: min(260px, calc(100% - 40px));
    background: transparent;
    padding: 10px;
    box-shadow: none;
  }

  .issue-metadata-card {
    box-shadow: 0 12px 32px rgb(0 0 0 / 18%);
  }
}
```

Update or remove the earlier phone-only rail width/shadow declarations so there is one authoritative phone override.

- [ ] **Step 6: Run the CSS contract and workbench tests**

Run:

```bash
pnpm --dir apps/desktop exec vitest run --config vitest.config.ts test/web/project-settings-layout.test.ts test/web/app-workbench.test.tsx
```

Expected: both files PASS.

- [ ] **Step 7: Commit the responsive layout**

```bash
git add apps/desktop/src/web/styles/global.css
git commit -m "style: refine responsive Issue detail layout"
```

### Task 4: Validate the live responsive states

**Files:**
- Create transient: `.artifacts/visual-diff/issue-detail-responsive-rail/narrow-overlay.png`
- Create transient: `.artifacts/visual-diff/issue-detail-responsive-rail/phone-detail-footer.png`
- Create transient: `.artifacts/visual-diff/issue-detail-responsive-rail/phone-overlay.png`
- Create transient: `.artifacts/visual-diff/issue-detail-responsive-rail/metrics.json`

- [ ] **Step 1: Reload the existing local Vite page after implementation**

Use the currently open `http://localhost:5174/` tab. If it is unavailable, start:

```bash
pnpm --dir apps/desktop exec vite --config vite.config.ts --host 127.0.0.1 --port 5174
```

- [ ] **Step 2: Capture a `743×753` narrow-desktop overlay**

Open OHMYBUG-30 and the details rail. Save `narrow-overlay.png` and measure the rail/card computed styles.

Expected:

- rail width `280px` or the bounded calculation;
- rail background transparent and shadow `none`;
- card owns `0 12px 32px rgb(0 0 0 / 18%)`;
- no visible tinted panel outside the card;
- every metadata field and Terminal action remains present.

- [ ] **Step 3: Capture the `566×753` detail state with the rail closed**

Save `phone-detail-footer.png` and record bounding rectangles for `.detail-pane`, `.issue-detail`, `.issue-actions`, `.view-header`, and `.issue-list-back-action`.

Expected:

- return action is immediately before the Issues heading;
- `.mobile-detail-toolbar` count is `0`;
- Issue detail top equals detail-pane top;
- Issue detail bottom and action-footer bottom equal the detail-pane bottom (`753px` in this fixture);
- the action buttons are visible.

- [ ] **Step 4: Capture the `566×753` phone overlay**

Open the metadata card and save `phone-overlay.png`.

Expected:

- rail width is `260px` or the bounded calculation;
- card receives a `10px` inset and owns the shadow;
- outer rail remains transparent;
- content does not overflow horizontally.

- [ ] **Step 5: Inspect all screenshots at original detail**

Confirm the card feels smaller than the commented state, the floating surface is visually singular, the Footer is not clipped, and no unrelated desktop or Issue content changed.

### Task 5: Run complete verification

**Files:**
- Verify: `apps/desktop/src/web/app.tsx`
- Verify: `apps/desktop/src/web/styles/global.css`
- Verify: `apps/desktop/test/web/app-workbench.test.tsx`
- Verify: `apps/desktop/test/web/project-settings-layout.test.ts`

- [ ] **Step 1: Run desktop typecheck**

```bash
pnpm --filter @oh-my-bug/desktop typecheck
```

Expected: exit code `0`.

- [ ] **Step 2: Run the complete desktop test suite**

```bash
pnpm --filter @oh-my-bug/desktop test
```

Expected: all desktop test files and tests PASS.

- [ ] **Step 3: Check the committed diff and repository state**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors and no uncommitted product changes; `.artifacts` remains ignored.

- [ ] **Step 4: Review acceptance criteria against evidence**

Confirm every requirement in `docs/superpowers/specs/2026-08-27-issue-detail-responsive-rail-polish-design.md` maps to a passing test or captured runtime metric before reporting completion.
