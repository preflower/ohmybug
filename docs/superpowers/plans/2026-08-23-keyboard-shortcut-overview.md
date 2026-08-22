# Keyboard Shortcut Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Centralize Oh My Bug's implemented keyboard shortcuts, expose a platform-aware read-only overview in Settings, change the Issue details shortcut to `Cmd/Ctrl + B`, simplify its Tooltip, and standardize the shared Tooltip appearance.

**Architecture:** Add a typed shortcut registry that owns matching, accessible metadata, visual key sequences, labels, and Settings order. Keep action state in the existing React owners, but make every handler and presentation consume registry entries. Add one focused Settings component and reuse the existing `Kbd` and Tooltip primitives.

**Tech Stack:** React 19, TypeScript 6, Base UI Tooltip, Tailwind utility classes, Vitest, Testing Library, Playwright Electron E2E, pnpm.

**Design reference:** `docs/superpowers/specs/2026-08-23-keyboard-shortcut-overview-design.md`

---

## File structure

- Create `apps/desktop/src/web/keyboard/shortcuts.ts`: typed registry plus event matching, editable-target detection, visual formatting, and ARIA formatting.
- Create `apps/desktop/test/web/shortcuts.test.ts`: isolated registry and matching coverage.
- Create `apps/desktop/src/web/settings/keyboard-shortcuts.tsx`: read-only Settings shortcut list.
- Modify `apps/desktop/src/web/components/ui/kbd.tsx`: render any registered shortcut with visible `+` separators and an optional accessible label.
- Modify `apps/desktop/src/web/command/command-menu.tsx`: consume registry entries instead of raw key strings.
- Modify `apps/desktop/src/web/app.tsx`: consume registry matchers, remove the sidebar shortcut badge, mount the Settings overview, and update the details-rail toggle.
- Modify `apps/desktop/src/web/components/ui/tooltip.tsx`: apply the compact inverse Tooltip appearance.
- Modify `apps/desktop/src/web/styles/global.css`: add the aligned Settings shortcut list layout.
- Modify `apps/desktop/test/web/keyboard.test.tsx`: verify Settings, sidebar, command-menu, and global shortcut behavior.
- Modify `apps/desktop/test/web/app-workbench.test.tsx`: verify exact details-rail matching, focus protection, ARIA metadata, and Tooltip text.
- Modify `apps/desktop/test/web/ui-primitives.test.tsx`: lock the shared Tooltip visual contract.
- Modify `apps/desktop/test/electron/e2e/metadata-rail-shortcut.spec.ts`: update end-to-end acceptance to `Cmd/Ctrl + B` and label-only Tooltips.

---

### Task 1: Build the typed shortcut registry

**Files:**
- Create: `apps/desktop/src/web/keyboard/shortcuts.ts`
- Create: `apps/desktop/test/web/shortcuts.test.ts`

- [ ] **Step 1: Write the failing registry tests**

Create `apps/desktop/test/web/shortcuts.test.ts`:

```ts
// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import {
  SETTINGS_SHORTCUTS,
  SHORTCUTS,
  ariaKeyShortcuts,
  isEditableShortcutTarget,
  matchesShortcut,
  shortcutKeys,
  shortcutText,
} from "../../src/web/keyboard/shortcuts.js";

describe("keyboard shortcut registry", () => {
  it("formats the registered shortcuts for Apple and non-Apple platforms", () => {
    expect(shortcutKeys(SHORTCUTS.toggleIssueDetails, "MacIntel")).toEqual(["⌘", "Shift", "B"]);
    expect(shortcutKeys(SHORTCUTS.toggleIssueDetails, "Win32")).toEqual(["Ctrl", "Shift", "B"]);
    expect(shortcutText(SHORTCUTS.openCommandMenu, "MacIntel")).toBe("⌘ + K");
    expect(shortcutText(SHORTCUTS.dismissTransient, "MacIntel")).toBe("Esc");
    expect(ariaKeyShortcuts(SHORTCUTS.toggleIssueDetails)).toBe("Control+Shift+B Meta+Shift+B");
  });

  it("matches exact modifiers", () => {
    expect(matchesShortcut(
      new KeyboardEvent("keydown", { key: "b", metaKey: true, shiftKey: true }),
      SHORTCUTS.toggleIssueDetails,
    )).toBe(true);
    expect(matchesShortcut(
      new KeyboardEvent("keydown", { key: "B", ctrlKey: true, shiftKey: true }),
      SHORTCUTS.toggleIssueDetails,
    )).toBe(true);
    expect(matchesShortcut(
      new KeyboardEvent("keydown", { key: "b", ctrlKey: true }),
      SHORTCUTS.toggleIssueDetails,
    )).toBe(false);
    expect(matchesShortcut(
      new KeyboardEvent("keydown", { key: "b", ctrlKey: true, altKey: true }),
      SHORTCUTS.toggleIssueDetails,
    )).toBe(false);
  });

  it("recognizes editable shortcut targets", () => {
    expect(isEditableShortcutTarget(document.createElement("input"))).toBe(true);
    expect(isEditableShortcutTarget(document.createElement("textarea"))).toBe(true);
    expect(isEditableShortcutTarget(document.createElement("select"))).toBe(true);
    const editable = document.createElement("div");
    Object.defineProperty(editable, "isContentEditable", { value: true });
    expect(isEditableShortcutTarget(editable)).toBe(true);
    expect(isEditableShortcutTarget(document.createElement("button"))).toBe(false);
  });

  it("keeps the Settings order explicit", () => {
    expect(SETTINGS_SHORTCUTS.map((shortcut) => shortcut.id)).toEqual([
      "open-command-menu",
      "create-issue",
      "open-project",
      "toggle-issue-details",
      "dismiss-transient",
    ]);
  });
});
```

- [ ] **Step 2: Run the registry test and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/web/shortcuts.test.ts
```

Expected: FAIL because `../../src/web/keyboard/shortcuts.js` does not exist.

- [ ] **Step 3: Implement the minimal registry**

Create `apps/desktop/src/web/keyboard/shortcuts.ts`:

```ts
export interface KeyboardShortcut {
  readonly id: string;
  readonly label: string;
  readonly key: string;
  readonly displayKey?: string;
  readonly primary?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
  readonly scope?: string;
}

export const SHORTCUTS = {
  openCommandMenu: {
    id: "open-command-menu",
    label: "打开命令菜单",
    key: "K",
    primary: true,
  },
  createIssue: {
    id: "create-issue",
    label: "新建 Issue",
    key: "N",
    primary: true,
    scope: "存在项目时",
  },
  openProject: {
    id: "open-project",
    label: "打开项目",
    key: "O",
    primary: true,
  },
  toggleIssueDetails: {
    id: "toggle-issue-details",
    label: "展开或收起详情栏",
    key: "B",
    primary: true,
    shift: true,
    scope: "选中 Issue 时",
  },
  dismissTransient: {
    id: "dismiss-transient",
    label: "关闭当前弹层",
    key: "Escape",
    displayKey: "Esc",
    scope: "弹层打开时",
  },
} as const satisfies Record<string, KeyboardShortcut>;

export const SETTINGS_SHORTCUTS: readonly KeyboardShortcut[] = [
  SHORTCUTS.openCommandMenu,
  SHORTCUTS.createIssue,
  SHORTCUTS.openProject,
  SHORTCUTS.toggleIssueDetails,
  SHORTCUTS.dismissTransient,
];

export function matchesShortcut(event: KeyboardEvent, shortcut: KeyboardShortcut): boolean {
  const primaryPressed = event.metaKey || event.ctrlKey;
  return event.key.toLowerCase() === shortcut.key.toLowerCase()
    && primaryPressed === Boolean(shortcut.primary)
    && event.shiftKey === Boolean(shortcut.shift)
    && event.altKey === Boolean(shortcut.alt);
}

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && target.isContentEditable);
}

export function shortcutKeys(shortcut: KeyboardShortcut, platform = currentPlatform()): string[] {
  const keys: string[] = [];
  if (shortcut.primary) keys.push(isApplePlatform(platform) ? "⌘" : "Ctrl");
  if (shortcut.shift) keys.push("Shift");
  if (shortcut.alt) keys.push(isApplePlatform(platform) ? "⌥" : "Alt");
  keys.push(shortcut.displayKey ?? shortcut.key.toUpperCase());
  return keys;
}

