# Issue Detail Transient Terminal UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reimplement the Issue detail page from the approved active/result references while preserving all current workflow actions and making Codex Terminal a transient read-only execution surface.

**Architecture:** Keep the current Assessment renderer and evidence preview pipeline. Extend the existing Agent event presentation with a focused `CodexTerminal`, wire one shared external-Terminal control into either the transient panel or metadata rail, and split result artifacts into concise Evidence and Delivery cards. The outer Issue list remains the workflow-state source; the detail document and rail stop duplicating state.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, project CSS tokens, Lucide icons, local browser runtime, Swift visual-diff tooling.

---

## File map

- Modify `apps/desktop/src/web/issues/agent-activity.tsx`: add current-session filtering, transient visibility, read-only Terminal rendering, and autoscroll behavior.
- Modify `apps/desktop/test/web/agent-activity.test.tsx`: cover visibility, session reset, read-only output, and “回到最新”.
- Modify `apps/desktop/src/web/issues/issue-detail.tsx`: simplify the header, insert Terminal, split Evidence and Delivery, and fold branch/commit metadata into Delivery.
- Modify `apps/desktop/test/web/issues.test.tsx`: cover active/result hierarchy and preserve evidence preview and workflow actions.
- Modify `apps/desktop/src/web/app.tsx`: share Terminal availability/open state between the detail and metadata rail; remove rail status and Agent activity.
- Modify `apps/desktop/test/web/app-workbench.test.tsx`: cover action de-duplication and the reduced rail.
- Modify `apps/desktop/src/web/issues/issue-actions.tsx`: make normal bottom states action-only while preserving review and capability forms.
- Modify `apps/desktop/src/web/styles/global.css`: implement the approved light cards, dark bounded Terminal, concise artifact cards, reduced rail, and fixed action bar.
- Create uncommitted `.artifacts/visual-diff/issue-detail-terminal-active/*`: active-state capture and diff.
- Create uncommitted `.artifacts/visual-diff/issue-detail-terminal-result/*`: result-state capture and diff.

### Task 1: Add the transient read-only Codex Terminal

**Files:**
- Modify: `apps/desktop/test/web/agent-activity.test.tsx`
- Modify: `apps/desktop/src/web/issues/agent-activity.tsx`

- [ ] **Step 1: Write failing visibility and read-only tests**

Add tests that render `CodexTerminal` with no current-session execution event, then with a turn and command:

```tsx
expect(screen.queryByRole("region", { name: "Codex Terminal" })).not.toBeInTheDocument();

view.rerender(<CodexTerminal
  active
  events={[turnStarted, commandStarted, commandCompleted]}
  sessionId="session-1"
  terminalAction={<button type="button">在 Terminal 中打开</button>}
/>);

const terminal = screen.getByRole("region", { name: "Codex Terminal" });
expect(within(terminal).getByText("$ pnpm test")).toBeVisible();
expect(within(terminal).getByText("12 passed")).toBeVisible();
expect(within(terminal).queryByRole("textbox")).not.toBeInTheDocument();
```

Also rerender with `active={false}` and require the whole region to disappear.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/desktop test -- test/web/agent-activity.test.tsx
```

Expected: FAIL because `CodexTerminal` is not exported.

- [ ] **Step 3: Write failing session-reset and autoscroll tests**

Add one event list containing an old turn, `AGENT_SESSION_REBUILT` with `newLogicalSessionId: "session-2"`, and a new turn. Require only new output. For scrolling, define `scrollHeight`, `clientHeight`, and writable `scrollTop` on the log, fire a scroll away from the bottom, require “回到最新”, click it, and require `scrollTop === scrollHeight` plus button removal.

- [ ] **Step 4: Implement current-session filtering and Terminal rendering**

In `agent-activity.tsx`, add:

```tsx
function currentSessionEvents(events: AgentEventDto[], sessionId?: string): AgentEventDto[] {
  if (!sessionId) return events;
  const rebuiltAt = events.findLastIndex((event) => (
    event.type === "AGENT_SESSION_REBUILT"
    && event.data.newLogicalSessionId === sessionId
  ));
  return rebuiltAt >= 0 ? events.slice(rebuiltAt + 1) : events;
}

