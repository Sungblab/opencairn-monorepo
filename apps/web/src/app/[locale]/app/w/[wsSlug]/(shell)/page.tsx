import { useTranslations } from "next-intl";

export default function WorkspaceDashboard() {
  const t = useTranslations("appShell.routes.dashboard");
  return (
    <div data-testid="route-dashboard" className="p-6">
      <h1 className="text-2xl font-semibold">{t("heading")}</h1>
      <p className="text-sm text-muted-foreground">{t("placeholder")}</p>
    </div>
  );
}
