"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Bot } from "lucide-react";
import { useCurrentProjectContext } from "./use-current-project";

export function ProjectAgentsLink() {
  const t = useTranslations("sidebar.agents");
  const locale = useLocale();
  const { wsSlug, projectId } = useCurrentProjectContext();

  if (!projectId || !wsSlug) return null;

  return (
    <Link
      href={`/${locale}/app/w/${wsSlug}/p/${projectId}/agents`}
      className="mx-3 mb-2 flex items-center gap-2 rounded border border-border px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
    >
      <Bot aria-hidden className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 truncate">{t("entry")}</span>
    </Link>
  );
}
