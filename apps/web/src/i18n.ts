import { getRequestConfig } from "next-intl/server";
import { notFound } from "next/navigation";

export const locales = ["ko", "en"] as const;
export const defaultLocale = "ko" as const;
export type Locale = (typeof locales)[number];

export const localeNames: Record<Locale, string> = {
  ko: "한국어",
  en: "English",
};

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = (await requestLocale) ?? defaultLocale;
  if (!locales.includes(requested as Locale)) notFound();
  const locale = requested as Locale;

  const [common, landing, dashboard, sidebar, app, editor, auth, collab] = await Promise.all([
    import(`../messages/${locale}/common.json`).then((m) => m.default),
    import(`../messages/${locale}/landing.json`).then((m) => m.default),
    import(`../messages/${locale}/dashboard.json`).then((m) => m.default),
    import(`../messages/${locale}/sidebar.json`).then((m) => m.default),
    import(`../messages/${locale}/app.json`).then((m) => m.default),
    import(`../messages/${locale}/editor.json`).then((m) => m.default),
    import(`../messages/${locale}/auth.json`).then((m) => m.default),
    import(`../messages/${locale}/collab.json`).then((m) => m.default),
  ]);

  return {
    locale,
    messages: { common, landing, dashboard, sidebar, app, editor, auth, collab },
  };
});
