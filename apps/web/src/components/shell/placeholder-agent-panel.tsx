"use client";
import { useTranslations } from "next-intl";

export function PlaceholderAgentPanel() {
  const t = useTranslations("appShell.placeholders");
  return (
    <aside
      data-testid="app-shell-agent-panel"
      className="h-full border-l border-border bg-background text-sm text-muted-foreground"
    >
      <div className="p-4">{t("agent_panel")}</div>
    </aside>
  );
}
