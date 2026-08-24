# Issue List Live Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update every loaded, non-terminal Issue row when Runtime events arrive, without requiring the user to select that Issue.

**Architecture:** Keep the selected Issue's existing detailed event subscription. Add a focused list-level hook that subscribes only to non-selected, non-terminal Issue IDs and refreshes the affected snapshot after an event. Merge snapshots through a revision-aware callback so background updates cannot replace the selected detail or overwrite newer state.

**Tech Stack:** React 19 hooks, TypeScript, desktop renderer transport, Vitest, Testing Library.

---

### Task 1: Synchronize non-selected Issue rows

**Files:**
- Create: `apps/desktop/src/web/issues/use-issue-list-updates.ts`
- Modify: `apps/desktop/src/web/app.tsx`
- Test: `apps/desktop/test/web/app-workbench.test.tsx`

- [ ] **Step 1: Write the failing integration test**

Add `act` to the Testing Library import and `AgentEventDto` to the API type import. Add this test inside `control center workbench`:

```tsx
it("updates a non-selected Issue row when its Runtime event arrives", async () => {
  const selected: IssueDto = {
    ...issue,
    id: "issue-selected",
    identifier: "CHK-2",
    title: "Selected issue",
    updatedAt: "2026-08-20T09:00:00.000Z",
  };
  const background: IssueDto = {
    ...issue,
    id: "issue-background",
    identifier: "CHK-1",
    title: "Background issue",
    status: "APPROVED",
    revision: 5,
  };
  const terminal: IssueDto = {
    ...issue,
    id: "issue-terminal",
    identifier: "CHK-0",
    title: "Terminal issue",
    status: "COMPLETED",
  };
  const completed: IssueDto = {
    ...background,
    status: "COMPLETED",
    revision: 6,
    updatedAt: "2026-08-20T09:02:00.000Z",
  };
  const listeners = new Map<string, (events: AgentEventDto[], cursor: number) => void>();

  vi.spyOn(api, "integrationPlugins").mockResolvedValue([]);
  vi.spyOn(api, "projects").mockResolvedValue([project]);
  vi.spyOn(api, "issues").mockResolvedValue([background, selected, terminal]);
  vi.spyOn(api, "issue").mockImplementation(async (id) =>
    id === background.id ? completed : selected
  );
  vi.spyOn(api, "integrationHealth").mockResolvedValue({});
  const subscribe = vi.spyOn(api, "subscribeIssueEvents").mockImplementation(
    (id, _cursor, listener) => {
      listeners.set(id, listener);
      return () => listeners.delete(id);
    },
  );

  render(<App />);

  expect(await screen.findByRole("heading", { level: 2, name: "Selected issue" })).toBeVisible();
  await waitFor(() => expect(listeners.has(background.id)).toBe(true));
  expect(subscribe.mock.calls.some(([id]) => id === terminal.id)).toBe(false);

  act(() => listeners.get(background.id)?.([{
    id: "event-completed",
    issueId: background.id,
    sequence: 1,
    type: "ISSUE_COMPLETED",
    actor: "SYSTEM",
    data: {},
    occurredAt: "2026-08-20T09:02:00.000Z",
  }], 1));

  const list = screen.getByRole("region", { name: "Issue 列表" });
  const backgroundRow = within(list).getByRole("button", { name: /CHK-1/ });
  await waitFor(() => expect(within(backgroundRow).getByText("已完成")).toBeVisible());
  expect(screen.getByRole("heading", { level: 2, name: "Selected issue" })).toBeVisible();
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run test/web/app-workbench.test.tsx -t "updates a non-selected Issue row" --configLoader native
```

Expected: FAIL because only `issue-selected` is subscribed and `listeners.has("issue-background")` remains false.

- [ ] **Step 3: Add the minimal list-level subscription hook**

Create `apps/desktop/src/web/issues/use-issue-list-updates.ts`:

```ts
import { useEffect } from "react";

import { api } from "../api/client.js";
import type { IssueDto } from "../api/types.js";

const terminalStatuses = new Set<IssueDto["status"]>([
  "COMPLETED",
  "CLOSED",
  "CANCELED",
]);

export function useIssueListUpdates(
  issues: IssueDto[],
  selectedId: string | undefined,
  onUpdated: (issue: IssueDto) => void,
): void {
  const subscriptionKey = issues
    .filter((issue) => issue.id !== selectedId && !terminalStatuses.has(issue.status))
    .map((issue) => issue.id)
    .sort()
    .join("\u0000");

  useEffect(() => {
    if (!subscriptionKey) return;
    const unsubscribers = subscriptionKey.split("\u0000").map((issueId) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const unsubscribe = api.subscribeIssueEvents(issueId, 0, (events) => {
        if (events.length === 0) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = undefined;
          void api.issue(issueId).then(onUpdated).catch(() => undefined);
        }, 200);
      });
      return () => {
        if (timer) clearTimeout(timer);
        unsubscribe();
      };
    });
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [onUpdated, subscriptionKey]);
}
```

