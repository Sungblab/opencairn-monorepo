"use client";
import { useTranslations } from "next-intl";

export function GraphEmpty() {
  const t = useTranslations("graph.empty");
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
      <p className="font-medium text-foreground">{t("title")}</p>
      <p>{t("body")}</p>
    </div>
  );
}
