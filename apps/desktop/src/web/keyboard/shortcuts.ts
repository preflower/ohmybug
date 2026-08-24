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
    || (target instanceof HTMLElement && Boolean(target.isContentEditable));
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
