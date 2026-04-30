import { cookies } from "next/headers";
import { setRequestLocale, getTranslations } from "next-intl/server";

import type { Locale } from "@/i18n";
import { McpSettingsClient } from "@/components/settings/mcp/McpSettingsClient";

// Account-tab variant of the standalone /app/settings/mcp page. Wraps the
// same client so users find MCP server registration where they expect it
// (account nav) instead of a deep direct URL only. Auth is enforced by
// settings/layout.tsx via requireSession.
//
// Probes the API once server-side so the UI can render a friendly
// "feature disabled" line when FEATURE_MCP_CLIENT is off without
// double-prompting login.
export default async function SettingsMcpPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);

  const cookieHeader = (await cookies()).toString();
  const apiBase = process.env.INTERNAL_API_URL ?? "http://localhost:4000";

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
    <section>
      <header className="mb-6">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>
      {!mcpClientEnabled && !mcpServerEnabled ? (
        <p className="text-sm text-muted-foreground">{t("feature_disabled")}</p>
      ) : (
        <McpSettingsClient
          mcpClientEnabled={mcpClientEnabled}
          mcpServerEnabled={mcpServerEnabled}
        />
      )}
    </section>
  );
}
