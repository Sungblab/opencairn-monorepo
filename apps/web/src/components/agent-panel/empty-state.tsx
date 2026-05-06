import { useTranslations } from "next-intl";

export function AgentPanelEmptyState() {
  const t = useTranslations("agentPanel.empty_state");

  return (
    <div className="flex flex-1 flex-col bg-background p-3">
      <div className="border-l-2 border-border px-3 py-2">
        <p className="text-xs font-semibold uppercase text-foreground">
          {t("title")}
        </p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {t("intro")}
        </p>
      </div>
    </div>
  );
}
