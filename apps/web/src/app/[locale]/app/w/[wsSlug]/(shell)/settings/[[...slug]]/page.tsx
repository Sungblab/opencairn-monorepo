import { useTranslations } from "next-intl";

export default async function WorkspaceSettingsPlaceholder({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  const sub = slug?.[0] ?? "members";
  return <SettingsBody sub={sub} />;
}

function SettingsBody({ sub }: { sub: string }) {
  const t = useTranslations("appShell.routes.ws_settings");
  return (
    <div data-testid="route-ws-settings" className="p-6">
      <h1 className="text-2xl font-semibold">
        {t("heading", { sub })}
      </h1>
      <p className="text-sm text-muted-foreground">{t("placeholder")}</p>
    </div>
  );
}
