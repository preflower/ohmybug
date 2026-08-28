# macOS Menu Bar Task List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generic macOS status icon with an Oh My Bug ?! template icon and make both tray click types open a two-section native menu that navigates to pending Issues.

**Architecture:** Keep status labels and task grouping in renderer-independent pure modules, wrap native-menu behavior in a dependency-injected controller, and send tray selections to the renderer over one validated main-to-renderer channel. Copy dedicated standard and Retina template assets into the compiled Electron tree so development and packaged builds resolve the same relative URL.

**Tech Stack:** Electron 43, TypeScript 6, React 19, Vitest 4, Testing Library, Sharp, Electron Forge/Vite build scripts.

---

## File structure

- Create `apps/desktop/src/shared/issue-status.ts`: shared Chinese labels and terminal-status predicate.
- Create `apps/desktop/src/electron/tray-task-model.ts`: pure classification, sorting, truncation, and four-row cap.
- Create `apps/desktop/src/electron/tray-menu-controller.ts`: native menu template creation and in-flight click suppression.
- Create `apps/desktop/src/electron/tray-navigation.ts`: queue the latest tray navigation until the renderer is ready.
- Modify `apps/desktop/src/electron/desktop-api.ts`: add the fixed tray navigation channel and validated subscription.
- Modify `apps/desktop/src/electron/main.ts`: create the branded tray, wire both click events, load Issues, and dispatch navigation.
- Modify `apps/desktop/src/web/issues/issue-status.tsx`: consume the shared label map.
- Modify `apps/desktop/src/web/app.tsx`: respond to tray navigation and handle stale targets safely.
- Create `apps/desktop/assets/icons/oh-my-bug-trayTemplate.png`: 18-by-18 template asset.
- Create `apps/desktop/assets/icons/oh-my-bug-trayTemplate@2x.png`: 36-by-36 Retina template asset.
- Modify `apps/desktop/scripts/copy-runtime-assets.ts`: copy tray assets into the compiled desktop tree.
- Modify `apps/desktop/scripts/packaged-runtime.ts`: declare the two tray asset build paths.
- Create `apps/desktop/test/electron/tray-task-model.test.ts`: pure model coverage.
- Create `apps/desktop/test/electron/tray-menu-controller.test.ts`: menu controller coverage.
- Create `apps/desktop/test/electron/tray-navigation.test.ts`: pending navigation coverage.
- Modify `apps/desktop/test/electron/desktop-api.test.ts`: preload subscription validation and cleanup.
- Modify `apps/desktop/test/web/app-workbench.test.tsx`: tray-to-Issue navigation behavior.
- Modify `apps/desktop/test/web/app-icon.test.ts`: template bitmap geometry checks.
- Modify `apps/desktop/test/electron/packaging.test.ts`: compiled tray asset layout checks.

### Task 1: Share Issue labels and build the tray task model

**Files:**
- Create: `apps/desktop/src/shared/issue-status.ts`
- Create: `apps/desktop/src/electron/tray-task-model.ts`
- Create: `apps/desktop/test/electron/tray-task-model.test.ts`
- Modify: `apps/desktop/src/web/issues/issue-status.tsx`

- [ ] **Step 1: Write failing classification, ordering, cap, and truncation tests**

Create `apps/desktop/test/electron/tray-task-model.test.ts` with a minimal Issue factory and these assertions:

