# Issue Detail Metadata Rail Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle only the right-side Issue “详情” rail as the approved inset metadata card while preserving every field, action, and responsive behavior.

**Architecture:** Keep `IssueMetadataRail` as the grid/overlay and accessibility boundary, and introduce a single inner `issue-metadata-card` surface around the existing header and definition list. Use the existing design tokens and component classes for all visual work; behavior and data flow remain untouched. Validate semantics with Vitest and the visual result with deterministic in-app-browser screenshots against the prepared reference.

**Tech Stack:** React 19, TypeScript, CSS design tokens, Testing Library, Vitest, Vite, Playwright-backed in-app browser, Swift visual-diff utility.

---

## File map

- Modify `apps/desktop/test/web/app-workbench.test.tsx`: lock the metadata-card hierarchy and continued presence of all metadata groups.
- Modify `apps/desktop/src/web/app.tsx`: add the inner card surface without changing fields or operations.
- Modify `apps/desktop/src/web/styles/global.css`: implement the desktop card, row rhythm, wrapping, and overlay treatment.
- Create transient output only under `.artifacts/visual-diff/issue-detail-metadata-rail/`: store runtime screenshots, reference crop/mask if needed, diff image, and report; do not commit these files.

### Task 1: Lock the metadata-card structure with a failing test

**Files:**
- Modify: `apps/desktop/test/web/app-workbench.test.tsx`
- Test: `apps/desktop/test/web/app-workbench.test.tsx`

- [ ] **Step 1: Add a focused failing test beside the existing metadata-rail toggle test**

```tsx
it("groups every Issue metadata field and action inside a finite card surface", async () => {
  vi.spyOn(api, "integrationPlugins").mockResolvedValue([]);
  vi.spyOn(api, "workspaceProviders").mockResolvedValue([]);
  vi.spyOn(api, "projects").mockResolvedValue([project]);
  vi.spyOn(api, "issues").mockResolvedValue([issue]);
  vi.spyOn(api, "issue").mockResolvedValue(issue);
  vi.spyOn(api, "issueWorkspace").mockResolvedValue({
    providerId: "git",
    status: "READY",
    branch: "ohmybug/chk-1",
  });
  vi.spyOn(api, "integrationHealth").mockResolvedValue({});
  vi.spyOn(api, "agentTerminalAvailability").mockResolvedValue({ available: true });
  vi.spyOn(api, "subscribeIssueEvents").mockReturnValue(() => undefined);

  render(<App />);

  const rail = await screen.findByTestId("issue-metadata-rail");
  const card = await within(rail).findByTestId("issue-metadata-card");
  expect(card.querySelector(":scope > .metadata-rail-header")).not.toBeNull();
  expect(card.querySelector(":scope > .issue-metadata-list")).not.toBeNull();
  expect(within(card).getByText("详情")).toBeVisible();
  for (const label of ["项目", "分支", "来源", "Agent 会话", "创建时间", "更新时间"]) {
    expect(within(card).getByText(label)).toBeVisible();
  }
  expect(within(card).getByText("Worktree")).toBeVisible();
  expect(within(card).getByRole("button", { name: "隐藏详情栏" })).toBeVisible();
  expect(await within(card).findByRole("button", { name: "在 Terminal 中打开" })).toBeEnabled();
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/desktop test -- test/web/app-workbench.test.tsx -t "groups every Issue metadata field"
```

Expected: FAIL because `issue-metadata-card` does not exist.

- [ ] **Step 3: Commit the failing test**

```bash
git add apps/desktop/test/web/app-workbench.test.tsx
git commit -m "test: define issue metadata card structure"
```

### Task 2: Introduce the card surface without changing behavior

**Files:**
- Modify: `apps/desktop/src/web/app.tsx:565-601`
- Test: `apps/desktop/test/web/app-workbench.test.tsx`

- [ ] **Step 1: Wrap the existing header and definition list in the card surface**

Keep every existing row expression exactly as-is and change only the containing markup:

```tsx
return <aside className="issue-metadata-rail" data-testid="issue-metadata-rail" aria-label="Issue 详情栏">
  <div className="issue-metadata-card" data-testid="issue-metadata-card">
    <header className="metadata-rail-header">
      <span>详情</span>
      <MetadataRailToggle open onToggle={onClose} />
    </header>
    <dl className="issue-metadata-list">
      <div><dt>项目</dt><dd><span className="project-dot" />{project?.name ?? project?.key ?? issue.projectId}</dd></div>
      {workspace?.branch ? <div className="issue-workspace-row"><dt>分支</dt><dd><code title={workspace.branch}>{workspace.branch}</code>{workspace.providerId === "git" ? <span className="workspace-kind-tag">Worktree</span> : null}</dd></div> : null}
      <div><dt>来源</dt><dd>{latestInput?.integration ?? "manual"}</dd></div>
      <div className="agent-session-row"><dt><span>Agent 会话</span>{terminalAction}</dt><dd><code>{agentSessionId ?? "尚未创建"}</code></dd></div>
      <div><dt>创建时间</dt><dd><time>{timestamp(issue.createdAt)}</time></dd></div>
      <div><dt>更新时间</dt><dd><time>{timestamp(issue.updatedAt)}</time></dd></div>
    </dl>
  </div>
</aside>;
```

