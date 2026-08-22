// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useTheme } from "../../src/web/theme/theme-context.js";
import { ThemeProvider } from "../../src/web/theme/theme-provider.js";

interface ControllableMediaQueryList extends MediaQueryList {
  setMatches(matches: boolean): void;
}

function ThemeProbe() {
  const { preference, resolvedTheme, setPreference } = useTheme();
  return <button onClick={() => setPreference("system")}>{preference}:{resolvedTheme}</button>;
}

function installMatchMedia(initial: boolean): ControllableMediaQueryList {
  let matches = initial;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const media = {
    get matches() { return matches; },
    media: "(prefers-color-scheme: light)",
    onchange: null,
    addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
      if (typeof listener === "function") listeners.add(listener as (event: MediaQueryListEvent) => void);
    },
    removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
      if (typeof listener === "function") listeners.delete(listener as (event: MediaQueryListEvent) => void);
    },
    addListener: (listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeListener: (listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
    dispatchEvent: () => true,
    setMatches(next: boolean) {
      matches = next;
      for (const listener of listeners) listener({ matches: next } as MediaQueryListEvent);
    },
  } as ControllableMediaQueryList;
  vi.stubGlobal("matchMedia", vi.fn(() => media));
  return media;
}

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.removeProperty("color-scheme");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("theme provider", () => {
  it("reacts to OS changes only in system mode", () => {
    const media = installMatchMedia(false);
    localStorage.setItem("oh-my-bug-theme", "system");
    render(<ThemeProvider><ThemeProbe /></ThemeProvider>);
    expect(screen.getByRole("button")).toHaveTextContent("system:dark");

    act(() => media.setMatches(true));

    expect(screen.getByRole("button")).toHaveTextContent("system:light");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it("ignores OS changes while explicit and resolves the latest OS value when returning to system", () => {
    const media = installMatchMedia(false);
    localStorage.setItem("oh-my-bug-theme", "dark");
    render(<ThemeProvider><ThemeProbe /></ThemeProvider>);

    act(() => media.setMatches(true));
    expect(screen.getByRole("button")).toHaveTextContent("dark:dark");

    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button")).toHaveTextContent("system:light");
    expect(localStorage.getItem("oh-my-bug-theme")).toBe("system");
  });

  it("keeps rendering when local storage is unavailable", () => {
    installMatchMedia(false);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    render(<ThemeProvider><ThemeProbe /></ThemeProvider>);

    expect(screen.getByRole("button")).toHaveTextContent("system:dark");
    expect(() => fireEvent.click(screen.getByRole("button"))).not.toThrow();
  });

  it("rejects use outside its provider boundary", () => {
    expect(() => render(<ThemeProbe />)).toThrow("useTheme must be used within ThemeProvider");
  });
});