export function hasCurrentSessionExecution(
  events: AgentEventDto[],
  active: boolean,
  sessionId?: string,
): boolean {
  return active && currentSessionEvents(events, sessionId).some((event) => (
    event.actor === "AGENT"
    && event.type !== "AGENT_SESSION_CONNECTED"
    && event.type !== "AGENT_TURN_COMPLETED"
  ));
}
```

Export `CodexTerminal` with props `{ active, events, sessionId, terminalAction }`. Reuse `groupEvents` and `ActivityLogLine`; render all current-session lines in one `role="log"` body, title “Codex Terminal”, no status header, no input, bounded scroll, follow-latest while at bottom, and a “回到最新” button only while follow mode is paused.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run the same desktop test command and require all `agent-activity` tests to pass.

### Task 2: Implement the active and result detail hierarchy

**Files:**
- Modify: `apps/desktop/test/web/issues.test.tsx`
- Modify: `apps/desktop/src/web/issues/issue-detail.tsx`

- [ ] **Step 1: Write the failing active-state test**

Render a repairing Issue with Assessment, current Agent events, a session ID, Terminal action, and existing Delivery fixture. Require:

```tsx
expect(screen.getByTestId("assessment-review")).toBeVisible();
expect(screen.getByRole("region", { name: "Codex Terminal" })).toBeVisible();
expect(screen.queryByRole("region", { name: "证据" })).not.toBeInTheDocument();
expect(screen.queryByRole("region", { name: "交付" })).not.toBeInTheDocument();
expect(screen.queryByText("结果：FIXED")).not.toBeInTheDocument();
```

- [ ] **Step 2: Write the failing result-state test**

Render the completed fixture with `agentActive={false}`, a `deliveryDraft.integration` containing `issueBranch` and `issueCommit`, and evidence. Require no Terminal, a “证据” region whose direct conclusion is `delivery.summary`, and a “交付” region containing only summary, target branch, and abbreviated Issue commit. Require the old `Delivery · 迭代`, evidence count, status badge, occurrence summary, and standalone “交付分支” card to be absent.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/desktop test -- test/web/issues.test.tsx
```

Expected: FAIL because the new props, regions, and hierarchy do not exist.

- [ ] **Step 4: Implement the hierarchy**

Extend `IssueDetailProps` with:

```ts
agentActive?: boolean;
agentEvents?: AgentEventDto[];
agentSessionId?: string;
terminalAction?: ReactNode;
workspaceBranch?: string;
```

Keep the current Assessment JSX unchanged. Remove the header status badge, occurrence summary, and resolution summary. Preserve failure diagnostics as contextual alerts outside the header. Render `CodexTerminal` immediately after Assessment. While it is visible, suppress result artifacts. Otherwise render:

```tsx
<section aria-label="证据" className="review-section issue-evidence-section">
  <div className="review-heading"><span>证据</span></div>
  <p className="evidence-conclusion">{delivery.summary}</p>
  <div className="evidence-gallery">…</div>
</section>

<section aria-label="交付" className="review-section issue-delivery-section">
  <div className="review-heading"><span>交付</span></div>
  <p>{issue.repair?.deliveryDraft?.summary ?? delivery.summary}</p>
  <dl>…issueBranch/workspaceBranch…issueCommit/branch.commit…</dl>
</section>
```

Remove the separate branch card. Keep evidence preview behavior unchanged.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the issues test file and require it to pass before continuing.

### Task 3: Reduce the metadata rail and de-duplicate Terminal action

**Files:**
- Modify: `apps/desktop/test/web/app-workbench.test.tsx`
- Modify: `apps/desktop/src/web/app.tsx`

- [ ] **Step 1: Write failing reduced-rail tests**

In the existing Terminal action tests, require the rail to omit “状态” and “Agent 活动”. Add an active event test: before an execution event, the action is beside Agent session; after `AGENT_TURN_STARTED`, exactly one “在 Terminal 中打开” action exists inside the Codex Terminal region and none exists in the rail.

- [ ] **Step 2: Run the workbench tests and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/desktop test -- test/web/app-workbench.test.tsx
```

Expected: FAIL because the rail still owns the action and renders status/activity.

- [ ] **Step 3: Lift Terminal control state to `IssuesWorkspace`**

Move the availability key, availability request, opening guard, and `openAgentTerminal` handler from `IssueMetadataRail` to the selected-Issue workspace level. Compute:

```ts
const terminalVisible = selected
  ? hasCurrentSessionExecution(events, active, selected.agentSession?.sessionId)
  : false;
