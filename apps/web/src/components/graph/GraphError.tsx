"use client";
import { useTranslations } from "next-intl";

export function GraphError({ error }: { error: Error }) {
  const t = useTranslations("graph.errors");
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-destructive">
      <p className="font-medium">{t("loadFailed")}</p>
      <p className="text-xs">{error.message}</p>
    </div>
  );
}
