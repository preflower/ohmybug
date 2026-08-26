# Agent Activity Flat Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render non-turn activity directly in the Agent activity timeline and remove nested scrolling while preserving default-collapsed Codex turn terminals.

**Architecture:** Keep the existing event grouping and command-correlation logic, but render groups with `turn: false` as flat lines instead of disclosure components. Preserve `ActivityTurn` for explicit Codex turns only. Remove vertical height and overflow constraints from the activity container and command output so the Issue page owns scrolling.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, CSS, Vite

---

## File Structure

- Modify `apps/desktop/src/web/issues/agent-activity.tsx`: choose between flat loose-event rendering and the existing Codex turn disclosure.
- Modify `apps/desktop/src/web/styles/global.css`: style flat lines and remove nested vertical scrolling constraints.
- Modify `apps/desktop/test/web/agent-activity.test.tsx`: lock non-turn events as directly visible content while retaining turn disclosure coverage.
- Modify `apps/desktop/test/web/project-settings-layout.test.ts`: lock the absence of vertical overflow and height constraints in Agent activity rules.

### Task 1: Render non-turn activity as flat rows

**Files:**
- Modify: `apps/desktop/test/web/agent-activity.test.tsx`
- Modify: `apps/desktop/src/web/issues/agent-activity.tsx`

- [ ] **Step 1: Write the failing renderer test**

Replace the loose-event disclosure expectations with a direct-visibility test:

```tsx
it("renders non-turn events directly without an activity-record disclosure", () => {
  render(<AgentActivity active={false} events={[
    {
      id: "issue-1:1",
      issueId: "issue-1",
      sequence: 1,
      actor: "SYSTEM",
      type: "DELIVERY_FINALIZATION_MERGE_PREPARED",
      occurredAt: "2026-08-25T09:00:00Z",
      data: { conflictCount: 1 },
    },
    {
      id: "issue-1:2",
      issueId: "issue-1",
      sequence: 2,
      actor: "SYSTEM",
      type: "DELIVERY_FINALIZATION_MERGE_RESOLVED",
      occurredAt: "2026-08-25T09:00:01Z",
      data: { resolvedPathCount: 1 },
    },
  ]} />);

  expect(screen.queryByRole("button", { name: "活动记录" })).not.toBeInTheDocument();
  expect(screen.getByText("已准备合并冲突供 AI 解析")).toBeVisible();
  expect(screen.getByText("AI 已解析合并冲突，等待重新验证")).toBeVisible();
});
```

Update every existing loose-event test so it no longer calls `openActivity("活动记录")`; assert its event or command content directly. Keep the Codex turn tests unchanged.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/desktop test -- agent-activity.test.tsx
```

Expected: FAIL because loose events are still hidden behind the “活动记录” button.

- [ ] **Step 3: Render loose groups without a disclosure**

Add a shared line renderer and a flat loose-group renderer in `agent-activity.tsx`:

```tsx
function ActivityLogLine({ line }: { line: ActivityLine }) {
  return line.kind === "command"
    ? <CommandLogLine line={line} />
    : <EventLogLine line={line} />;
}

function FlatActivityLines({ group }: { group: ActivityGroup }) {
  return <div className="activity-flat-lines">
    {group.lines.map((line) => <ActivityLogLine
      key={line.kind === "command" ? line.id : line.event.id}
      line={line}
    />)}
  </div>;
}
```

Use `ActivityLogLine` inside `ActivityTurn`, then change the groups mapping in `AgentActivity`:

```tsx
{groups.length ? groups.map((group) => group.turn
  ? <ActivityTurn
      expanded={expandedGroupIds.has(group.id)}
      group={group}
      key={group.id}
      onToggle={() => toggleGroup(group.id)}
    />
  : <FlatActivityLines group={group} key={group.id} />)
  : <p className="activity-empty">Agent 尚未产生事件。</p>}
