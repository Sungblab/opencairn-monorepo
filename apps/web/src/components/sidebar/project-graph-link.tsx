"use client";
import { useLocale, useTranslations } from "next-intl";
import { Workflow } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCurrentProjectContext } from "./use-current-project";
import { urls } from "@/lib/urls";

export function ProjectGraphLink() {
  const t = useTranslations("sidebar.graph");
  const locale = useLocale();
  const { projectId } = useCurrentProjectContext();
  const params = useParams<{ wsSlug: string }>();
  const wsSlug = params?.wsSlug;

  if (!projectId || !wsSlug) return null;
  const href = urls.workspace.projectGraph(locale, wsSlug, projectId);

  return (
    <Link
      href={href}
      onClick={(event) => {
        event.preventDefault();
        window.location.assign(href);
      }}
      className="mx-3 my-2 flex items-center gap-2 rounded border border-border px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
    >
      <Workflow aria-hidden className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 truncate">{t("entry")}</span>
    </Link>
  );
}
