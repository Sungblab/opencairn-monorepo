"use client";

import { useTranslations } from "next-intl";

export function ProjectMetaRow({
  name,
  pageCount,
  lastActivityIso,
}: {
  name: string;
  pageCount: number;
  lastActivityIso: string | null;
}) {
  const t = useTranslations("project.metaRow");
  // Format the timestamp on the client so we honour the user's locale +
  // timezone without paying for a server roundtrip per render. `null` only
  // happens when the project has zero notes — surface a dedicated copy so
  // empty states don't read as "Last active --".
  const lastActivity = lastActivityIso
    ? new Date(lastActivityIso).toLocaleString()
    : null;
  return (
    <div>
      <h1 className="text-2xl font-semibold">{name}</h1>
      <p className="text-sm text-muted-foreground">
        {t("pageCount", { n: pageCount })}
        {" · "}
        {lastActivity
          ? t("lastActivity", { at: lastActivity })
          : t("lastActivityNever")}
      </p>
    </div>
  );
}