export function shortcutText(shortcut: KeyboardShortcut, platform = currentPlatform()): string {
  return shortcutKeys(shortcut, platform).join(" + ");
}

export function ariaKeyShortcuts(shortcut: KeyboardShortcut): string {
  const suffix = [
    shortcut.shift ? "Shift" : undefined,
    shortcut.alt ? "Alt" : undefined,
    shortcut.key,
  ].filter(Boolean).join("+");
  return shortcut.primary ? `Control+${suffix} Meta+${suffix}` : suffix;
}

function currentPlatform(): string {
  return typeof navigator === "undefined" ? "" : navigator.platform;
}

function isApplePlatform(platform: string): boolean {
  return /Mac|iPhone|iPad|iPod/.test(platform);
}
```

- [ ] **Step 4: Run the registry test and verify GREEN**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/web/shortcuts.test.ts
```

Expected: 1 test file and 4 tests pass.

- [ ] **Step 5: Commit the registry**

```bash
git add apps/desktop/src/web/keyboard/shortcuts.ts apps/desktop/test/web/shortcuts.test.ts
git commit -m "feat(desktop): centralize keyboard shortcuts"
```

---

### Task 2: Render the Settings overview and reuse registered global shortcuts

**Files:**
- Create: `apps/desktop/src/web/settings/keyboard-shortcuts.tsx`
- Modify: `apps/desktop/src/web/components/ui/kbd.tsx`
- Modify: `apps/desktop/src/web/command/command-menu.tsx`
- Modify: `apps/desktop/src/web/app.tsx`
- Modify: `apps/desktop/src/web/styles/global.css`
- Modify: `apps/desktop/test/web/keyboard.test.tsx`

- [ ] **Step 1: Add failing Settings and presentation tests**

In `apps/desktop/test/web/keyboard.test.tsx`, add this test inside `describe("keyboard and theme interactions", ...)`:

```tsx
  it("shows the current platform shortcut catalog only in discovery surfaces", async () => {
    stubProductApi();
    installLightSystemTheme();
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    render(<App />);
    await act(async () => Promise.resolve());

    const createTrigger = screen.getByRole("button", { name: "新建 Issue" });
    expect(createTrigger.querySelector('[data-slot="kbd-group"]')).toBeNull();

    fireEvent.click(screen.getByRole("link", { name: "Settings" }));
    const overview = screen.getByRole("region", { name: "键盘快捷键" });
    const items = within(overview).getAllByRole("listitem");
    expect(items).toHaveLength(5);
    expect(within(items[0]!).getByText("打开命令菜单")).toBeVisible();
    expect(within(items[0]!).getByLabelText("⌘ + K")).toBeVisible();
    expect(within(items[3]!).getByText("选中 Issue 时")).toBeVisible();
    expect(within(items[3]!).getByLabelText("⌘ + Shift + B")).toBeVisible();
    expect(within(items[4]!).getByLabelText("Esc")).toBeVisible();
    expect(within(overview).getAllByText("+", {
      selector: '[data-slot="kbd-separator"]',
    })).toHaveLength(5);

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    const commandMenu = screen.getByRole("dialog", { name: "命令菜单" });
    expect(within(commandMenu).getByRole("button", { name: "新建 Issue" }))
      .toHaveTextContent("⌘+N");
    expect(within(commandMenu).getByRole("button", { name: "打开项目" }))
      .toHaveTextContent("⌘+O");
  });
```