- [ ] **Step 4: Merge snapshots without replacing another selected Issue**

In `apps/desktop/src/web/app.tsx`, import `useIssueListUpdates`. Replace the existing `updateIssue` function with a stable callback declared before `refreshIssue`:

```tsx
const updateIssue = useCallback((issue: IssueDto) => {
  setSelectedIssue((current) => issue.id === selectedId ? issue : current);
  setIssues((current) => newestIssuesFirst(
    current.map((entry) => entry.id === issue.id ? issue : entry),
  ));
}, [selectedId]);
```

Change `refreshIssue` to merge through the same callback:

```tsx
const refreshIssue = useCallback(async () => {
  if (!selectedId) return;
  updateIssue(await api.issue(selectedId));
}, [selectedId, updateIssue]);
```

Delete the old `updateIssue` declaration later in `AppContent`. Replace the selected-Issue loading effect so it uses the same merge callback:

```tsx
useEffect(() => {
  if (!selectedId) return;
  void api
    .issue(selectedId)
    .then(updateIssue)
    .catch((caught) => setError(caught instanceof Error ? caught.message : "Issue 加载失败"));
}, [selectedId, updateIssue]);
```

In `IssueWorkspace`, call the new hook immediately before the selected Issue's detailed hook:

```tsx
useIssueListUpdates(issues, selectedId, onUpdated);
const events = useIssueEvents(selectedId, onRefresh);
```

