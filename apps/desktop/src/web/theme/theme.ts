export const THEME_STORAGE_KEY = "oh-my-bug-theme";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export function parseThemePreference(value: string | null): ThemePreference {
  return value === "system" || value === "light" || value === "dark" ? value : "system";
}

export function resolveTheme(preference: ThemePreference, prefersLight: boolean): ResolvedTheme {
  return preference === "system" ? (prefersLight ? "light" : "dark") : preference;
}

export function applyTheme(root: HTMLElement, theme: ResolvedTheme): void {
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}