- [ ] **Step 2: Run the Settings test and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/web/keyboard.test.tsx -t "shows the current platform shortcut catalog"
```

Expected: FAIL because the sidebar button still contains a shortcut and Settings has no “键盘快捷键” region.

- [ ] **Step 3: Update `KbdShortcut` to consume registry entries**

In `apps/desktop/src/web/components/ui/kbd.tsx`, add the import:

```ts
import type { KeyboardShortcut } from "../../keyboard/shortcuts.js";
import { shortcutKeys, shortcutText } from "../../keyboard/shortcuts.js";
```

Replace the existing `KbdShortcut` function with:

```tsx
function KbdShortcut({
  accessible = false,
  className,
  platform,
  shortcut,
  ...props
}: Omit<React.ComponentProps<"kbd">, "children"> & {
  accessible?: boolean;
  platform?: string;
  shortcut: KeyboardShortcut;
}) {
  const keys = shortcutKeys(shortcut, platform);
  return (
    <KbdGroup
      aria-hidden={accessible ? undefined : "true"}
      aria-label={accessible ? shortcutText(shortcut, platform) : undefined}
      className={className}
      {...props}
    >
      {keys.map((key, index) => (
        <React.Fragment key={`${shortcut.id}-${key}-${index}`}>
          {index > 0 ? <span data-slot="kbd-separator">+</span> : null}
          <Kbd>{key}</Kbd>
        </React.Fragment>
      ))}
    </KbdGroup>
  );
}
```

- [ ] **Step 4: Create the Settings overview component**

Create `apps/desktop/src/web/settings/keyboard-shortcuts.tsx`:

```tsx
import { KbdShortcut } from "../components/ui/kbd.js";
import { SETTINGS_SHORTCUTS } from "../keyboard/shortcuts.js";

