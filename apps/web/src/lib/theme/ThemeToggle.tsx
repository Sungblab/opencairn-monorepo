"use client";

import { useTheme } from "./provider";
import { THEME_LABELS } from "./themes";

export function ThemeToggle() {
  const { theme, setTheme, themes } = useTheme();
  return (
    <select
      aria-label="Theme"
      value={theme}
      onChange={(e) => setTheme(e.target.value as typeof theme)}
      className="rounded border border-border bg-surface text-fg px-2 py-1 text-sm"
    >
      {themes.map((t) => (
        <option key={t} value={t}>
          {THEME_LABELS[t]}
        </option>
      ))}
    </select>
  );
}