```ts
import { describe, expect, it } from "vitest";

import {
  buildTrayTaskModel,
  classifyTrayStatus,
  truncateTrayTitle,
  type TrayIssue,
} from "../../src/electron/tray-task-model.js";

const attention = [
  "ASSESSMENT_REVIEW", "PERMISSION_REQUIRED", "ACCEPTANCE_REVIEW",
  "ASSESSMENT_FAILED", "EVIDENCE_FAILED", "REPAIR_FAILED", "FINALIZATION_FAILED",
] as const;
const processing = [
  "RECEIVED", "ASSESSING", "REPAIRING", "EVIDENCE_CAPTURE",
  "EVIDENCE_CHECK", "FINALIZING", "FINALIZATION_RECOVERY",
] as const;
const terminal = ["COMPLETED", "CLOSED", "CANCELED"] as const;

function issue(
  identifier: string,
  status: TrayIssue["status"],
  updatedAt: string,
  title = `Title ${identifier}`,
): TrayIssue {
  return { id: identifier.toLowerCase(), identifier, status, title, updatedAt };
}

describe("tray task model", () => {
  it("classifies every Issue status without leaving an implicit case", () => {
    for (const status of attention) expect(classifyTrayStatus(status)).toBe("attention");
    for (const status of processing) expect(classifyTrayStatus(status)).toBe("processing");
    for (const status of terminal) expect(classifyTrayStatus(status)).toBeNull();
  });

  it("sorts newest first, limits each section to four, and reports total overflow", () => {
    const issues = [1, 2, 3, 4, 5].map((number) => issue(
      `CHK-${number}`,
      "ASSESSMENT_REVIEW",
      `2026-08-25T10:0${number}:00.000Z`,
    ));
    const model = buildTrayTaskModel([
      ...issues,
      issue("CHK-9", "REPAIRING", "2026-08-25T11:00:00.000Z"),
      issue("CHK-10", "COMPLETED", "2026-08-25T12:00:00.000Z"),
    ]);

    expect(model.attention.total).toBe(5);
    expect(model.attention.overflow).toBe(1);
    expect(model.attention.items.map((item) => item.identifier)).toEqual([
      "CHK-5", "CHK-4", "CHK-3", "CHK-2",
    ]);
    expect(model.processing.items.map((item) => item.identifier)).toEqual(["CHK-9"]);
    expect(model.processing.total).toBe(1);
  });

  it("uses numeric identifiers as a deterministic timestamp tie-breaker", () => {
    const time = "2026-08-25T10:00:00.000Z";
    const model = buildTrayTaskModel([
      issue("CHK-2", "REPAIRING", time),
      issue("CHK-10", "REPAIRING", time),
    ]);
    expect(model.processing.items.map((item) => item.identifier)).toEqual(["CHK-10", "CHK-2"]);
  });

  it("truncates title text at 32 grapheme clusters without splitting emoji", () => {
    expect(truncateTrayTitle("修复🧑🏽‍💻".repeat(20))).toBe(`${"修复🧑🏽‍💻".repeat(10)}修复…`);
    expect(truncateTrayTitle("short title")).toBe("short title");
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/electron/tray-task-model.test.ts
```

Expected: FAIL because `tray-task-model.js` does not exist.

- [ ] **Step 3: Add the shared status map and pure model**

Create `apps/desktop/src/shared/issue-status.ts`:

```ts
import type { RuntimeOperationOutput } from "@oh-my-bug/runtime/protocol";

export type DesktopIssueStatus = RuntimeOperationOutput<"getIssue">["status"];

export const issueStatusLabels: Record<DesktopIssueStatus, string> = {
  RECEIVED: "等待分析",
  ASSESSING: "分析中",
  ASSESSMENT_REVIEW: "待确认判断",
  ASSESSMENT_FAILED: "分析失败",
  PERMISSION_REQUIRED: "权限不足",
  REPAIRING: "实现中",
  EVIDENCE_CAPTURE: "实现完成，正在采集证据",
  EVIDENCE_CHECK: "证据检查中",
  EVIDENCE_FAILED: "证据采集失败",
  REPAIR_FAILED: "实现失败",
  ACCEPTANCE_REVIEW: "待验收",
  FINALIZING: "交付处理中",
  FINALIZATION_RECOVERY: "AI 正在恢复交付",
  FINALIZATION_FAILED: "交付失败，待重试",
  COMPLETED: "已完成",
  CLOSED: "已关闭",
  CANCELED: "已取消",
};

export function isTerminalIssueStatus(status: DesktopIssueStatus): boolean {
  return status === "COMPLETED" || status === "CLOSED" || status === "CANCELED";
}
```

Create `apps/desktop/src/electron/tray-task-model.ts`:

