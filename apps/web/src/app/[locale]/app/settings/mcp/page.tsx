import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import type { Locale } from "@/i18n";
import { McpSettingsClient } from "@/components/settings/mcp/McpSettingsClient";

export default async function SettingsMcpPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);

  const cookieHeader = (await cookies()).toString();
  const apiBase = process.env.INTERNAL_API_URL ?? "http://localhost:4000";

  const meRes = await fetch(`${apiBase}/api/auth/me`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (!meRes.ok) {
    redirect(
      `/${locale}/auth/login?return_to=${encodeURIComponent(
        `/${locale}/app/settings/mcp`,
      )}`,
    );
  }

  const t = await getTranslations({
    locale: locale as Locale,
    namespace: "settings.mcp",
  });

  const probe = await fetch(`${apiBase}/api/mcp/servers`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  const mcpClientEnabled = probe.status !== 404;
  const mcpServerEnabled =
    (process.env.FEATURE_MCP_SERVER ?? "false").toLowerCase() === "true";

  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>
      {!mcpClientEnabled && !mcpServerEnabled ? (
        <p className="text-sm text-muted-foreground">
          {t("feature_disabled")}
        </p>
      ) : (
        <McpSettingsClient
          mcpClientEnabled={mcpClientEnabled}
          mcpServerEnabled={mcpServerEnabled}
        />
      )}
    </main>
  );
}