- [ ] **Step 5: Run the focused test and verify GREEN**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run test/web/app-workbench.test.tsx -t "updates a non-selected Issue row" --configLoader native
```

Expected: PASS; the `CHK-1` row displays `已完成` while `Selected issue` remains open.

- [ ] **Step 6: Commit the first behavior**

```bash
git add apps/desktop/src/web/issues/use-issue-list-updates.ts apps/desktop/src/web/app.tsx apps/desktop/test/web/app-workbench.test.tsx
git commit -m "fix(desktop): update unselected issue statuses"
```

### Task 2: Reject stale Issue snapshots

**Files:**
- Modify: `apps/desktop/src/web/app.tsx`
- Test: `apps/desktop/test/web/app-workbench.test.tsx`

- [ ] **Step 1: Write the stale-snapshot regression test**

Add a second integration test using a selected Issue with a newer revision than the refresh result:

```tsx
it("ignores an older snapshot delivered after a newer Issue revision", async () => {
  const selected: IssueDto = {
    ...issue,
    id: "issue-selected",
    identifier: "CHK-2",
    title: "Selected issue",
    updatedAt: "2026-08-20T09:00:00.000Z",
  };
  const current: IssueDto = {
    ...issue,
    id: "issue-background",
    identifier: "CHK-1",
    title: "Background issue",
    status: "REPAIRING",
    revision: 7,
  };
  const stale: IssueDto = {
    ...current,
    status: "APPROVED",
    revision: 6,
  };
  let backgroundListener: ((events: AgentEventDto[], cursor: number) => void) | undefined;

  vi.spyOn(api, "integrationPlugins").mockResolvedValue([]);
  vi.spyOn(api, "projects").mockResolvedValue([project]);
  vi.spyOn(api, "issues").mockResolvedValue([current, selected]);
  vi.spyOn(api, "issue").mockImplementation(async (id) =>
    id === current.id ? stale : selected
  );
  vi.spyOn(api, "integrationHealth").mockResolvedValue({});
  vi.spyOn(api, "subscribeIssueEvents").mockImplementation((id, _cursor, listener) => {
    if (id === current.id) backgroundListener = listener;
    return () => undefined;
  });

  render(<App />);
  await waitFor(() => expect(backgroundListener).toBeDefined());
  act(() => backgroundListener?.([{
    id: "event-stale",
    issueId: current.id,
    sequence: 1,
    type: "DELIVERY_APPROVED",
    actor: "USER",
    data: {},
    occurredAt: "2026-08-20T09:01:00.000Z",
  }], 1));

  const list = screen.getByRole("region", { name: "Issue 列表" });
  const backgroundRow = within(list).getByRole("button", { name: /CHK-1/ });
  await new Promise((resolve) => setTimeout(resolve, 250));
  expect(within(backgroundRow).getByText("实现中")).toBeVisible();
  expect(within(backgroundRow).queryByText("发布中 / 待重试")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run test/web/app-workbench.test.tsx -t "ignores an older snapshot" --configLoader native
```

Expected: FAIL because revision 6 replaces revision 7 and the row displays `发布中 / 待重试`.

- [ ] **Step 3: Add revision guards to the shared snapshot merge**

Replace `updateIssue` with:

```tsx
const updateIssue = useCallback((issue: IssueDto) => {
  setSelectedIssue((current) =>
    issue.id === selectedId
      && (current?.id !== issue.id || issue.revision >= current.revision)
      ? issue
      : current
  );
  setIssues((current) => newestIssuesFirst(current.map((entry) =>
    entry.id === issue.id && issue.revision >= entry.revision ? issue : entry
  )));
}, [selectedId]);
```

- [ ] **Step 4: Run both list synchronization tests**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run test/web/app-workbench.test.tsx -t "non-selected Issue row|older snapshot" --configLoader native
```

Expected: 2 tests PASS.

- [ ] **Step 5: Commit the revision guard**

```bash
git add apps/desktop/src/web/app.tsx apps/desktop/test/web/app-workbench.test.tsx
git commit -m "fix(desktop): ignore stale issue snapshots"
```

### Task 3: Ignore refreshes after subscription cleanup

**Files:**
- Modify: `apps/desktop/src/web/issues/use-issue-list-updates.ts`
- Create: `apps/desktop/test/web/use-issue-list-updates.test.tsx`

- [ ] **Step 1: Write the failing hook cleanup test**

Create `apps/desktop/test/web/use-issue-list-updates.test.tsx`:

```tsx
// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../src/web/api/client.js";
import type { AgentEventDto, IssueDto } from "../../src/web/api/types.js";
import { useIssueListUpdates } from "../../src/web/issues/use-issue-list-updates.js";

const issue: IssueDto = {
  id: "issue-background",
  projectId: "project-1",
  identifier: "CHK-1",
  title: "Background issue",
  titleSource: "integration",
  status: "REPAIRING",
  inputs: [],
  revision: 1,
  createdAt: "2026-08-20T09:00:00.000Z",
  updatedAt: "2026-08-20T09:00:00.000Z",
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Issue list updates", () => {
  it("ignores a refresh that completes after its subscription is removed", async () => {
    vi.useFakeTimers();
    let listener: ((events: AgentEventDto[], cursor: number) => void) | undefined;
    let resolveSnapshot!: (value: IssueDto) => void;
    const snapshot = new Promise<IssueDto>((resolve) => {
      resolveSnapshot = resolve;
    });
    vi.spyOn(api, "subscribeIssueEvents").mockImplementation((_id, _cursor, next) => {
      listener = next;
      return () => undefined;
    });
    vi.spyOn(api, "issue").mockReturnValue(snapshot);
    const onUpdated = vi.fn();
    const { unmount } = renderHook(() =>
      useIssueListUpdates([issue], undefined, onUpdated)
    );

    act(() => listener?.([{
      id: "event-1",
      issueId: issue.id,
      sequence: 1,
      type: "REPAIR_STARTED",
      actor: "SYSTEM",
      data: {},
      occurredAt: "2026-08-20T09:01:00.000Z",
    }], 1));
    await act(() => vi.advanceTimersByTimeAsync(200));
    unmount();
    await act(async () => {
      resolveSnapshot({ ...issue, revision: 2 });
      await snapshot;
    });

    expect(onUpdated).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run test/web/use-issue-list-updates.test.tsx --configLoader native
```

Expected: FAIL because the promise callback invokes `onUpdated` after unmount.

- [ ] **Step 3: Guard asynchronous refresh completion**

Inside each subscription created by `useIssueListUpdates`, add an active flag and check it before merging:

```ts
let active = true;
let timer: ReturnType<typeof setTimeout> | undefined;
const unsubscribe = api.subscribeIssueEvents(issueId, 0, (events) => {
  if (!active || events.length === 0) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    void api.issue(issueId).then((issue) => {
      if (active) onUpdated(issue);
    }).catch(() => undefined);
  }, 200);
});
return () => {
  active = false;
  if (timer) clearTimeout(timer);
  unsubscribe();
};
```

- [ ] **Step 4: Run the hook and integration tests**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run test/web/use-issue-list-updates.test.tsx test/web/app-workbench.test.tsx --configLoader native
```

Expected: both files PASS with no unhandled errors.

- [ ] **Step 5: Commit cleanup safety**

```bash
git add apps/desktop/src/web/issues/use-issue-list-updates.ts apps/desktop/test/web/use-issue-list-updates.test.tsx
git commit -m "test(desktop): cover issue list subscription cleanup"
```

### Task 4: Verify the completed change

**Files:**
- Verify only; no production edits expected.

- [ ] **Step 1: Run formatting and whitespace validation**

Run:

```bash
git diff --check HEAD~3..HEAD
```

Expected: exit 0 with no output.

- [ ] **Step 2: Run the complete desktop suite**

Run:

```bash
pnpm --filter @oh-my-bug/desktop test
```

Expected: all desktop test files and tests PASS.

- [ ] **Step 3: Run repository typechecking**

Run:

```bash
pnpm typecheck
```

Expected: all workspace and repository TypeScript checks PASS.

- [ ] **Step 4: Run the complete test suite**

Run:

```bash
pnpm test
```

Expected: all workspace and repository tests PASS. Runtime evidence tests may require execution outside the sandbox because they bind localhost ports and launch Electron.

- [ ] **Step 5: Inspect the final scope**

Run:

```bash
git status --short
git diff --stat HEAD~3..HEAD
```

Expected: only the user's pre-existing uncommitted files remain; the three implementation commits contain the hook, App integration, and regression tests.