```ts
import { issueStatusLabels, type DesktopIssueStatus } from "../shared/issue-status.js";

export interface TrayIssue {
  id: string;
  identifier: string;
  title: string;
  status: DesktopIssueStatus;
  updatedAt: string;
}

export type TrayTaskGroup = "attention" | "processing";
export interface TrayTaskItem extends TrayIssue { label: string }
export interface TrayTaskSection { items: TrayTaskItem[]; total: number; overflow: number }
export interface TrayTaskModel { attention: TrayTaskSection; processing: TrayTaskSection }

const attention = new Set<DesktopIssueStatus>([
  "ASSESSMENT_REVIEW", "PERMISSION_REQUIRED", "ACCEPTANCE_REVIEW",
  "ASSESSMENT_FAILED", "EVIDENCE_FAILED", "REPAIR_FAILED", "FINALIZATION_FAILED",
]);
const processing = new Set<DesktopIssueStatus>([
  "RECEIVED", "ASSESSING", "REPAIRING", "EVIDENCE_CAPTURE",
  "EVIDENCE_CHECK", "FINALIZING", "FINALIZATION_RECOVERY",
]);
const segmenter = new Intl.Segmenter("zh-CN", { granularity: "grapheme" });

export function classifyTrayStatus(status: DesktopIssueStatus): TrayTaskGroup | null {
  if (attention.has(status)) return "attention";
  if (processing.has(status)) return "processing";
  return null;
}

export function truncateTrayTitle(title: string, limit = 32): string {
  const graphemes = [...segmenter.segment(title)].map((entry) => entry.segment);
  return graphemes.length <= limit ? title : `${graphemes.slice(0, limit).join("")}…`;
}

export function buildTrayTaskModel(issues: TrayIssue[], limit = 4): TrayTaskModel {
  const grouped: Record<TrayTaskGroup, TrayIssue[]> = { attention: [], processing: [] };
  for (const issue of issues) {
    const group = classifyTrayStatus(issue.status);
    if (group) grouped[group].push(issue);
  }
  const section = (entries: TrayIssue[]): TrayTaskSection => {
    const ordered = [...entries].sort((left, right) => {
      const time = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
      return time || right.identifier.localeCompare(left.identifier, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });
    return {
      total: ordered.length,
      overflow: Math.max(0, ordered.length - limit),
      items: ordered.slice(0, limit).map((issue) => ({
        ...issue,
        label: `${issue.identifier} · ${truncateTrayTitle(issue.title)} — ${issueStatusLabels[issue.status]}`,
      })),
    };
  };
  return { attention: section(grouped.attention), processing: section(grouped.processing) };
}
```

Remove the local `issueStatusLabels` declaration from `apps/desktop/src/web/issues/issue-status.tsx` and import it from `../../shared/issue-status.js`.

- [ ] **Step 4: Run model and existing status tests and verify GREEN**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/electron/tray-task-model.test.ts test/web/issues.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the model**

```bash
git add apps/desktop/src/shared/issue-status.ts apps/desktop/src/electron/tray-task-model.ts apps/desktop/src/web/issues/issue-status.tsx apps/desktop/test/electron/tray-task-model.test.ts
git commit -m "feat(desktop): model pending tray tasks"
```

### Task 2: Build the dependency-injected native menu controller

**Files:**
- Create: `apps/desktop/src/electron/tray-menu-controller.ts`
- Create: `apps/desktop/test/electron/tray-menu-controller.test.ts`

- [ ] **Step 1: Write failing menu construction and click-suppression tests**

Create `apps/desktop/test/electron/tray-menu-controller.test.ts`. Use one attention Issue and one processing Issue, capture the template passed to `buildMenu`, and assert this exact structure and behavior:

```ts
import { describe, expect, it, vi } from "vitest";

import { TrayMenuController, type TrayMenuEntry } from "../../src/electron/tray-menu-controller.js";

const review = {
  id: "issue-1", identifier: "CHK-1", title: "Review checkout",
  status: "ASSESSMENT_REVIEW" as const, updatedAt: "2026-08-25T10:00:00.000Z",
};
const repairing = {
  id: "issue-2", identifier: "CHK-2", title: "Repair checkout",
  status: "REPAIRING" as const, updatedAt: "2026-08-25T11:00:00.000Z",
};

function setup(loadIssues = vi.fn(async () => [review, repairing])) {
  let template: TrayMenuEntry[] = [];
  const menu = { native: true };
  const options = {
    loadIssues,
    buildMenu: vi.fn((next: TrayMenuEntry[]) => { template = next; return menu; }),
    popUp: vi.fn(),
    openIssue: vi.fn(),
    openAll: vi.fn(),
    quit: vi.fn(),
  };
  return { controller: new TrayMenuController(options), options, menu, get template() { return template; } };
}

describe("tray menu controller", () => {
  it("builds two bounded task groups and dispatches row actions", async () => {
    const fixture = setup();
    await fixture.controller.open();
    expect(fixture.template.map((item) => item.label ?? item.type)).toEqual([
      "需要你操作 (1)", "CHK-1 · Review checkout — 待确认判断",
      "separator", "AI 处理中 (1)", "CHK-2 · Repair checkout — 实现中",
      "separator", "打开全部 Issues", "退出 Oh My Bug ?!",
    ]);
    fixture.template[1]!.click?.();
    fixture.template.at(-2)!.click?.();
    fixture.template.at(-1)!.click?.();
    expect(fixture.options.openIssue).toHaveBeenCalledWith("issue-1");
    expect(fixture.options.openAll).toHaveBeenCalledOnce();
    expect(fixture.options.quit).toHaveBeenCalledOnce();
    expect(fixture.options.popUp).toHaveBeenCalledWith(fixture.menu);
  });

  it("shows empty and unavailable menus without losing permanent actions", async () => {
    const empty = setup(vi.fn(async () => []));
    await empty.controller.open();
    expect(empty.template.map((item) => item.label ?? item.type)).toEqual([
      "暂无待处理任务", "separator", "打开全部 Issues", "退出 Oh My Bug ?!",
    ]);

    const unavailable = setup(vi.fn(async () => { throw new Error("UTILITY_NOT_READY"); }));
    await unavailable.controller.open();
    expect(unavailable.template.map((item) => item.label ?? item.type)).toEqual([
      "任务列表暂不可用", "separator", "打开全部 Issues", "退出 Oh My Bug ?!",
    ]);
  });

  it("shares one in-flight load across rapid repeated clicks", async () => {
    let resolve: ((issues: (typeof review)[]) => void) | undefined;
    const load = vi.fn(() => new Promise<(typeof review)[]>((next) => { resolve = next; }));
    const fixture = setup(load);
    const first = fixture.controller.open();
    const second = fixture.controller.open();
    expect(load).toHaveBeenCalledOnce();
    resolve?.([review]);
    await Promise.all([first, second]);
    expect(fixture.options.popUp).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/electron/tray-menu-controller.test.ts
```

