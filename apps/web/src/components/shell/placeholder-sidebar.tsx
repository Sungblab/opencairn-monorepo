"use client";
import { useTranslations } from "next-intl";

export function PlaceholderSidebar() {
  const t = useTranslations("appShell.placeholders");
  return (
    <aside
      data-testid="app-shell-sidebar"
      className="h-full border-r border-border bg-background text-sm text-muted-foreground"
    >
      <div className="p-4">{t("sidebar")}</div>
    </aside>
  );
}
