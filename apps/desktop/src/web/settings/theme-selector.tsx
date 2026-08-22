import { Button } from "../components/ui/button.js";
import { useTheme } from "../theme/theme-context.js";
import type { ThemePreference } from "../theme/theme.js";

const options: Array<{ value: ThemePreference; label: string }> = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
];

export function ThemeSelector() {
  const { preference, setPreference } = useTheme();
  return (
    <div className="theme-selector">
      <div aria-label="主题" className="flex w-fit gap-1 rounded-lg border border-border p-1" role="group">
        {options.map((option) => (
          <Button
            aria-pressed={preference === option.value}
            key={option.value}
            onClick={() => setPreference(option.value)}
            type="button"
            variant={preference === option.value ? "default" : "ghost"}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
