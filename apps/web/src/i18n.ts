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

  const [
    common,
    landing,
    dashboard,
    sidebar,
    app,
    editor,
    auth,
    collab,
    importMessages,
    onboarding,
    appShell,
    agentPanel,
    research,
    canvas,
    note,
    project,
    workspaceSettings,
    account,
    palette,
    notifications,
    settings,
  ] = await Promise.all([
    import(`../messages/${locale}/common.json`).then((m) => m.default),
    import(`../messages/${locale}/landing.json`).then((m) => m.default),
    import(`../messages/${locale}/dashboard.json`).then((m) => m.default),
    import(`../messages/${locale}/sidebar.json`).then((m) => m.default),
    import(`../messages/${locale}/app.json`).then((m) => m.default),
    import(`../messages/${locale}/editor.json`).then((m) => m.default),
    import(`../messages/${locale}/auth.json`).then((m) => m.default),
    import(`../messages/${locale}/collab.json`).then((m) => m.default),
    import(`../messages/${locale}/import.json`).then((m) => m.default),
    import(`../messages/${locale}/onboarding.json`).then((m) => m.default),
    import(`../messages/${locale}/app-shell.json`).then((m) => m.default),
    import(`../messages/${locale}/agent-panel.json`).then((m) => m.default),
    import(`../messages/${locale}/research.json`).then((m) => m.default),
    import(`../messages/${locale}/canvas.json`).then((m) => m.default),
    import(`../messages/${locale}/note.json`).then((m) => m.default),
    import(`../messages/${locale}/project.json`).then((m) => m.default),
    import(`../messages/${locale}/workspace-settings.json`).then(
      (m) => m.default,
    ),
    import(`../messages/${locale}/account.json`).then((m) => m.default),
    import(`../messages/${locale}/palette.json`).then((m) => m.default),
    import(`../messages/${locale}/notifications.json`).then((m) => m.default),
    import(`../messages/${locale}/settings.json`).then((m) => m.default),
  ]);

  return {
    locale,
    messages: {
      common,
      landing,
      dashboard,
      sidebar,
      app,
      editor,
      auth,
      collab,
      import: importMessages,
      onboarding,
      appShell,
      agentPanel,
      research,
      canvas,
      note,
      project,
      workspaceSettings,
      account,
      palette,
      notifications,
      settings,
    },
  };
});