Expected: FAIL because the controller does not exist.

- [ ] **Step 3: Implement the minimal controller**

Create `apps/desktop/src/electron/tray-menu-controller.ts` with:

```ts
import { buildTrayTaskModel, type TrayIssue, type TrayTaskSection } from "./tray-task-model.js";

export interface TrayMenuEntry {
  label?: string;
  type?: "separator";
  enabled?: boolean;
  click?: () => void;
}

interface TrayMenuControllerOptions<Menu> {
  loadIssues(): Promise<TrayIssue[]>;
  buildMenu(template: TrayMenuEntry[]): Menu;
  popUp(menu: Menu): void;
  openIssue(issueId: string): void;
  openAll(): void;
  quit(): void;
}

export class TrayMenuController<Menu> {
  private opening?: Promise<void>;
  constructor(private readonly options: TrayMenuControllerOptions<Menu>) {}

  open(): Promise<void> {
    this.opening ??= this.loadAndOpen().finally(() => { this.opening = undefined; });
    return this.opening;
  }

  private async loadAndOpen(): Promise<void> {
    let entries: TrayMenuEntry[];
    try {
      entries = taskEntries(await this.options.loadIssues(), this.options.openIssue, this.options.openAll);
    } catch {
      entries = permanentEntries(
        [{ label: "任务列表暂不可用", enabled: false }],
        this.options.openAll,
        this.options.quit,
      );
      this.options.popUp(this.options.buildMenu(entries));
      return;
    }
    this.options.popUp(this.options.buildMenu([
      ...entries,
      { label: "退出 Oh My Bug ?!", click: this.options.quit },
    ]));
  }
}

function sectionEntries(
  heading: string,
  section: TrayTaskSection,
  openIssue: (issueId: string) => void,
  openAll: () => void,
): TrayMenuEntry[] {
  if (section.total === 0) return [];
  return [
    { label: `${heading} (${section.total})`, enabled: false },
    ...section.items.map((item) => ({ label: item.label, click: () => openIssue(item.id) })),
    ...(section.overflow > 0 ? [{ label: `还有 ${section.overflow} 条…`, click: openAll }] : []),
  ];
}

function taskEntries(
  issues: TrayIssue[],
  openIssue: (issueId: string) => void,
  openAll: () => void,
): TrayMenuEntry[] {
  const model = buildTrayTaskModel(issues);
  const attention = sectionEntries("需要你操作", model.attention, openIssue, openAll);
  const processing = sectionEntries("AI 处理中", model.processing, openIssue, openAll);
  const taskArea = attention.length || processing.length
    ? [...attention, ...(attention.length && processing.length ? [{ type: "separator" as const }] : []), ...processing]
    : [{ label: "暂无待处理任务", enabled: false }];
  return [...taskArea, { type: "separator" }, { label: "打开全部 Issues", click: openAll }];
}

function permanentEntries(
  taskArea: TrayMenuEntry[],
  openAll: () => void,
  quit: () => void,
): TrayMenuEntry[] {
  return [
    ...taskArea,
    { type: "separator" },
    { label: "打开全部 Issues", click: openAll },
    { label: "退出 Oh My Bug ?!", click: quit },
  ];
}
```

Keep `taskEntries`/`permanentEntries` factored so both success and failure paths create exactly one quit row.

- [ ] **Step 4: Run controller tests and verify GREEN**

Run the controller test command from Step 2. Expected: PASS with no unhandled rejection warnings.

- [ ] **Step 5: Commit the controller**

