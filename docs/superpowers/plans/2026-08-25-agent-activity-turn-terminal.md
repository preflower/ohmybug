# Agent Activity Turn Terminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the outer Agent activity disclosure with independent, default-collapsed Codex turn disclosures whose expanded bodies read as one continuous terminal.

**Architecture:** Keep the existing event-to-turn grouping and command-correlation functions unchanged. `AgentActivity` will always render the current paginated group list, track expanded group IDs per Issue, and delegate each group to an accessible disclosure renderer. Styling will move scroll containment to the group list and remove command-output card treatments inside each turn terminal.

**Tech Stack:** React 19, TypeScript, Base UI-backed Button, Vitest, Testing Library, CSS custom properties.

---

## File Map

- Modify `apps/desktop/test/web/agent-activity.test.tsx`: specify default-collapsed turn disclosures, independent expansion, Issue-safe state, loose activity behavior, and update existing activity assertions to open the relevant group.
- Modify `apps/desktop/test/web/project-settings-layout.test.ts`: lock the shared-terminal CSS contract and remove the obsolete full-width output-card expectation.
- Modify `apps/desktop/src/web/issues/agent-activity.tsx`: render a static Agent activity heading, per-group disclosure buttons, and Issue-scoped expanded state.
- Modify `apps/desktop/src/web/styles/global.css`: style disclosure headers and one continuous terminal surface without command-sized output cards.

### Task 1: Specify the turn-level disclosure behavior

**Files:**
- Modify: `apps/desktop/test/web/agent-activity.test.tsx`
- Test: `apps/desktop/test/web/agent-activity.test.tsx`

- [ ] **Step 1: Add a reusable group opener and a failing default-collapse test**

Add this helper below the imports:

```tsx
function openActivity(label: string | RegExp): HTMLElement {
  const toggle = screen.getByRole("button", { name: label });
  fireEvent.click(toggle);
  return toggle;
}
```

Add this test before the command lifecycle test:

```tsx
it("renders each Codex turn as a default-collapsed terminal disclosure", () => {
  render(<AgentActivity active={false} events={[
    { id: "issue-1:1", issueId: "issue-1", sequence: 1, actor: "AGENT", type: "AGENT_TURN_STARTED", occurredAt: "2026-08-24T09:00:00Z", data: { message: "Codex 开始分析" } },
    { id: "issue-1:2", issueId: "issue-1", sequence: 2, actor: "AGENT", type: "AGENT_COMMAND_STARTED", occurredAt: "2026-08-24T09:00:01Z", data: { message: "正在执行项目命令", detail: "$ pnpm test" } },
    { id: "issue-1:3", issueId: "issue-1", sequence: 3, actor: "AGENT", type: "AGENT_COMMAND_COMPLETED", occurredAt: "2026-08-24T09:00:02Z", data: { message: "项目命令执行完成", detail: "$ pnpm test\n12 passed" } },
    { id: "issue-1:4", issueId: "issue-1", sequence: 4, actor: "AGENT", type: "AGENT_TURN_COMPLETED", occurredAt: "2026-08-24T09:00:03Z", data: { message: "Codex 已完成分析" } },
  ]} />);

  expect(screen.getByText("Agent 活动")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Agent 活动" })).not.toBeInTheDocument();
  const toggle = screen.getByRole("button", { name: "Codex 开始分析" });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("log", { name: "Codex 开始分析 Terminal" })).not.toBeInTheDocument();
  expect(screen.queryByText("$ pnpm test")).not.toBeInTheDocument();

  fireEvent.click(toggle);

  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("log", { name: "Codex 开始分析 Terminal" })).toBeVisible();
  expect(screen.getAllByText("$ pnpm test")).toHaveLength(1);
  expect(screen.getByText("12 passed")).toBeVisible();
});
```

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/web/agent-activity.test.tsx -t "renders each Codex turn"
```

Expected: FAIL because the current UI still exposes an `Agent 活动` button and does not expose a `Codex 开始分析` disclosure button.

- [ ] **Step 3: Add failing independent-turn and Issue-reset tests**

Add:

```tsx
it("expands Codex turns independently", () => {
  const turn = (prefix: string, sequence: number, message: string) => [
    { id: `issue-1:${prefix}-start`, issueId: "issue-1", sequence, actor: "AGENT" as const, type: "AGENT_TURN_STARTED", occurredAt: "2026-08-24T09:00:00Z", data: { message } },
    { id: `issue-1:${prefix}-message`, issueId: "issue-1", sequence: sequence + 1, actor: "AGENT" as const, type: "MESSAGE", occurredAt: "2026-08-24T09:00:01Z", data: { message: `${prefix} output` } },
    { id: `issue-1:${prefix}-end`, issueId: "issue-1", sequence: sequence + 2, actor: "AGENT" as const, type: "AGENT_TURN_COMPLETED", occurredAt: "2026-08-24T09:00:02Z", data: { message: `${message}完成` } },
  ];
  render(<AgentActivity active={false} events={[
    ...turn("analysis", 1, "Codex 开始分析"),
    ...turn("repair", 4, "Codex 开始实现"),
  ]} />);

  openActivity("Codex 开始分析");
  expect(screen.getByText("analysis output")).toBeVisible();
  expect(screen.queryByText("repair output")).not.toBeInTheDocument();

  openActivity("Codex 开始实现");
  expect(screen.getByText("analysis output")).toBeVisible();
  expect(screen.getByText("repair output")).toBeVisible();
});

