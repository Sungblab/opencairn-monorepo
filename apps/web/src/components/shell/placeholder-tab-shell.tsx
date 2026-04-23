"use client";
import { useTranslations } from "next-intl";

export function PlaceholderTabShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = useTranslations("appShell.placeholders");
  return (
    <main
      data-testid="app-shell-main"
      className="flex min-h-0 flex-1 flex-col bg-background"
    >
      <div className="flex h-10 items-center border-b border-border px-3 text-xs text-muted-foreground">
        {t("tab_bar")}
      </div>
      <div className="flex-1 overflow-auto">{children}</div>
    </main>
  );
}
