"use client";
import { useTranslations } from "next-intl";

export function StubViewer({ mode }: { mode: string }) {
  const t = useTranslations("appShell.viewers.stub");
  return (
    <div
      data-testid="stub-viewer"
      className="flex h-full items-center justify-center text-sm text-muted-foreground"
    >
      {t("unavailable", { mode })}
    </div>
  );
}