it("does not leak expanded turns when switching Issues", () => {
  const events = (issueId: string) => [
    { id: `${issueId}:1`, issueId, sequence: 1, actor: "AGENT" as const, type: "AGENT_TURN_STARTED", occurredAt: "2026-08-24T09:00:00Z", data: { message: "Codex 开始分析" } },
    { id: `${issueId}:2`, issueId, sequence: 2, actor: "AGENT" as const, type: "MESSAGE", occurredAt: "2026-08-24T09:00:01Z", data: { message: `${issueId} output` } },
  ];
  const view = render(<AgentActivity active events={events("issue-1")} />);
  openActivity("Codex 开始分析");
  expect(screen.getByText("issue-1 output")).toBeVisible();

  view.rerender(<AgentActivity active events={events("issue-2")} />);

  expect(screen.getByRole("button", { name: "Codex 开始分析" })).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByText("issue-2 output")).not.toBeInTheDocument();
});
```

- [ ] **Step 4: Run the three disclosure tests and verify they fail for the missing behavior**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/web/agent-activity.test.tsx -t "turn|switching Issues"
```

Expected: FAIL on missing per-turn buttons and expanded-state isolation, without syntax or fixture errors.

### Task 2: Implement accessible per-turn terminal disclosures

**Files:**
- Modify: `apps/desktop/src/web/issues/agent-activity.tsx:363-407`
- Modify: `apps/desktop/test/web/agent-activity.test.tsx`
- Test: `apps/desktop/test/web/agent-activity.test.tsx`

- [ ] **Step 1: Add an `ActivityTurn` renderer above `AgentActivity`**

Add:

