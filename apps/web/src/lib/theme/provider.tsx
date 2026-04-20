"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { DEFAULT_THEME, THEMES, type Theme, isTheme } from "./themes";
import { writeThemeCookie } from "./cookie";

type ThemeCtx = {
  theme: Theme;
  setTheme: (next: Theme) => void;
  themes: readonly Theme[];
};

const Ctx = createContext<ThemeCtx | null>(null);

export function ThemeProvider({
  initialTheme,
  children,
}: {
  initialTheme: Theme;
  children: ReactNode;
}) {
  const [theme, setThemeState] = useState<Theme>(initialTheme);

  useEffect(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem("opencairn.theme") : null;
    if (stored && isTheme(stored) && stored !== initialTheme) {
      setThemeState(stored);
      document.documentElement.setAttribute("data-theme", stored);
      return;
    }
    if (!stored && typeof window !== "undefined") {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      if (prefersDark && initialTheme === DEFAULT_THEME) {
        setThemeState("cairn-dark");
        document.documentElement.setAttribute("data-theme", "cairn-dark");
      }
    }
  }, [initialTheme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    document.documentElement.setAttribute("data-theme", next);
    window.localStorage.setItem("opencairn.theme", next);
    writeThemeCookie(next);
  }, []);

  return <Ctx.Provider value={{ theme, setTheme, themes: THEMES }}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTheme must be used within ThemeProvider");
  return v;
}