export function KeyboardShortcutOverview() {
  return (
    <section
      aria-labelledby="keyboard-shortcuts-heading"
      className="settings-option shortcut-settings"
    >
      <div>
        <h3 id="keyboard-shortcuts-heading">键盘快捷键</h3>
        <p>快捷键会根据当前操作系统显示，并在输入控件中暂停响应。</p>
      </div>
      <ul className="shortcut-list">
        {SETTINGS_SHORTCUTS.map((shortcut) => (
          <li key={shortcut.id}>
            <div className="shortcut-copy">
              <strong>{shortcut.label}</strong>
              {shortcut.scope ? <span>{shortcut.scope}</span> : null}
            </div>
            <KbdShortcut accessible shortcut={shortcut} />
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 5: Wire Settings, the sidebar, command menu, and global handlers to the registry**

In `apps/desktop/src/web/app.tsx`, import:

```ts
import {
  SHORTCUTS,
  isEditableShortcutTarget,
  matchesShortcut,
} from "./keyboard/shortcuts.js";
import { KeyboardShortcutOverview } from "./settings/keyboard-shortcuts.js";
```

Replace the global `onKeyDown` body with:

```ts
    const onKeyDown = (event: KeyboardEvent) => {
      if (matchesShortcut(event, SHORTCUTS.dismissTransient)) {
        setNewIssueOpen(false);
        setCommandOpen(false);
        return;
      }
      if (isEditableShortcutTarget(event.target)) return;
      if (matchesShortcut(event, SHORTCUTS.openCommandMenu)) {
        event.preventDefault();
        setCommandOpen(true);
      } else if (canCreateIssue && matchesShortcut(event, SHORTCUTS.createIssue)) {
        event.preventDefault();
        setNewIssueOpen(true);
      } else if (matchesShortcut(event, SHORTCUTS.openProject)) {
        event.preventDefault();
        setCommandOpen(false);
        void openProjectDirectory();
      }
    };
```

Replace the sidebar trigger with a shortcut-free button:

```tsx
trigger={
  <Button aria-label="新建 Issue" className="new-issue" type="button">
    <span>新建 Issue</span>
    <Plus aria-hidden="true" size={14} />
  </Button>
}
```

Until Task 3 changes the binding, replace the details-rail Tooltip shortcut call with the registered current shortcut so the intermediate commit remains behaviorally consistent and type-safe:

```tsx
<TooltipContent className="flex items-center gap-2" side="bottom">
  <span>{label}</span>
  <KbdShortcut shortcut={SHORTCUTS.toggleIssueDetails} />
</TooltipContent>
```

Replace the Settings preferences content with:

```tsx
function SettingsWorkspace({ health }: { health: Record<string, { state: string; lastError?: string; nextRetryAt?: string }> }) {
  const entries = Object.entries(health);
  return (
    <section className="settings-page">
      <div className="settings-card">
        <h2>集成运行状态</h2>
        {entries.length ? (
          <ul className="health-list">
            {entries.map(([id, value]) => (
              <li key={id}>
                <span className={`state-dot ${value.state === "backoff" || value.state === "disconnected" ? "state-dot-error" : ""}`} />
                <code>{id}</code>
                <strong>{value.state}</strong>
                {value.lastError ? <span>{value.lastError}</span> : null}
              </li>
            ))}
          </ul>
        ) : <p>尚未启用集成插件。</p>}
      </div>
      <section aria-labelledby="preferences-heading" className="settings-card preferences-card">
        <h2 id="preferences-heading">偏好设置</h2>
        <div className="settings-list">
          <div className="settings-option">
            <div>
              <h3>外观</h3>
              <p>显式主题会覆盖系统外观设置，并保存在当前浏览器中。</p>
            </div>
            <ThemeSelector />
          </div>
          <KeyboardShortcutOverview />
        </div>
      </section>
    </section>
  );
}
```

In `apps/desktop/src/web/command/command-menu.tsx`, import the registry:

```ts
import type { KeyboardShortcut } from "../keyboard/shortcuts.js";
import { SHORTCUTS } from "../keyboard/shortcuts.js";
```

Use registered shortcuts in both actions:

```tsx
<KbdShortcut shortcut={SHORTCUTS.createIssue} />
```

```tsx
<CommandAction
  icon={<FolderOpen aria-hidden="true" size={14} />}
  shortcut={SHORTCUTS.openProject}
  label="打开项目"
  onClick={() => closeAfter(onOpenProject)}
/>
```

Replace the `CommandAction` signature and shortcut rendering with:

```tsx
function CommandAction({
  icon,
  label,
  onClick,
  shortcut,
}: {
  icon: ReactNode;
  label: string;
  onClick(): void;
  shortcut: KeyboardShortcut;
}) {
  return (
    <Button className="w-full justify-start" type="button" variant="ghost" onClick={onClick}>
      {icon}
      <span>{label}</span>
      <KbdShortcut shortcut={shortcut} />
    </Button>
  );
}
```

- [ ] **Step 6: Add the compact Settings list styles**

In `apps/desktop/src/web/styles/global.css`, insert after `.settings-option p`:

```css
.shortcut-settings {
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
  border-top: 1px solid var(--border);
}

.shortcut-list {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
}

.shortcut-list li {
  display: flex;
  min-height: 38px;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  border-top: 1px solid var(--border);
  padding: 8px 0;
}

.shortcut-list li:first-child {
  border-top: 0;
}

.shortcut-copy {
  display: grid;
  gap: 2px;
}

.shortcut-copy strong {
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 500;
}

.shortcut-copy span {
  color: var(--text-muted);
  font-size: 10px;
}

.shortcut-list [data-slot="kbd-group"] {
  flex: none;
}
```

- [ ] **Step 7: Run the focused Settings and command-menu tests and verify GREEN**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/web/keyboard.test.tsx
```

Expected: all tests in `keyboard.test.tsx` pass. If an existing assertion expects `Ctrl+N` text content, keep that assertion because the visible `+` separator remains part of `textContent`.

- [ ] **Step 8: Run type checking for the component API migration**

Run:

```bash
pnpm --filter @oh-my-bug/desktop typecheck
```

Expected: PASS with no remaining raw `keyName` or `shift` calls to `KbdShortcut`; the details rail still uses the registered Shift binding until Task 3 changes it.

- [ ] **Step 9: Commit the Settings overview and registry consumers**

```bash
git add apps/desktop/src/web/settings/keyboard-shortcuts.tsx apps/desktop/src/web/components/ui/kbd.tsx apps/desktop/src/web/command/command-menu.tsx apps/desktop/src/web/app.tsx apps/desktop/src/web/styles/global.css apps/desktop/test/web/keyboard.test.tsx
git commit -m "feat(desktop): show keyboard shortcuts in settings"
```

---

### Task 3: Change the details-rail shortcut and simplify its Tooltip

**Files:**
- Modify: `apps/desktop/src/web/keyboard/shortcuts.ts`
- Modify: `apps/desktop/src/web/app.tsx`
- Modify: `apps/desktop/test/web/shortcuts.test.ts`
- Modify: `apps/desktop/test/web/keyboard.test.tsx`
- Modify: `apps/desktop/test/web/app-workbench.test.tsx`
- Modify: `apps/desktop/test/electron/e2e/metadata-rail-shortcut.spec.ts`

- [ ] **Step 1: Change the registry and Settings expectations to the new binding**

In `apps/desktop/test/web/shortcuts.test.ts`, change the Apple and non-Apple expectations to:

```ts
expect(shortcutKeys(SHORTCUTS.toggleIssueDetails, "MacIntel")).toEqual(["⌘", "B"]);
expect(shortcutKeys(SHORTCUTS.toggleIssueDetails, "Win32")).toEqual(["Ctrl", "B"]);
expect(ariaKeyShortcuts(SHORTCUTS.toggleIssueDetails)).toBe("Control+B Meta+B");
```

Change the exact matching assertions to:

```ts
expect(matchesShortcut(
  new KeyboardEvent("keydown", { key: "b", metaKey: true }),
  SHORTCUTS.toggleIssueDetails,
)).toBe(true);
expect(matchesShortcut(
  new KeyboardEvent("keydown", { key: "B", ctrlKey: true }),
  SHORTCUTS.toggleIssueDetails,
)).toBe(true);
expect(matchesShortcut(
  new KeyboardEvent("keydown", { key: "b", ctrlKey: true, shiftKey: true }),
  SHORTCUTS.toggleIssueDetails,
)).toBe(false);
```

In the Settings overview test in `apps/desktop/test/web/keyboard.test.tsx`, change the details shortcut and separator assertions to:

```tsx
expect(within(items[3]!).getByLabelText("⌘ + B")).toBeVisible();
expect(within(overview).getAllByText("+", {
  selector: '[data-slot="kbd-separator"]',
})).toHaveLength(4);
```

- [ ] **Step 2: Rewrite the details-rail web test for the new exact binding**

Replace the existing `toggles the Issue details rail with Ctrl/Cmd+Shift+B outside editable controls` test in `apps/desktop/test/web/app-workbench.test.tsx` with these two tests:

```tsx
  it("toggles the Issue details rail with Ctrl/Cmd+B and exposes a label-only Tooltip", async () => {
    vi.spyOn(api, "integrationPlugins").mockResolvedValue([]);
    vi.spyOn(api, "projects").mockResolvedValue([project]);
    vi.spyOn(api, "issues").mockResolvedValue([issue]);
    vi.spyOn(api, "issue").mockResolvedValue(issue);
    vi.spyOn(api, "integrationHealth").mockResolvedValue({});
    vi.spyOn(api, "subscribeIssueEvents").mockReturnValue(() => undefined);

    render(<App />);

    expect(await screen.findByTestId("issue-metadata-rail")).toBeVisible();
    const hideAction = screen.getByRole("button", { name: "隐藏详情栏" });
    expect(hideAction).toHaveAttribute("aria-keyshortcuts", "Control+B Meta+B");
    fireEvent.focus(hideAction);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("隐藏详情栏");
    expect(screen.getByRole("tooltip").querySelector('[data-slot="kbd-group"]')).toBeNull();

    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(screen.queryByTestId("issue-metadata-rail")).not.toBeInTheDocument();

    const showAction = screen.getByRole("button", { name: "显示详情栏" });
    expect(showAction).toHaveAttribute("aria-keyshortcuts", "Control+B Meta+B");
    fireEvent.keyDown(window, { key: "B", metaKey: true });
    expect(screen.getByTestId("issue-metadata-rail")).toBeVisible();
  });

  it("does not toggle the details rail for old, repeated, Alt-modified, or editable shortcuts", async () => {
    vi.spyOn(api, "integrationPlugins").mockResolvedValue([]);
    vi.spyOn(api, "projects").mockResolvedValue([project]);
    vi.spyOn(api, "issues").mockResolvedValue([issue]);
    vi.spyOn(api, "issue").mockResolvedValue(issue);
    vi.spyOn(api, "integrationHealth").mockResolvedValue({});
    vi.spyOn(api, "subscribeIssueEvents").mockReturnValue(() => undefined);

    render(<App />);
    expect(await screen.findByTestId("issue-metadata-rail")).toBeVisible();

    fireEvent.keyDown(window, { key: "b", ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(window, { key: "b", ctrlKey: true, altKey: true });
    fireEvent.keyDown(window, { key: "b", ctrlKey: true, repeat: true });
    expect(screen.getByTestId("issue-metadata-rail")).toBeVisible();

    const input = document.createElement("input");
    document.body.append(input);
    fireEvent.keyDown(input, { key: "b", ctrlKey: true });
    input.remove();

    const editable = document.createElement("div");
    Object.defineProperty(editable, "isContentEditable", { value: true });
    document.body.append(editable);
    fireEvent.keyDown(editable, { key: "b", metaKey: true });
    editable.remove();

    expect(screen.getByTestId("issue-metadata-rail")).toBeVisible();
  });
```

- [ ] **Step 3: Run the shortcut and details tests and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/web/shortcuts.test.ts test/web/keyboard.test.tsx test/web/app-workbench.test.tsx
```

Expected: FAIL because the registry still requires `Shift`, Settings still renders it, `Ctrl/Cmd + B` does not toggle, ARIA still includes `Shift`, and the Tooltip still renders a key sequence.

- [ ] **Step 4: Implement the exact registered details shortcut**

In `apps/desktop/src/web/keyboard/shortcuts.ts`, remove `shift: true` from `SHORTCUTS.toggleIssueDetails`.

In the `IssueWorkspace` keydown effect in `apps/desktop/src/web/app.tsx`, replace the local editable calculation and modifier checks with:

```ts
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !selected
        || isEditableShortcutTarget(event.target)
        || event.repeat
        || !matchesShortcut(event, SHORTCUTS.toggleIssueDetails)
      ) return;
      event.preventDefault();
      setMetadataOpen((current) => !current);
    };
```

Replace `MetadataRailToggle` with:

```tsx
function MetadataRailToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const label = open ? "隐藏详情栏" : "显示详情栏";
  const Icon = open ? PanelRightClose : PanelRightOpen;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-keyshortcuts={ariaKeyShortcuts(SHORTCUTS.toggleIssueDetails)}
            aria-label={label}
            className={open ? "metadata-rail-toggle" : undefined}
            size="icon-sm"
            type="button"
            variant="ghost"
            onClick={onToggle}
          >
            <Icon aria-hidden="true" size={15} />
          </Button>
        }
      />
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
```

Add `ariaKeyShortcuts` to the existing shortcut imports and remove the now-unused `KbdShortcut` import from `app.tsx`.

- [ ] **Step 5: Run the shortcut and details tests and verify GREEN**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/web/shortcuts.test.ts test/web/keyboard.test.tsx test/web/app-workbench.test.tsx
```

Expected: all three focused files pass, including the two details-rail tests.

- [ ] **Step 6: Update the Electron acceptance test before running it**

In `apps/desktop/test/electron/e2e/metadata-rail-shortcut.spec.ts`:

```ts
await expect(hideAction).toHaveAttribute(
  "aria-keyshortcuts",
  "Control+B Meta+B",
);
await hideAction.hover();
await expect(desktop.page.getByRole("tooltip")).toHaveText("隐藏详情栏");

await desktop.page.keyboard.press(oldShortcut());
await expect(desktop.page.getByTestId("issue-metadata-rail")).toBeVisible();
```

Use exact label assertions for the collapsed and restored Tooltips:

```ts
await expect(desktop.page.getByRole("tooltip")).toHaveText("显示详情栏");
```

```ts
await expect(desktop.page.getByRole("tooltip")).toHaveText("隐藏详情栏");
```

Replace the shortcut helpers with:

```ts
function shortcut(): string {
  return process.platform === "darwin" ? "Meta+B" : "Control+B";
}

function oldShortcut(): string {
  return process.platform === "darwin" ? "Meta+Shift+B" : "Control+Shift+B";
}
```

- [ ] **Step 7: Run Electron acceptance coverage**

Run:

```bash
pnpm test:e2e:electron -- metadata-rail-shortcut.spec.ts
```

Expected: the single metadata-rail shortcut scenario passes, including input focus protection, rejection of the old Shift binding, exact Tooltips, ARIA metadata, and both toggle directions.

- [ ] **Step 8: Commit the details-rail behavior**

```bash
git add apps/desktop/src/web/keyboard/shortcuts.ts apps/desktop/src/web/app.tsx apps/desktop/test/web/shortcuts.test.ts apps/desktop/test/web/keyboard.test.tsx apps/desktop/test/web/app-workbench.test.tsx apps/desktop/test/electron/e2e/metadata-rail-shortcut.spec.ts
git commit -m "feat(desktop): simplify details rail shortcut"
```

---

### Task 4: Standardize the shared Tooltip appearance

**Files:**
- Modify: `apps/desktop/src/web/components/ui/tooltip.tsx`
- Modify: `apps/desktop/test/web/ui-primitives.test.tsx`

- [ ] **Step 1: Add a failing Tooltip visual-contract assertion**

In `apps/desktop/test/web/ui-primitives.test.tsx`, extend `shows accessible help for an icon-only action` after finding the Tooltip:

```tsx
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("关闭");
    expect(tooltip).toHaveClass(
      "bg-foreground",
      "text-background",
      "rounded-sm",
      "px-2",
      "py-1.5",
    );
    expect(tooltip).not.toHaveClass("border", "border-border");
```

Remove the older one-line `findByRole("tooltip")` assertion so the test has one authoritative Tooltip reference.

- [ ] **Step 2: Run the primitive test and verify RED**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/web/ui-primitives.test.tsx -t "shows accessible help"
```

Expected: FAIL because the Tooltip still uses `border`, `bg-[var(--surface-raised)]`, and the old vertical padding.

- [ ] **Step 3: Implement the compact inverse Tooltip classes**

In `apps/desktop/src/web/components/ui/tooltip.tsx`, replace the `TooltipPrimitive.Popup` base class string with:

```tsx
"z-[70] max-w-64 origin-[var(--transform-origin)] rounded-sm bg-foreground px-2 py-1.5 text-xs text-background shadow-[0_4px_12px_rgb(0_0_0/16%)] duration-120 data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0 motion-reduce:animate-none"
```

Keep the portal, positioner, `role="tooltip"`, `data-slot`, side/alignment props, and animation-state attributes unchanged.

- [ ] **Step 4: Run the primitive test and verify GREEN**

Run:

```bash
pnpm --filter @oh-my-bug/desktop exec vitest run --config vitest.config.ts test/web/ui-primitives.test.tsx -t "shows accessible help"
```

Expected: the focused Tooltip test passes.

- [ ] **Step 5: Run all desktop web tests**

Run:

```bash
pnpm --filter @oh-my-bug/desktop test
```

Expected: all desktop Vitest files pass with no warnings or unhandled errors.

- [ ] **Step 6: Commit the Tooltip styling**

```bash
git add apps/desktop/src/web/components/ui/tooltip.tsx apps/desktop/test/web/ui-primitives.test.tsx
git commit -m "style(desktop): refine keyboard tooltips"
```

---

### Task 5: Complete repository verification and visual QA

**Files:**
- Verify only; no planned source changes.

- [ ] **Step 1: Run the complete test suite**

```bash
pnpm test
```

Expected: every workspace and repository Vitest suite passes with zero failures and zero unhandled errors.

- [ ] **Step 2: Run repository type checking**

```bash
pnpm typecheck
```

Expected: all workspace and repository TypeScript checks pass.

- [ ] **Step 3: Run linting**

```bash
pnpm lint
```

Expected: oxlint exits with zero errors.

- [ ] **Step 4: Run the production build**

```bash
pnpm build
```

Expected: Electron, preload, runtime assets, and web production builds complete successfully.

- [ ] **Step 5: Verify the rendered Settings and Tooltip states in the local app**

Run the existing development server if it is not already active:

```bash
pnpm dev:web
```

Inspect `/settings` at desktop width in both light and dark themes and confirm:

- the shortcut rows align action text left and key groups right;
- macOS or Windows/Linux modifiers match the running platform;
- every modifier sequence contains a visible `+` separator;
- the list remains readable below 760px;
- the sidebar “新建 Issue” button has no shortcut badge;
- the command menu retains `新建 Issue` and `打开项目` shortcut hints;
- the details-rail Tooltip contains only the action label;
- the Tooltip has an inverse high-contrast surface, no border, compact padding, and a restrained shadow.

Stop only the development process started by this step; leave a pre-existing server running.

- [ ] **Step 6: Inspect the final Git state**

```bash
git diff --check
git status --short --branch
git log --oneline -5
```

Expected: no whitespace errors, no uncommitted implementation files, and three focused implementation commits following the design and plan commits.
