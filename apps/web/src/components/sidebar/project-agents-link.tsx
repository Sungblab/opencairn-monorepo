"use client";

import { urls } from "@/lib/urls";
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
      href={urls.workspace.projectAgents(locale, wsSlug, projectId)}
      className="flex min-h-8 items-center gap-2 rounded-[var(--radius-control)] border border-border bg-background px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:border-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Bot aria-hidden className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 truncate">{t("entry")}</span>
    </Link>
  );
}
