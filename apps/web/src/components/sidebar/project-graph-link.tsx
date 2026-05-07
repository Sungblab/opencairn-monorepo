"use client";
import { useLocale, useTranslations } from "next-intl";
import { Workflow } from "lucide-react";
import Link from "next/link";
import { useCurrentProjectContext } from "./use-current-project";
import { urls } from "@/lib/urls";

export function ProjectGraphLink() {
  const t = useTranslations("sidebar.graph");
  const locale = useLocale();
  const { wsSlug, projectId } = useCurrentProjectContext();

  if (!projectId || !wsSlug) return null;
  const href = urls.workspace.projectGraph(locale, wsSlug, projectId);

  return (
    <Link
      href={href}
      onClick={(event) => {
        event.preventDefault();
        window.location.assign(href);
      }}
      className="flex min-h-8 items-center gap-2 rounded-[var(--radius-control)] border border-border bg-background px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:border-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Workflow aria-hidden className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 truncate">{t("entry")}</span>
    </Link>
  );
}