```bash
git add apps/desktop/src/electron/tray-menu-controller.ts apps/desktop/test/electron/tray-menu-controller.test.ts
git commit -m "feat(desktop): build native tray task menu"
```

### Task 3: Add the validated navigation channel and ready queue

**Files:**
- Create: `apps/desktop/src/electron/tray-navigation.ts`
- Create: `apps/desktop/test/electron/tray-navigation.test.ts`
- Modify: `apps/desktop/src/electron/desktop-api.ts`
- Modify: `apps/desktop/test/electron/desktop-api.test.ts`

- [ ] **Step 1: Write failing queue and preload subscription tests**

Create `tray-navigation.test.ts` to verify that requests queue before readiness, the newest queued target wins, `{}` represents open-all, and `setReady(false)` starts queueing again:

```ts
import { describe, expect, it, vi } from "vitest";
import { TrayNavigationQueue } from "../../src/electron/tray-navigation.js";

it("delivers only after ready and retains the latest pending target", () => {
  const send = vi.fn();
  const queue = new TrayNavigationQueue(send);
  queue.request({ issueId: "issue-1" });
  queue.request({ issueId: "issue-2" });
  expect(send).not.toHaveBeenCalled();
  queue.setReady(true);
  expect(send).toHaveBeenCalledWith({ issueId: "issue-2" });
  queue.request({});
  expect(send).toHaveBeenLastCalledWith({});
  queue.setReady(false);
  queue.request({ issueId: "issue-3" });
  expect(send).toHaveBeenCalledTimes(2);
});
```

Extend `desktop-api.test.ts` so `Object.keys(api)` includes `onTrayNavigation`, then capture the registered channel listener and assert valid values are forwarded while malformed values are ignored and cleanup calls `removeListener` with the same function:

```ts
const listener = vi.fn();
const stop = api.onTrayNavigation(listener);
const onTrayNavigation = ipc.on.mock.calls.find(([channel]) =>
  channel === "oh-my-bug:tray-navigation"
)?.[1];
onTrayNavigation({}, { issueId: "issue-1" });
onTrayNavigation({}, {});
onTrayNavigation({}, { issueId: "" });
onTrayNavigation({}, { issueId: 4 });
expect(listener.mock.calls).toEqual([[{ issueId: "issue-1" }], [{}]]);
stop();
expect(ipc.removeListener).toHaveBeenCalledWith(
  "oh-my-bug:tray-navigation",
  onTrayNavigation,
);
```

- [ ] **Step 2: Run both tests and verify RED**

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/electron/tray-navigation.test.ts test/electron/desktop-api.test.ts
```

Expected: FAIL because the queue, channel, and method are missing.

- [ ] **Step 3: Implement the queue and restricted preload API**

Create `tray-navigation.ts`:

```ts
export interface TrayNavigationTarget { issueId?: string }

export class TrayNavigationQueue {
  private ready = false;
  private pending?: TrayNavigationTarget;
  constructor(private readonly send: (target: TrayNavigationTarget) => void) {}
  setReady(ready: boolean): void {
    this.ready = ready;
    this.flush();
  }
  request(target: TrayNavigationTarget): void {
    this.pending = target;
    this.flush();
  }
  private flush(): void {
    if (!this.ready || !this.pending) return;
    const target = this.pending;
    this.pending = undefined;
    this.send(target);
  }
}
```

In `desktop-api.ts`, export `TRAY_NAVIGATION_CHANNEL`, export the same `TrayNavigationTarget` type from `tray-navigation.ts`, add `onTrayNavigation` to `DesktopApi`, and add this named subscription:

```ts
onTrayNavigation: (listener) => {
  const onNavigation = (_event: unknown, value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const issueId = (value as { issueId?: unknown }).issueId;
    if (issueId === undefined) listener({});
    else if (typeof issueId === "string" && issueId.trim().length > 0) listener({ issueId });
  };
  ipc.on(TRAY_NAVIGATION_CHANNEL, onNavigation);
  return () => ipc.removeListener(TRAY_NAVIGATION_CHANNEL, onNavigation);
},
```

- [ ] **Step 4: Run tests and verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit navigation primitives**

```bash
git add apps/desktop/src/electron/tray-navigation.ts apps/desktop/src/electron/desktop-api.ts apps/desktop/test/electron/tray-navigation.test.ts apps/desktop/test/electron/desktop-api.test.ts
git commit -m "feat(desktop): bridge tray Issue navigation"
```

### Task 4: Navigate the React workbench to tray-selected Issues

**Files:**
- Modify: `apps/desktop/src/web/app.tsx`
- Modify: `apps/desktop/test/web/app-workbench.test.tsx`

- [ ] **Step 1: Write failing workbench navigation tests**

Add two tests to `app-workbench.test.tsx`. Build a frozen bridge stub with `onTrayNavigation` that captures the listener, stub Runtime APIs as existing workbench tests do, and verify:

```ts
let navigate: ((target: { issueId?: string }) => void) | undefined;
const stopNavigation = vi.fn();
Object.defineProperty(window, "ohMyBug", {
  configurable: true,
  value: Object.freeze({
    onTrayNavigation: vi.fn((listener) => {
      navigate = listener;
      return stopNavigation;
    }),
  }),
});

