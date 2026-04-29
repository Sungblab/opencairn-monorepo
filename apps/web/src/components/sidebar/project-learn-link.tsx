"use client";

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
      href={`/${locale}/app/w/${wsSlug}/p/${projectId}/learn`}
      className="mx-3 mb-2 flex items-center gap-2 rounded border border-border px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
    >
      <GraduationCap aria-hidden className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 truncate">{t("entry")}</span>
    </Link>
  );
}
