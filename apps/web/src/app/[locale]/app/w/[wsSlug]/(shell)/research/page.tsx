import { useTranslations } from "next-intl";

export default function ResearchHubPlaceholder() {
  const t = useTranslations("appShell.routes.research_hub");
  return (
    <div data-testid="route-research-hub" className="p-6">
      <h1 className="text-2xl font-semibold">{t("heading")}</h1>
      <p className="text-sm text-muted-foreground">{t("placeholder")}</p>
    </div>
  );
}
