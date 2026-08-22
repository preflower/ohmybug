# Three-State Theme System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the renderer's two-state toggle with a persistent `system | light | dark` theme that resolves before React renders and stays synchronized across Settings and the command menu.

**Architecture:** A pure theme-domain module parses and resolves preferences, while a React provider owns persistence, DOM application, and media-query subscriptions. A small inline bootstrap in `index.html` applies the same storage contract before the renderer module starts, preventing a startup flash.

**Tech Stack:** Electron 43, React 19, TypeScript 6, Vite 8, Vitest 4, Testing Library, Playwright.

**Spec:** [`docs/superpowers/specs/2026-08-21-shadcn-theme-system-design.md`](../specs/2026-08-21-shadcn-theme-system-design.md)

## Global Constraints

- `DESIGN.md` remains the visual source of truth.
- Supported preferences are exactly `system`, `light`, and `dark`; resolved themes are exactly `light` and `dark`.
- No stored preference means `system`; existing stored `light` and `dark` values remain compatible.
- A missing media-query API or any bootstrap failure resolves to dark without blocking startup.
- System changes affect the UI only while the stored preference is `system`.
- Keep the storage key `oh-my-bug-theme`.
- Settings and the command menu must update the same provider state.
- Do not change Runtime, Agent, integration, persistence, or Electron IPC contracts.
- Every production behavior is introduced by a test that was observed failing first.

---

### Task 1: Define and test the theme domain

**Files:**
- Create: `apps/desktop/src/web/theme/theme.ts`
- Create: `apps/desktop/test/web/theme.test.ts`

**Interfaces:**
- Consumes: stored string values and a boolean operating-system light preference.
- Produces: `THEME_STORAGE_KEY`, `ThemePreference`, `ResolvedTheme`, `parseThemePreference(value)`, `resolveTheme(preference, prefersLight)`, and `applyTheme(root, resolvedTheme)`.

- [ ] **Step 1: Write failing parsing and resolution tests**

```ts
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
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter @oh-my-bug/desktop exec vitest run test/web/theme.test.ts`

Expected: FAIL because `src/web/theme/theme.ts` does not exist.

- [ ] **Step 3: Implement the minimal pure domain**

```ts
export const THEME_STORAGE_KEY = "oh-my-bug-theme";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export function parseThemePreference(value: string | null): ThemePreference {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function resolveTheme(preference: ThemePreference, prefersLight: boolean): ResolvedTheme {
  return preference === "system" ? (prefersLight ? "light" : "dark") : preference;
}

export function applyTheme(root: HTMLElement, theme: ResolvedTheme): void {
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm --filter @oh-my-bug/desktop exec vitest run test/web/theme.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the theme domain**

```bash
git add apps/desktop/src/web/theme/theme.ts apps/desktop/test/web/theme.test.ts
git commit -m "feat(desktop): define theme preference domain"
```

### Task 2: Apply the theme before React and own it through a provider

**Files:**
- Create: `apps/desktop/src/web/theme/theme-provider.tsx`
- Create: `apps/desktop/test/web/theme-provider.test.tsx`
- Modify: `apps/desktop/index.html`
- Modify: `apps/desktop/test/web/app-icon.test.ts`
- Modify: `apps/desktop/src/web/app.tsx`

**Interfaces:**
- Consumes: Task 1's `ThemePreference`, `ResolvedTheme`, `parseThemePreference`, `resolveTheme`, `applyTheme`, and `THEME_STORAGE_KEY`.
- Produces: `ThemeProvider`, `useTheme(): { preference; resolvedTheme; setPreference }`; preserves the public `<App />` test/render interface.

- [ ] **Step 1: Write failing provider lifecycle tests**

Create a controllable media-query stub and test the real provider instead of mocking its behavior:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ThemeProvider, useTheme } from "../../src/web/theme/theme-provider.js";

function ThemeProbe() {
  const { preference, resolvedTheme, setPreference } = useTheme();
  return <button onClick={() => setPreference("system")}>{preference}:{resolvedTheme}</button>;
}

function installMatchMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const media = {
    get matches() { return matches; },
    media: "(prefers-color-scheme: light)",
    onchange: null,
    addEventListener: (_type: "change", listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeEventListener: (_type: "change", listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => true,
    setMatches(next: boolean) {
      matches = next;
      for (const listener of listeners) listener({ matches: next } as MediaQueryListEvent);
    },
  } satisfies MediaQueryList & { setMatches(next: boolean): void };
  vi.stubGlobal("matchMedia", () => media);
  return media;
}

it("reacts to OS changes only in system mode", async () => {
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
});

it("keeps rendering when local storage is unavailable", () => {
  installMatchMedia(false);
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  render(<ThemeProvider><ThemeProbe /></ThemeProvider>);
  expect(screen.getByRole("button")).toHaveTextContent("system:dark");
  expect(() => fireEvent.click(screen.getByRole("button"))).not.toThrow();
});
```