// After rendering, first click a project shortcut so the list is filtered.
act(() => navigate?.({ issueId: issue.id }));
expect(window.location.hash).toBe("#/issues");
expect(screen.getByText("全部", { selector: ".breadcrumb span:last-child" })).toBeVisible();
expect(await screen.findByRole("heading", { level: 2, name: issue.title })).toBeVisible();

// A rejected getIssue for a stale tray ID clears the selection and leaves the full list usable.
act(() => navigate?.({ issueId: "missing-issue" }));
await waitFor(() => expect(api.issue).toHaveBeenCalledWith("missing-issue"));
expect(screen.queryByRole("region", { name: "Issue 详情" })).not.toBeInTheDocument();
```

Add a cleanup assertion by unmounting and expecting `stopNavigation` once. In the second test, return a terminal Issue for the tray target and assert the same unfiltered/no-selection fallback.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/web/app-workbench.test.tsx
```

Expected: FAIL because `App` does not subscribe to tray navigation.

- [ ] **Step 3: Implement tray navigation in `AppContent`**

Import `isTerminalIssueStatus` and `TrayNavigationTarget`. Add a ref that marks selections originating from the tray:

```ts
const traySelection = useRef<string>();

useEffect(() => window.ohMyBug?.onTrayNavigation((target: TrayNavigationTarget) => {
  writeRoute("issues");
  setView("issues");
  setActiveProjectId(undefined);
  setProjectEditor(undefined);
  setProjectInspection(undefined);
  traySelection.current = target.issueId;
  setSelectedId(target.issueId);
  setSelectedIssue(undefined);
}) ?? (() => undefined), []);
```

Update the existing `selectedId` loading effect so only tray-originated missing or terminal targets fall back without changing normal in-app selection behavior:

```ts
useEffect(() => {
  if (!selectedId) return;
  const fromTray = traySelection.current === selectedId;
  void api.issue(selectedId).then((next) => {
    if (fromTray) traySelection.current = undefined;
    if (fromTray && isTerminalIssueStatus(next.status)) {
      setSelectedId(undefined);
      setSelectedIssue(undefined);
      return;
    }
    updateIssue(next);
  }).catch((caught) => {
    if (fromTray) {
      traySelection.current = undefined;
      setSelectedId(undefined);
      setSelectedIssue(undefined);
      return;
    }
    setError(caught instanceof Error ? caught.message : "Issue 加载失败");
  });
}, [selectedId, updateIssue]);
```

- [ ] **Step 4: Run workbench and preload tests and verify GREEN**

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/web/app-workbench.test.tsx test/electron/desktop-api.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit renderer navigation**

```bash
git add apps/desktop/src/web/app.tsx apps/desktop/test/web/app-workbench.test.tsx
git commit -m "feat(desktop): open tray-selected Issues"
```

### Task 5: Create and package the macOS template icon

**Files:**
- Create: `apps/desktop/assets/icons/oh-my-bug-trayTemplate.png`
- Create: `apps/desktop/assets/icons/oh-my-bug-trayTemplate@2x.png`
- Modify: `apps/desktop/scripts/copy-runtime-assets.ts`
- Modify: `apps/desktop/scripts/packaged-runtime.ts`
- Modify: `apps/desktop/test/web/app-icon.test.ts`
- Modify: `apps/desktop/test/electron/packaging.test.ts`

- [ ] **Step 1: Write failing icon geometry and build-layout tests**

Extend `app-icon.test.ts` with a table over the standard and Retina files. For each, use Sharp `metadata()` and raw RGBA data to assert the exact square dimensions, four channels, transparent corners, nonempty artwork, and an opaque bounding box that stays within one logical pixel of padding while occupying at least 70% of the canvas in both axes.