```tsx
function ActivityTurn({
  expanded,
  group,
  onToggle,
}: {
  expanded: boolean;
  group: ActivityGroup;
  onToggle: () => void;
}) {
  const bodyId = `activity-turn-body-${group.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  return <section className={`activity-turn activity-turn-${group.status}`}>
    <Button
      aria-controls={bodyId}
      aria-expanded={expanded}
      aria-label={group.label}
      className="activity-turn-toggle"
      type="button"
      variant="ghost"
      onClick={onToggle}
    >
      <span className="activity-turn-title">
        {group.turn ? <Terminal aria-hidden="true" size={13} /> : <Clock3 aria-hidden="true" size={13} />}
        <span>{group.label}</span>
      </span>
      <span className="activity-turn-meta">
        <time>{formatTime(group.occurredAt)}{group.finishedAt ? `–${formatTime(group.finishedAt)}` : ""}</time>
        <span>{groupStatus(group)}</span>
      </span>
      <ChevronDown aria-hidden="true" className={expanded ? "activity-chevron-open" : ""} size={14} />
    </Button>
    {expanded ? <div
      aria-label={`${group.label} Terminal`}
      aria-live="off"
      className="activity-terminal activity-turn-body"
      id={bodyId}
      role="log"
    >
      {group.lines.length ? group.lines.map((line) => line.kind === "command"
        ? <CommandLogLine key={line.id} line={line} />
        : <EventLogLine key={line.event.id} line={line} />)
        : <p className="activity-turn-empty">等待活动…</p>}
    </div> : null}
  </section>;
}
```

- [ ] **Step 2: Replace the outer disclosure state and JSX in `AgentActivity`**

Use Issue-scoped disclosure state and always compute the current page:

```tsx
const [expandedGroups, setExpandedGroups] = useState<{ issueId?: string; ids: Set<string> }>({
  issueId,
  ids: new Set(),
});
const expandedGroupIds = expandedGroups.issueId === issueId ? expandedGroups.ids : new Set<string>();
const visibleEvents = events.slice(-visibleEventCount);
const groups = groupEvents(visibleEvents, active);
const hiddenEventCount = Math.max(0, events.length - visibleEvents.length);
const toggleGroup = (groupId: string) => setExpandedGroups((current) => {
  const ids = current.issueId === issueId ? new Set(current.ids) : new Set<string>();
  if (ids.has(groupId)) ids.delete(groupId);
  else ids.add(groupId);
  return { issueId, ids };
});
```

Replace the returned JSX with:

```tsx
return <section className="agent-activity">
  <header className="agent-activity-header">
    <span><Activity aria-hidden="true" size={14} />Agent 活动</span>
    <span aria-live="polite" className={currentClass} title={active ? currentSummary : undefined}>
      {active ? currentSummary : `${events.length} 条事件`}
    </span>
  </header>
  <div className="activity-groups">
    {hiddenEventCount ? <Button className="activity-history-more" type="button" variant="ghost" onClick={() => setPagination({
      count: Math.min(events.length, visibleEventCount + activityPageSize),
      issueId,
    })}>
      加载更早活动（剩余 {hiddenEventCount} 条）
    </Button> : null}
    {groups.length ? groups.map((group) => <ActivityTurn
      expanded={expandedGroupIds.has(group.id)}
      group={group}
      key={group.id}
      onToggle={() => toggleGroup(group.id)}
    />) : <p className="activity-empty">Agent 尚未产生事件。</p>}
  </div>
</section>;
```

- [ ] **Step 3: Run the focused disclosure tests and verify they pass**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/web/agent-activity.test.tsx -t "renders each Codex turn|expands Codex turns|does not leak expanded"
```

Expected: 3 tests PASS.

- [ ] **Step 4: Update existing tests to open the relevant group instead of the removed outer disclosure**

Replace each `fireEvent.click(screen.getByRole("button", { name: "Agent 活动" }))` with the matching group opener:

```tsx
openActivity("Codex 开始分析");
openActivity("Codex 开始实现");
openActivity("活动记录");
```

For tests with repeated identical turn labels, use `screen.getAllByRole("button", { name: "Codex 开始实现" })[index]` and click the exact turn whose body the assertion inspects. Update the former outer-toggle test to assert the static heading and the `活动记录` disclosure instead:

```tsx
expect(screen.getByText("Agent 活动")).toBeVisible();
expect(screen.queryByRole("button", { name: "Agent 活动" })).not.toBeInTheDocument();
const toggle = screen.getByRole("button", { name: "活动记录" });
expect(toggle).toHaveAttribute("aria-expanded", "false");
fireEvent.click(toggle);
expect(toggle).toHaveAttribute("aria-expanded", "true");
```

