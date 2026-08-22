import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { ThemeContext } from "./theme-context.js";
import {
  applyTheme,
  parseThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "./theme.js";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const query = useMemo(() => {
    try {
      return window.matchMedia?.("(prefers-color-scheme: light)");
    } catch {
      return undefined;
    }
  }, []);
  const [preference, setPreferenceState] = useState<ThemePreference>(() => {
    try {
      return parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY));
    } catch {
      return "system";
    }
  });
  const [prefersLight, setPrefersLight] = useState(() => readPrefersLight(query));
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
    if (next === "system") setPrefersLight(readPrefersLight(query));
    setPreferenceState(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Keep the selected preference in memory when storage is unavailable.
    }
  };

  return (
    <ThemeContext.Provider value={{ preference, resolvedTheme, setPreference }}>
      {children}
    </ThemeContext.Provider>
  );
}

function readPrefersLight(query: MediaQueryList | undefined): boolean {
  try {
    return query?.matches ?? false;
  } catch {
    return false;
  }
}