```

Pass the same `AgentTerminalAction` to `IssueDetail` when `terminalVisible`, and to `IssueMetadataRail` when it is not. Pass `events`, `active`, current session ID, and `workspaceInfo?.branch` into `IssueDetail`.

- [ ] **Step 4: Remove duplicated rail state**

Change `IssueMetadataRail` props to accept `terminalAction?: ReactNode`. Remove the status `<div>` and `<AgentActivity>`. Keep project, branch/Worktree, source, Agent session, created time, and updated time.

- [ ] **Step 5: Run the workbench tests and verify GREEN**

Run the focused workbench test file and require all tests to pass.

### Task 4: Make the fixed action bar action-only

**Files:**
- Modify: `apps/desktop/test/web/issues.test.tsx`
- Modify: `apps/desktop/src/web/issues/issue-actions.tsx`

- [ ] **Step 1: Write failing action-only tests**

Update the active-operation test to require both “取消 Issue” and “暂停 Agent”. Require the action region not to contain “Issue 正在执行” or its helper description. Add equivalent absence checks for paused, retry, and rebuild action rows while preserving every button and confirmation flow.

- [ ] **Step 2: Run the issues tests and verify RED**

Run the focused issues test command. Expected: the active cancel button is missing and helper copy remains.

- [ ] **Step 3: Simplify normal action rows**

Replace `ActionRow` with a button-only row:

```tsx
function ActionRow({ children }: { children: ReactNode }) {
  return <div className="issue-action-row"><div className="issue-action-buttons">{children}</div></div>;
}
```

For active operations include Cancel plus Pause. Preserve the current ReviewPanel and CapabilityRequestPanel because their inputs and confirmations are operation UI, not helper copy. Reduce finalization failure, retry, rebuild, paused, and fallback rows to their existing actions only; preserve error alerts generated by failed button requests.

- [ ] **Step 4: Run the issues tests and verify GREEN**

Require all Issue detail/action tests to pass.

### Task 5: Apply the approved visual system

**Files:**
- Modify: `apps/desktop/src/web/styles/global.css`

- [ ] **Step 1: Style the transient Terminal**

Add `.codex-terminal`, `.codex-terminal-header`, `.codex-terminal-log`, and `.codex-terminal-latest` rules. Use the current 8px radius and subtle border, a single dark charcoal log surface, monospace command/output, a maximum height around 340px, internal x/y scrolling, and no shadow, gradient, glow, fake chrome, or nested card.

- [ ] **Step 2: Style concise Evidence and Delivery cards**

Keep current `review-section` and Assessment rules. Use compact headings, one conclusion line followed by the existing media gallery, and a small two-row Delivery definition list. Do not introduce count/status styles.

- [ ] **Step 3: Align rail and bottom action bar**

Remove CSS that assumes Agent activity is inside the rail. Keep the rail compact. Remove the action bar’s decorative shadow and style `.issue-action-row` as one action-only row. Preserve responsive stacking and bounded Terminal scrolling under existing media queries.

- [ ] **Step 4: Run focused tests and type/build checks**

Run:

```bash
pnpm --filter @oh-my-bug/desktop test
pnpm --filter @oh-my-bug/desktop typecheck
```

Require zero failures.

### Task 6: Capture and compare both deterministic target states

**Files:**
- Create uncommitted: `.artifacts/visual-diff/issue-detail-terminal-active/actual.png`
- Create uncommitted: `.artifacts/visual-diff/issue-detail-terminal-result/actual.png`

- [ ] **Step 1: Launch the supported local web runtime**

Use the repository’s browser-development transport and deterministic fixture state. Capture the selected Issue detail at 1536×1024 for active Repair and completed Delivery states, excluding no app-owned pixels from the target detail/rail frame.

- [ ] **Step 2: Compare active state**

Run:

```bash
/Users/starrblink/.agents/skills/implement-ui-design/scripts/visual-diff.swift \
  --reference .artifacts/image-reference/issue-detail-terminal-active/reference.png \
  --actual .artifacts/visual-diff/issue-detail-terminal-active/actual.png \
  --output-dir .artifacts/visual-diff/issue-detail-terminal-active
```

Inspect `diff.png` and `overlay.png`. Record any deterministic crop if the supported runtime includes the global navigation/list outside the concept frame; apply the identical crop to active and result captures.

- [ ] **Step 3: Compare result state**

Run the same command with `issue-detail-terminal-result`. Inspect the output. Do not claim pixel parity if the default threshold fails; report residual differences and verify the acceptance invariants visually.

### Task 7: Verify and commit

**Files:**
- Verify all intentional source and test changes.

- [ ] **Step 1: Run full verification**

Run:

```bash
git diff --check
pnpm test
```

Require no whitespace errors and zero failing tests.

- [ ] **Step 2: Verify repository scope**

Run `git status --short`. Require `.artifacts/` to remain ignored and only the plan plus intended app/test files to be tracked.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-08-27-issue-detail-transient-terminal-ui-implementation.md \
  apps/desktop/src/web/app.tsx \
  apps/desktop/src/web/issues/agent-activity.tsx \
  apps/desktop/src/web/issues/issue-actions.tsx \
  apps/desktop/src/web/issues/issue-detail.tsx \
  apps/desktop/src/web/styles/global.css \
  apps/desktop/test/web/agent-activity.test.tsx \
  apps/desktop/test/web/app-workbench.test.tsx \
  apps/desktop/test/web/issues.test.tsx
git commit -m "feat(desktop): redesign issue detail workflow"
```

- [ ] **Step 4: Finish the detached worktree**

Use the finishing workflow, report the commit and verification evidence, then merge to `main` only after confirming the main worktree’s unrelated uncommitted changes remain non-overlapping.
