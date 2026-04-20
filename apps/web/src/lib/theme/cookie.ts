import { DEFAULT_THEME, isTheme, type Theme } from "./themes";

export const THEME_COOKIE = "opencairn.theme";

export function themeFromCookieValue(raw: string | undefined): Theme {
  return isTheme(raw) ? raw : DEFAULT_THEME;
}

export function writeThemeCookie(theme: Theme) {
  if (typeof document === "undefined") return;
  const oneYear = 60 * 60 * 24 * 365;
  document.cookie = `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${oneYear}; SameSite=Lax`;
}