- [ ] **Step 2: Run the focused test and verify GREEN**

Run:

```bash
pnpm --filter @oh-my-bug/desktop test -- test/web/app-workbench.test.tsx -t "groups every Issue metadata field"
```

Expected: PASS.

- [ ] **Step 3: Run the existing rail behavior tests**

Run:

```bash
pnpm --filter @oh-my-bug/desktop test -- test/web/app-workbench.test.tsx -t "details rail|Terminal action|persisted branch"
```

Expected: all matched tests PASS; toggle, Terminal ownership, and branch rendering remain unchanged.

- [ ] **Step 4: Commit the structural implementation**

```bash
git add apps/desktop/src/web/app.tsx
git commit -m "refactor: add issue metadata card surface"
```

### Task 3: Match the approved desktop rail treatment

**Files:**
- Modify: `apps/desktop/src/web/styles/global.css:350-357`
- Modify: `apps/desktop/src/web/styles/global.css:661-768`
- Test: `apps/desktop/test/web/app-workbench.test.tsx`

- [ ] **Step 1: Increase the desktop rail slot to the approved usable width**

```css
.workspace.metadata-open {
  grid-template-columns: 320px minmax(0, 1fr) 320px;
}
```

- [ ] **Step 2: Replace the full-height sidebar surface with the inset card**

```css
.issue-metadata-rail {
  box-sizing: border-box;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  background: var(--canvas);
  padding: 16px;
}

.issue-metadata-card {
  overflow: hidden;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
}

.metadata-rail-header {
  display: flex;
  height: 56px;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border);
  background: transparent;
  padding: 0 12px 0 20px;
  color: var(--text);
  font-size: 15px;
  font-weight: 600;
}
```

Remove the old rail `border-left`, full-column `var(--sidebar)` background, and sticky header positioning.

- [ ] **Step 3: Apply the reference row rhythm and safe wrapping**

```css
.issue-metadata-list {
  margin: 0;
  padding: 0 20px;
}

.issue-metadata-list > div {
  display: grid;
  gap: 8px;
  border-bottom: 1px solid var(--border);
  padding: 18px 0;
}

.issue-metadata-list > div:last-child {
  border-bottom: 0;
}

.issue-metadata-list dt {
  color: var(--text-muted);
  font-size: 11px;
}

.issue-metadata-list dd {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.issue-metadata-list code,
.issue-metadata-list time {
  min-width: 0;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.45;
  overflow-wrap: anywhere;
  white-space: normal;
}

.issue-workspace-row dd {
  flex-wrap: wrap;
}

.issue-workspace-row code {
  min-width: 0;
  overflow-wrap: anywhere;
  white-space: normal;
}
```

Preserve the existing `agent-session-row`, Terminal action, Worktree tag, and project-dot rules unless a spacing adjustment is required by the screenshot.

- [ ] **Step 4: Run the focused web tests**

Run:

```bash
pnpm --filter @oh-my-bug/desktop test -- test/web/app-workbench.test.tsx
```

Expected: the complete workbench test file PASSes.

- [ ] **Step 5: Commit the desktop styling**

```bash
git add apps/desktop/src/web/styles/global.css
git commit -m "style: match issue metadata rail card"
```

### Task 4: Preserve the card treatment in the existing overlay breakpoint

**Files:**
- Modify: `apps/desktop/src/web/styles/global.css:3878-3893`
- Test: `apps/desktop/test/web/app-workbench.test.tsx`

- [ ] **Step 1: Update only the narrow-desktop overlay width and containment**

```css
@media (max-width: 1200px) and (min-width: 681px) {
  .workspace.metadata-open,
  .workspace.metadata-closed {
    grid-template-columns: 320px minmax(0, 1fr);
  }

  .issue-metadata-rail {
    position: absolute;
    z-index: 4;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(320px, calc(100% - 48px));
    box-shadow: -12px 0 28px rgb(0 0 0 / 24%);
  }
}
```

Do not change the existing `max-width: 680px` hiding rule.

- [ ] **Step 2: Run the complete workbench tests again**