```ts
for (const [name, size] of [
  ["oh-my-bug-trayTemplate.png", 18],
  ["oh-my-bug-trayTemplate@2x.png", 36],
] as const) {
  const path = resolve(desktopRoot, "assets/icons", name);
  expect(existsSync(path)).toBe(true);
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  expect({ width: info.width, height: info.height, channels: info.channels }).toEqual({
    width: size, height: size, channels: 4,
  });
  expect(data[3]).toBe(0);
  let minX = size;
  let minY = size;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const alpha = data[(y * size + x) * 4 + 3]!;
      if (alpha <= 32) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  const padding = size / 18;
  expect(minX).toBeGreaterThanOrEqual(padding);
  expect(minY).toBeGreaterThanOrEqual(padding);
  expect(maxX).toBeLessThan(size - padding);
  expect(maxY).toBeLessThan(size - padding);
  expect(maxX - minX + 1).toBeGreaterThanOrEqual(Math.floor(size * 0.7));
  expect(maxY - minY + 1).toBeGreaterThanOrEqual(Math.floor(size * 0.7));
}
```

Extend `packaging.test.ts`:

```ts
expect(desktopBuildLayout).toMatchObject({
  trayIcon: ".vite/build/apps/desktop/assets/icons/oh-my-bug-trayTemplate.png",
  trayIcon2x: ".vite/build/apps/desktop/assets/icons/oh-my-bug-trayTemplate@2x.png",
});
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/web/app-icon.test.ts test/electron/packaging.test.ts
```

Expected: FAIL because the two files and build-layout keys do not exist.

- [ ] **Step 3: Generate the dedicated mascot silhouette assets**

Before editing bitmap assets, invoke the `imagegen` skill. Use `apps/desktop/assets/icons/oh-my-bug.png` as the visual reference and this constraint-focused prompt:

```text
Create a macOS menu bar template icon derived from this exact Oh My Bug ?! mascot: preserve the rounded bug head, winking face, oval eye, question-mark antenna and exclamation-mark antenna. Render a single flat opaque black silhouette/details on a fully transparent square canvas, no gradients, shadows, gray, background, border, text, or extra marks. It must remain recognizable at 18x18 pixels with balanced one-pixel safe padding.
```

Use the approved result as the source and downsample with Sharp/Lanczos to exactly 36-by-36 and 18-by-18 RGBA PNGs. Inspect both output files with the image viewer at original resolution and against light and dark solid backgrounds before keeping them. Name them exactly as listed so macOS discovers the Retina representation and Electron can mark the image as a template.

- [ ] **Step 4: Declare and copy compiled asset paths**

Add to `desktopBuildLayout`:

```ts
trayIcon: ".vite/build/apps/desktop/assets/icons/oh-my-bug-trayTemplate.png",
trayIcon2x: ".vite/build/apps/desktop/assets/icons/oh-my-bug-trayTemplate@2x.png",
```

In `copy-runtime-assets.ts`, export and call this helper at the end of `copyRuntimeAssets` before verification:

```ts
export async function copyDesktopAssets(root = projectRoot): Promise<void> {
  const source = resolve(root, "apps/desktop/assets/icons");
  const destination = resolve(root, ".vite/build/apps/desktop/assets/icons");
  await mkdir(destination, { recursive: true });
  for (const name of ["oh-my-bug-trayTemplate.png", "oh-my-bug-trayTemplate@2x.png"]) {
    await copyFile(resolve(source, name), resolve(destination, name));
  }
}
```

- [ ] **Step 5: Run asset tests, build Electron, and verify GREEN**

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/web/app-icon.test.ts test/electron/packaging.test.ts
pnpm build:electron
```

Expected: tests PASS and `verifyElectronBuild` finds both compiled icon paths.

- [ ] **Step 6: Commit icon assets and packaging**

```bash
git add apps/desktop/assets/icons/oh-my-bug-trayTemplate.png apps/desktop/assets/icons/oh-my-bug-trayTemplate@2x.png apps/desktop/scripts/copy-runtime-assets.ts apps/desktop/scripts/packaged-runtime.ts apps/desktop/test/web/app-icon.test.ts apps/desktop/test/electron/packaging.test.ts
git commit -m "feat(desktop): package branded tray icon"
```

### Task 6: Wire the tray controller into Electron main

**Files:**
- Modify: `apps/desktop/src/electron/main.ts`
- Modify: `apps/desktop/test/electron/tray-menu-controller.test.ts`
- Modify: `apps/desktop/test/electron/tray-navigation.test.ts`

- [ ] **Step 1: Add failing tests for both tray click event types**

Add an exported helper to the intended controller API and tests that use an `EventEmitter` tray plus a mocked controller:

```ts
const tray = new EventEmitter();
const controller = { open: vi.fn(async () => undefined) };
installTrayMenuEvents(tray, controller);
tray.emit("click");
tray.emit("right-click");
expect(controller.open).toHaveBeenCalledTimes(2);
```

Also extend the navigation queue test to verify a ready `{ issueId }` request immediately calls the supplied sender with exactly that object.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/electron/tray-menu-controller.test.ts test/electron/tray-navigation.test.ts
```

