"use client";

import { urls } from "@/lib/urls";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { GraduationCap } from "lucide-react";
import { useCurrentProjectContext } from "./use-current-project";

// Mirrors ProjectAgentsLink/ProjectGraphLink — entry to the learning system
// (SM-2 flashcards + Socratic Agent + understanding scores) at /p/<id>/learn.
// Plan 6 shipped the routes via PR #50 but no sidebar discovery existed
// until now, so users had to type the URL by hand.
export function ProjectLearnLink() {
  const t = useTranslations("sidebar.learn");
  const locale = useLocale();
  const { wsSlug, projectId } = useCurrentProjectContext();

  if (!projectId || !wsSlug) return null;

  return (
    <Link
      href={urls.workspace.projectLearn(locale, wsSlug, projectId)}
      className="flex min-h-8 items-center gap-2 border-l-2 border-transparent px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:border-border hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <GraduationCap aria-hidden className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 truncate">{t("entry")}</span>
    </Link>
  );
}