Run:

```bash
pnpm --filter @oh-my-bug/desktop test -- test/web/app-workbench.test.tsx
```

Expected: PASS with no regression in rail visibility or keyboard toggling.

- [ ] **Step 3: Commit the responsive adjustment**

```bash
git add apps/desktop/src/web/styles/global.css
git commit -m "style: preserve metadata card in rail overlay"
```

### Task 5: Perform deterministic runtime visual validation

**Files:**
- Reference: `.artifacts/image-reference/issue-detail-sidebar/reference.png`
- Create transient: `.artifacts/visual-diff/issue-detail-metadata-rail/actual-1536x1024.png`
- Create transient: `.artifacts/visual-diff/issue-detail-metadata-rail/actual-1024x768.png`
- Create transient: `.artifacts/visual-diff/issue-detail-metadata-rail/reference-rail.png`
- Create transient: `.artifacts/visual-diff/issue-detail-metadata-rail/diff/`

- [ ] **Step 1: Load the in-app-browser control skill and open the existing local app**

Use `http://127.0.0.1:5174/`. If the page is unavailable, start the existing renderer with:

```bash
pnpm dev:web
```

Expected: the Issue detail fixture loads without a runtime error.

- [ ] **Step 2: Capture the desktop state**

Set the viewport to `1536×1024`, navigate to the active Issue detail, ensure the 详情 rail is open, and save a full-page screenshot plus a locator screenshot containing `.issue-metadata-rail`.

Expected visual properties:

- `16px` quiet surround is visible around the card.
- The card is finite-height and ends after 更新时间.
- No full-height gray rail or hard left divider remains.
- Header/toggle alignment and all six metadata groups are visible.
- Branch, session, and time values remain contained.

- [ ] **Step 3: Capture the overlay state**

Set the viewport to `1024×768`, reopen the rail if needed, and save `actual-1024x768.png`.

Expected: the rail overlays from the right at no more than `320px`, keeps the same inset card, and remains fully operable.

- [ ] **Step 4: Create a documented deterministic reference crop or mask**

Crop only unrelated main-page and global-navigation content from the prepared reference. Keep the complete reference metadata card and visible surrounding inset. Document the crop rectangle in `.artifacts/visual-diff/issue-detail-metadata-rail/README.md`. If fixture text differs, use a mask only for dynamic text glyph regions; keep card edges, background, header, row dividers, and control alignment included.

- [ ] **Step 5: Run the visual diff utility**

```bash
/Users/starrblink/.agents/skills/implement-ui-design/scripts/visual-diff.swift \
  --reference .artifacts/visual-diff/issue-detail-metadata-rail/reference-rail.png \
  --actual .artifacts/visual-diff/issue-detail-metadata-rail/actual-rail.png \
  --output-dir .artifacts/visual-diff/issue-detail-metadata-rail/diff \
  --scale-actual-to-reference \
  --pixel-threshold 0.12 \
  --max-mismatch-ratio 0.12 \
  --min-ssim 0.82
```

Expected: the report passes. If it fails, inspect the rendered diff and iterate CSS before rerunning; do not loosen thresholds without documenting the remaining reference ambiguity.

- [ ] **Step 6: Inspect screenshots directly**

Open both runtime screenshots and the diff image at original detail. Confirm no overflow, clipping, sticky-header artifact, extra status field, missing operation, or unrelated page redesign.

### Task 6: Run final verification and consolidate the change

**Files:**
- Verify: `apps/desktop/src/web/app.tsx`
- Verify: `apps/desktop/src/web/styles/global.css`
- Verify: `apps/desktop/test/web/app-workbench.test.tsx`

- [ ] **Step 1: Run the desktop typecheck**

```bash
pnpm --filter @oh-my-bug/desktop typecheck
```

Expected: PASS with exit code 0.

- [ ] **Step 2: Run the desktop test suite**

```bash
pnpm --filter @oh-my-bug/desktop test
```

Expected: PASS with exit code 0.

- [ ] **Step 3: Run formatting and diff checks**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only intentional source/test changes remain, while `.artifacts` stays ignored.

- [ ] **Step 4: Review the final diff against the approved scope**

Confirm:

- only the right Issue metadata rail changed visually;
- the global sidebar, Issue list, document, Terminal, Evidence, Delivery, and actions did not change;
- all existing metadata and operations remain;
- reference screenshot and visual-diff report are available as validation evidence.

- [ ] **Step 5: Commit any final visual adjustment**

```bash
git add apps/desktop/src/web/app.tsx apps/desktop/src/web/styles/global.css apps/desktop/test/web/app-workbench.test.tsx
git commit -m "fix: align issue detail sidebar with reference"
```