The test helper must implement `matches`, `addEventListener("change", listener)`, `removeEventListener`, and `setMatches(next)` by dispatching `{ matches: next }` to registered listeners. Clear storage, DOM theme attributes, and stubs in `afterEach`.

- [ ] **Step 2: Extend the HTML contract test and verify RED**

In `app-icon.test.ts`, assert that an inline script containing `oh-my-bug-theme` appears before `/src/web/main.tsx`:

```ts
const html = readFileSync(resolve(desktopRoot, "index.html"), "utf8");
expect(html.indexOf("oh-my-bug-theme")).toBeGreaterThan(-1);
expect(html.indexOf("oh-my-bug-theme")).toBeLessThan(html.indexOf("/src/web/main.tsx"));
```

Run: `pnpm --filter @oh-my-bug/desktop exec vitest run test/web/theme-provider.test.tsx test/web/app-icon.test.ts`

Expected: FAIL because the provider and pre-React bootstrap do not exist.

- [ ] **Step 3: Implement the provider**

Implement one context with guarded browser APIs:

```tsx
interface ThemeContextValue {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference(preference: ThemePreference): void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const query = useMemo(() => {
    try { return window.matchMedia?.("(prefers-color-scheme: light)"); }
    catch { return undefined; }
  }, []);
  const [preference, setPreferenceState] = useState<ThemePreference>(() => {
    try { return parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY)); }
    catch { return "system"; }
  });
  const [prefersLight, setPrefersLight] = useState(query?.matches ?? false);
  const resolvedTheme = resolveTheme(preference, prefersLight);

  useEffect(() => {
    applyTheme(document.documentElement, resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    if (preference !== "system" || !query) return;
    const change = (event: MediaQueryListEvent) => setPrefersLight(event.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, [preference, query]);

  const setPreference = (next: ThemePreference) => {
    if (next === "system") {
      try { setPrefersLight(query?.matches ?? false); }
      catch { setPrefersLight(false); }
    }
    setPreferenceState(next);
    try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch { /* keep in memory */ }
  };

  return <ThemeContext.Provider value={{ preference, resolvedTheme, setPreference }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used within ThemeProvider");
  return value;
}
```

`useTheme` must throw `useTheme must be used within ThemeProvider` outside the provider.

- [ ] **Step 4: Add the pre-React bootstrap and wrap App internals**

Insert this non-module script before the renderer script in `index.html`; keep it deliberately self-contained so it runs before module loading:

```html
<script>
  (() => {
    let preference = "system";
    let prefersLight = false;
    try {
      const stored = localStorage.getItem("oh-my-bug-theme");
      if (stored === "system" || stored === "light" || stored === "dark") preference = stored;
      prefersLight = window.matchMedia?.("(prefers-color-scheme: light)").matches ?? false;
    } catch {
      preference = "system";
      prefersLight = false;
    }
    const resolved = preference === "system" ? (prefersLight ? "light" : "dark") : preference;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
  })();
</script>
```

Keep tests that render `<App />` working by making the exported component the provider boundary:

```tsx
export function App() {
  return <ThemeProvider><AppContent /></ThemeProvider>;
}

function AppContent() {
  // existing App body; remove the local Theme type, theme state, and theme effect
}
```

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `pnpm --filter @oh-my-bug/desktop exec vitest run test/web/theme.test.ts test/web/theme-provider.test.tsx test/web/app-icon.test.ts test/web/app-shell.test.tsx`

Expected: PASS with no React act warnings.

- [ ] **Step 6: Commit startup and provider behavior**

```bash
git add apps/desktop/index.html apps/desktop/src/web/app.tsx apps/desktop/src/web/theme/theme-provider.tsx apps/desktop/test/web/theme-provider.test.tsx apps/desktop/test/web/app-icon.test.ts
git commit -m "feat(desktop): add persistent system theme provider"
```

### Task 3: Expose synchronized theme controls

**Files:**
- Create: `apps/desktop/src/web/settings/theme-selector.tsx`
- Modify: `apps/desktop/src/web/app.tsx`
- Modify: `apps/desktop/test/web/keyboard.test.tsx`

**Interfaces:**
- Consumes: `useTheme()` from Task 2 and the existing checked-in `Button` primitive.
- Produces: `ThemeSelector`; Settings and command-menu controls with labels `跟随系统`, `浅色`, and `深色`.

- [ ] **Step 1: Replace the old toggle test with failing three-state behavior**

Update `keyboard.test.tsx` to install a controllable light media query before rendering and assert both surfaces share state:

```tsx
fireEvent.click(screen.getByRole("link", { name: "Settings" }));
const group = screen.getByRole("group", { name: "主题" });
expect(within(group).getByRole("button", { name: "跟随系统" })).toHaveAttribute("aria-pressed", "true");
expect(screen.getByText("当前显示：浅色")).toBeVisible();

fireEvent.click(within(group).getByRole("button", { name: "深色" }));
expect(document.documentElement).toHaveAttribute("data-theme", "dark");
expect(localStorage.getItem("oh-my-bug-theme")).toBe("dark");

fireEvent.keyDown(window, { key: "k", metaKey: true });
fireEvent.click(screen.getByRole("button", { name: "主题：跟随系统" }));
expect(localStorage.getItem("oh-my-bug-theme")).toBe("system");
expect(document.documentElement).toHaveAttribute("data-theme", "light");
```

- [ ] **Step 2: Run the keyboard test and verify RED**

Run: `pnpm --filter @oh-my-bug/desktop exec vitest run test/web/keyboard.test.tsx`

Expected: FAIL because Settings exposes only a two-state toggle and the command menu has no theme actions.

- [ ] **Step 3: Implement the accessible selector**

```tsx
const options: Array<{ value: ThemePreference; label: string }> = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
];

export function ThemeSelector() {
  const { preference, resolvedTheme, setPreference } = useTheme();
  return <div>
    <div aria-label="主题" className="theme-selector" role="group">
      {options.map((option) => <Button
        aria-pressed={preference === option.value}
        key={option.value}
        onClick={() => setPreference(option.value)}
        type="button"
        variant={preference === option.value ? "secondary" : "ghost"}
      >{option.label}</Button>)}
    </div>
    {preference === "system" ? <p>当前显示：{resolvedTheme === "light" ? "浅色" : "深色"}</p> : null}
  </div>;
}
```

Use `ThemeSelector` in Settings. Pass `preference` and `setPreference` to the current command menu, and add three safe actions labeled `主题：跟随系统`, `主题：浅色`, and `主题：深色`. Do not add approval actions or single-letter theme shortcuts.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `pnpm --filter @oh-my-bug/desktop exec vitest run test/web/keyboard.test.tsx test/web/app-shell.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit the synchronized controls**

```bash
git add apps/desktop/src/web/settings/theme-selector.tsx apps/desktop/src/web/app.tsx apps/desktop/test/web/keyboard.test.tsx
git commit -m "feat(desktop): expose three-state theme controls"
```

### Task 4: Align theme tokens and verify packaged behavior

**Files:**
- Modify: `apps/desktop/src/web/styles/tokens.css`
- Modify: `apps/desktop/src/web/styles/global.css`
- Create: `apps/desktop/test/electron/e2e/theme.spec.ts`

**Interfaces:**
- Consumes: explicit root `data-theme` values from Tasks 2–3.
- Produces: the complete `DESIGN.md` semantic token set and packaged theme regression coverage.

- [ ] **Step 1: Write the packaged theme regression**

```ts
import { expect, test } from "./electron-fixture.js";

