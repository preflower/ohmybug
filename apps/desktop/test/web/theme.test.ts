// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";

import {
  applyTheme,
  parseThemePreference,
  resolveTheme,
} from "../../src/web/theme/theme.js";

describe("theme domain", () => {
  it.each([
    ["system", "system"],
    ["light", "light"],
    ["dark", "dark"],
    [null, "system"],
    ["sepia", "system"],
  ] as const)("parses %s as %s", (stored, expected) => {
    expect(parseThemePreference(stored)).toBe(expected);
  });

  it("resolves system from the operating-system preference", () => {
    expect(resolveTheme("system", true)).toBe("light");
    expect(resolveTheme("system", false)).toBe("dark");
    expect(resolveTheme("light", false)).toBe("light");
    expect(resolveTheme("dark", true)).toBe("dark");
  });

  it("applies both data-theme and color-scheme", () => {
    applyTheme(document.documentElement, "light");

    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });
});