Expected: FAIL because `installTrayMenuEvents` is missing.

- [ ] **Step 3: Add the click installer and main-process wiring**

Add this narrow helper to `tray-menu-controller.ts`:

```ts
interface TrayEventSource {
  on(event: "click" | "right-click", listener: () => void): unknown;
}
interface OpenableTrayMenu { open(): Promise<void> }

export function installTrayMenuEvents(tray: TrayEventSource, menu: OpenableTrayMenu): void {
  const open = () => { void menu.open(); };
  tray.on("click", open);
  tray.on("right-click", open);
}
```

In `main.ts`:

1. Remove `nativeImage.createFromNamedImage("NSStatusAvailable")`, the static `setContextMenu`, and the old click-to-window handler.
2. Resolve the compiled image with `fileURLToPath(new URL("../../assets/icons/oh-my-bug-trayTemplate.png", import.meta.url))`, load it with `nativeImage.createFromPath`, assert it is nonempty, and call `setTemplateImage(true)`.
3. Create one `TrayNavigationQueue` whose sender calls `mainWindow.webContents.send(TRAY_NAVIGATION_CHANNEL, target)` when the window exists.
4. Set the queue not-ready before each `BrowserWindow` creation and ready inside `did-finish-load`, alongside the existing Runtime state send.
5. Add `openIssues(target)` that calls `showMainWindow()` and then queues the target.
6. Construct `TrayMenuController<Menu>` with these dependencies:

```ts
loadIssues: () => supervisor!.client().request("listIssues", {}),
buildMenu: (template) => Menu.buildFromTemplate(template),
popUp: (menu) => tray?.popUpContextMenu(menu),
openIssue: (issueId) => openIssues({ issueId }),
openAll: () => openIssues({}),
quit: () => { void quitApplication(); },
```

7. Call `installTrayMenuEvents(tray, trayMenuController)` and keep the existing tooltip.

Use only the base `Template.png` path; the adjacent `@2x` file supplies the Retina representation. Do not call `setContextMenu`, which would compete with the explicit click handlers.

- [ ] **Step 4: Run focused tests, type checking, and Electron build**

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/electron/tray-menu-controller.test.ts test/electron/tray-navigation.test.ts test/electron/desktop-api.test.ts
pnpm --filter @oh-my-bug/desktop typecheck
pnpm build:electron
```

Expected: all commands PASS.

- [ ] **Step 5: Commit main-process integration**

```bash
git add apps/desktop/src/electron/main.ts apps/desktop/src/electron/tray-menu-controller.ts apps/desktop/test/electron/tray-menu-controller.test.ts apps/desktop/test/electron/tray-navigation.test.ts
git commit -m "feat(desktop): show pending Issues from tray"
```

### Task 7: Full regression and macOS visual verification

**Files:**
- Modify only files required by failures directly caused by Tasks 1–6.

- [ ] **Step 1: Run the complete desktop test suite**

```bash
pnpm --filter @oh-my-bug/desktop test
```

Expected: all desktop unit and jsdom tests PASS with no warnings or unhandled rejections.

- [ ] **Step 2: Run repository type checking and lint**

```bash
pnpm typecheck
pnpm lint
```

Expected: both commands exit 0.

- [ ] **Step 3: Rebuild packaged inputs and verify runtime layout**

```bash
pnpm build:desktop
pnpm doctor:package
```

Expected: both commands exit 0 and both template icon assets are present under `.vite/build/apps/desktop/assets/icons`.

- [ ] **Step 4: Perform macOS interaction verification**

Run `pnpm dev` and verify all of the following in both light and dark appearance:

- the menu bar shows the recognizable Oh My Bug ?! mascot rather than the system availability glyph;
- primary click and context click each open exactly one native menu;
- the two groups show at most four rows each and correct total/overflow counts;
- a task row opens and focuses the matching Issue detail with project filtering cleared;
- overflow and “打开全部 Issues” open the unfiltered list;
- empty and Runtime-unavailable states retain open and quit actions;
- closing the main window hides it while background work and tray access continue.

Capture one light and one dark screenshot as verification evidence. Stop the dev process after inspection.

- [ ] **Step 5: Inspect the final diff and commit verification-only fixes if any**

```bash
git status --short
git diff --check
git log -6 --oneline
```

Expected: no uncommitted files except intentional screenshot evidence kept outside Git. If verification required an in-scope correction, rerun the affected RED/GREEN test and commit it with a focused `fix(desktop): ...` message.