test("persists explicit themes and follows OS changes in system mode", async ({ desktop }) => {
  await desktop.page.emulateMedia({ colorScheme: "light" });
  await desktop.page.getByRole("link", { name: "Settings" }).click();
  await expect(desktop.page.locator("html")).toHaveAttribute("data-theme", "light");

  await desktop.page.getByRole("button", { name: "深色" }).click();
  await expect(desktop.page.locator("html")).toHaveAttribute("data-theme", "dark");
  await desktop.page.reload();
  await expect(desktop.page.locator("html")).toHaveAttribute("data-theme", "dark");

  await desktop.page.getByRole("link", { name: "Settings" }).click();
  await desktop.page.getByRole("button", { name: "跟随系统" }).click();
  await desktop.page.emulateMedia({ colorScheme: "dark" });
  await expect(desktop.page.locator("html")).toHaveAttribute("data-theme", "dark");
});
```

- [ ] **Step 2: Run the packaged regression and verify RED if Task 3 is not yet wired in Electron**

Run: `pnpm build:desktop && pnpm package && pnpm test:e2e:electron -- apps/desktop/test/electron/e2e/theme.spec.ts`

Expected before final token/packaged integration: FAIL on the first unsupported or unsynchronized theme assertion. If it already passes because Tasks 1–3 fully supply the behavior, record that the higher-level test is a regression test over already-proven behavior and continue without changing product code to force an artificial failure.

- [ ] **Step 3: Complete the semantic token set**

Add the missing contract variables to `tokens.css`:

```css
:root {
  --accent-pressed: #625ce8;
  --focus: #8d88ff;
  --success-soft: rgb(69 169 120 / 10%);
  --warning-soft: rgb(209 154 58 / 10%);
  --danger-soft: rgb(214 95 107 / 10%);
  --info: #5d8fde;
  --info-soft: rgb(93 143 222 / 10%);
  --overlay: rgb(0 0 0 / 60%);
}
```

Also align the existing `--accent-soft` to `rgb(113 107 255 / 10%)` (`#716BFF1A`) and prepend `Inter Variable` to `--font-sans`, matching `DESIGN.md`. Map `--ring` to `--focus` in `global.css`. Remove the `prefers-color-scheme` token override because the provider now always applies an explicit resolved `data-theme`; retain the dark `:root` values as the failure-safe default.

- [ ] **Step 4: Run theme, web, and packaged tests**

Run: `pnpm --filter @oh-my-bug/desktop exec vitest run test/web/theme.test.ts test/web/theme-provider.test.tsx test/web/keyboard.test.tsx test/web/app-icon.test.ts`

Run: `pnpm build:desktop && pnpm package && pnpm test:e2e:electron -- apps/desktop/test/electron/e2e/theme.spec.ts`

Expected: all PASS.

- [ ] **Step 5: Run the phase verification**

Run: `pnpm typecheck && pnpm lint && pnpm --filter @oh-my-bug/desktop test && pnpm build:desktop && git diff --check`

Expected: all commands exit 0 with no new warnings.

- [ ] **Step 6: Commit the token and packaged regression**

```bash
git add apps/desktop/src/web/styles/tokens.css apps/desktop/src/web/styles/global.css apps/desktop/test/electron/e2e/theme.spec.ts
git commit -m "test(desktop): verify packaged theme behavior"
```

## Phase Completion

Before starting the shadcn migration plan, confirm:

- the default preference is `system`;
- existing light/dark storage values remain compatible;
- Settings and command menu remain synchronized;
- live system changes work only in system mode;
- the packaged app reloads without reverting explicit preferences;
- the focused suite, typecheck, lint, and desktop build pass.
