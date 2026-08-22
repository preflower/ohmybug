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
    expect(shortcutKeys(SHORTCUTS.toggleIssueDetails, "MacIntel")).toEqual(["⌘", "B"]);
    expect(shortcutKeys(SHORTCUTS.toggleIssueDetails, "Win32")).toEqual(["Ctrl", "B"]);
    expect(shortcutText(SHORTCUTS.openCommandMenu, "MacIntel")).toBe("⌘ + K");
    expect(shortcutText(SHORTCUTS.dismissTransient, "MacIntel")).toBe("Esc");
    expect(ariaKeyShortcuts(SHORTCUTS.toggleIssueDetails)).toBe("Control+B Meta+B");
  });

  it("matches exact modifiers", () => {
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
