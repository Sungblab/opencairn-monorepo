import type { Locale } from "@/i18n-locales";

export const LOCALE_COOKIE = "NEXT_LOCALE";

export function writeLocaleCookie(locale: Locale) {
  if (typeof document === "undefined") return;
  const oneYear = 60 * 60 * 24 * 365;
  document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${oneYear}; SameSite=Lax`;
}