```

Do not change grouping, command correlation, event order, pagination, or Codex turn disclosure state.

- [ ] **Step 4: Run the focused renderer tests and verify GREEN**

Run:

```bash
pnpm --filter @oh-my-bug/desktop test -- agent-activity.test.tsx
```

Expected: all Agent activity renderer tests PASS.

- [ ] **Step 5: Commit the behavior change**

```bash
git add apps/desktop/src/web/issues/agent-activity.tsx apps/desktop/test/web/agent-activity.test.tsx
git commit -m "fix(desktop): flatten non-turn agent activity"
```

### Task 2: Remove nested activity scrolling

**Files:**
- Modify: `apps/desktop/test/web/project-settings-layout.test.ts`
- Modify: `apps/desktop/src/web/styles/global.css`

- [ ] **Step 1: Write the failing style contract**

Add this helper and test to `project-settings-layout.test.ts`:

```ts
function cssRule(selector: string): string {
  return styles.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`, "s"))?.[1] ?? "";
}

it("lets the Issue page own Agent activity scrolling", () => {
  const groups = cssRule("\\.activity-groups");
  const output = cssRule("\\.activity-log-output");

  expect(groups).not.toMatch(/overflow(?:-y)?:\s*(?:auto|scroll)/);
  expect(groups).not.toMatch(/max-height\s*:/);
  expect(output).not.toMatch(/overflow(?:-y)?:\s*(?:auto|scroll)/);
  expect(output).not.toMatch(/max-height\s*:/);
});
```

- [ ] **Step 2: Run the style test and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/desktop test -- project-settings-layout.test.ts
```

Expected: FAIL because `.activity-groups` and `.activity-log-output` still use internal overflow and `max-height`.

- [ ] **Step 3: Remove the nested scroll constraints and style flat lines**

Change the relevant CSS to:

```css
.activity-groups {
  border-top: 1px solid var(--border);
  background: var(--canvas);
}

.activity-flat-lines {
  border-bottom: 1px solid var(--border);
  background: var(--canvas);
}

.activity-flat-lines:last-child {
  border-bottom: 0;
}

.activity-log-output {
  box-sizing: border-box;
  width: auto;
  min-width: 0;
  margin: 4px 10px 2px 29px;
  border-radius: 0;
  background: transparent;
  padding: 0;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}
```

Keep the outer Issue document scrolling behavior unchanged.

- [ ] **Step 4: Run focused renderer and style tests and verify GREEN**

Run:

```bash
pnpm --filter @oh-my-bug/desktop test -- agent-activity.test.tsx project-settings-layout.test.ts
```

Expected: both focused test files PASS.

- [ ] **Step 5: Commit the scrolling change**

```bash
git add apps/desktop/src/web/styles/global.css apps/desktop/test/web/project-settings-layout.test.ts
git commit -m "style(desktop): remove nested activity scrolling"
```

### Task 3: Verify the integrated behavior

**Files:**
- Verify: `apps/desktop/src/web/issues/agent-activity.tsx`
- Verify: `apps/desktop/src/web/styles/global.css`
- Verify: `apps/desktop/test/web/agent-activity.test.tsx`
- Verify: `apps/desktop/test/web/project-settings-layout.test.ts`

- [ ] **Step 1: Run the desktop test suite**

Run:

```bash
pnpm --filter @oh-my-bug/desktop test
```

Expected: all desktop tests PASS with no warnings.

- [ ] **Step 2: Run repository typechecking**

Run:

```bash
pnpm typecheck
```

Expected: all workspace and repository typechecks PASS.

- [ ] **Step 3: Inspect the local Issues UI**

Reload `http://localhost:5173/issues` after the code changes. Verify from the rendered DOM and computed styles that:

- no button named “活动记录” exists;
- a non-turn event is visible without interaction;
- “Codex 开始分析” or another turn header remains collapsed by default;
- expanding a turn reveals its complete terminal;
- `.activity-groups` and `.activity-log-output` have no vertical scrollbar or vertical maximum height.

- [ ] **Step 4: Check the final diff**

Run:

```bash
git status --short
git diff --check HEAD~2..HEAD
```

Expected: the worktree is clean and no whitespace errors are reported.