- [ ] **Step 5: Run the complete renderer test file and fix only disclosure-related regressions**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/web/agent-activity.test.tsx
```

Expected: all tests in `agent-activity.test.tsx` PASS with no warnings.

- [ ] **Step 6: Commit the behavior change**

```bash
git add apps/desktop/src/web/issues/agent-activity.tsx apps/desktop/test/web/agent-activity.test.tsx
git commit -m "fix(desktop): collapse agent activity by Codex turn"
```

### Task 3: Make each expanded turn one continuous terminal surface

**Files:**
- Modify: `apps/desktop/src/web/styles/global.css:1858-2112`
- Modify: `apps/desktop/test/web/project-settings-layout.test.ts:34-41`
- Test: `apps/desktop/test/web/agent-activity.test.tsx`
- Test: `apps/desktop/test/web/project-settings-layout.test.ts`

- [ ] **Step 1: Add a failing structural assertion for inline output**

In the default-collapse test, after expansion, add:

```tsx
const terminal = screen.getByRole("log", { name: "Codex 开始分析 Terminal" });
const output = screen.getByText("12 passed");
expect(output).toHaveClass("activity-log-output");
expect(output.parentElement).toBe(terminal.querySelector(".activity-log-command"));
```

Add an assertion that encodes the new shared-terminal hook:

```tsx
expect(terminal).toHaveClass("activity-turn-body", "activity-terminal");
```

In `project-settings-layout.test.ts`, replace the obsolete output-card assertions with:

```ts
it("keeps Agent activity turns full width and flattens terminal output", () => {
  expect(styles).toMatch(/\.activity-turn\s*\{[^}]*width:\s*100%;/s);
  expect(styles).toMatch(/\.activity-log-output\s*\{[^}]*box-sizing:\s*border-box;/s);
  expect(styles).toMatch(/\.activity-log-output\s*\{[^}]*width:\s*auto;/s);
  expect(styles).toMatch(/\.activity-log-output\s*\{[^}]*border-radius:\s*0;/s);
  expect(styles).toMatch(/\.activity-log-output\s*\{[^}]*background:\s*transparent;/s);
});
```

- [ ] **Step 2: Run the structural test before the CSS change**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/web/agent-activity.test.tsx -t "renders each Codex turn"
```

Also run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/web/project-settings-layout.test.ts -t "flattens terminal output"
```

Expected: the structural component test passes after Task 2, while the CSS contract test FAILS because output still has `width: 100%`, a radius, and a raised background.

- [ ] **Step 3: Replace outer-toggle styles with static header and disclosure styles**

Use these rules in place of `.agent-activity > button` and `.activity-turn-header`:

```css
.agent-activity-header {
  display: grid;
  min-height: 38px;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 0 11px;
  color: var(--text-muted);
  font-size: 10px;
}

.agent-activity-header > span:first-child {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--text-secondary);
  font-size: 11px;
}

.activity-groups {
  overflow-y: auto;
  max-height: min(460px, 60vh);
  border-top: 1px solid var(--border);
  background: var(--canvas);
  overscroll-behavior: contain;
}

.activity-turn-toggle {
  display: grid;
  width: 100%;
  min-height: 32px;
  grid-template-columns: minmax(0, 1fr) auto 14px;
  align-items: center;
  gap: 10px;
  border-radius: 0;
  background: var(--surface-raised);
  padding: 7px 10px;
  color: var(--text-muted);
  text-align: left;
}

.activity-turn-toggle:hover,
.activity-turn-toggle:focus-visible {
  background: var(--surface-hover);
}
```

- [ ] **Step 4: Flatten output styling inside the shared terminal**

Update the terminal and output rules:

```css
.activity-terminal {
  min-width: 0;
  background: var(--canvas);
}

.activity-turn-body {
  padding: 3px 0;
  border-top: 1px solid var(--border);
}

.activity-log-output {
  box-sizing: border-box;
  width: auto;
  min-width: 0;
  overflow: auto;
  max-height: 240px;
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

Keep existing semantic state colors, entry separators, bounded output height, and reduced-motion rules.

- [ ] **Step 5: Run focused tests, desktop tests, and typecheck**

Run:

```bash
pnpm --filter @oh-my-bug/desktop test
pnpm --filter @oh-my-bug/desktop typecheck
```

Expected: both commands exit 0 with no failed tests or TypeScript errors.

- [ ] **Step 6: Inspect the local app in collapsed and expanded states**

At `http://localhost:5173/`, select an Issue with Agent activity and verify:

- “Agent 活动” is a static heading.
- “Codex 开始分析” and other turns are visible but collapsed initially.
- Clicking the turn header opens the whole turn.
- Commands and outputs read as one terminal, without output cards.
- Two turns can remain expanded together.
- The layout remains usable at a narrow desktop width and the disclosure buttons show keyboard focus.

- [ ] **Step 7: Run final repository verification**

Run:

```bash
pnpm typecheck
pnpm test
git diff --check
```

Expected: all commands exit 0, all tests pass, and `git diff --check` prints no errors.

- [ ] **Step 8: Commit the terminal presentation**

```bash
git add apps/desktop/src/web/styles/global.css apps/desktop/test/web/agent-activity.test.tsx apps/desktop/test/web/project-settings-layout.test.ts
git commit -m "style(desktop): unify Codex turn activity terminal"
```
