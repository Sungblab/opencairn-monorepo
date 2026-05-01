"use client";

import { urls } from "@/lib/urls";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import Link from "next/link";

import { NoteHistoryButton } from "@/components/notes/history/note-history-button";

interface Props {
  noteId: string;
  readOnly: boolean;
  wsSlug: string;
  projectId: string;
  projectName: string | null;
  title: string;
  updatedAtIso: string;
}

// Sticky breadcrumb chrome above the NoteEditor body. Mirrors the
// 2026-04-23 mockup §screen-note: project › note crumb on the left,
// "{at} 자동 저장" pill on the right.
//
// Mockup deviation: the mockup also shows ghost icon buttons for
// 댓글/공유/더보기 in this row, but the existing NoteEditor already
// owns the comments panel and the Share dialog inside its title row.
// Adding decorative duplicates here would confuse users (two share
// buttons, only one actually opens the dialog) and wiring them
// properly requires lifting state out of NoteEditor — out of scope
// for this chrome-only sweep. Tracked in the audit doc § Deviations
// D5; the row reserves vertical space so the swap is invisible when
// the buttons are added in a follow-up.
export function NoteRouteChrome({
  noteId,
  readOnly,
  wsSlug,
  projectId,
  projectName,
  title,
  updatedAtIso,
}: Props) {
  const locale = useLocale();
  const format = useFormatter();
  const t = useTranslations("appShell.routes.note.chrome");
  const updatedAt = format.relativeTime(new Date(updatedAtIso));
  const projectHref = urls.workspace.project(locale, wsSlug, projectId);

  return (
    <div
      className="sticky top-0 z-10 flex items-center justify-between gap-4 bg-background px-8 py-3"
      style={{ borderBottom: "1px solid var(--theme-border)" }}
      data-testid="note-route-chrome"
    >
      <nav
        aria-label={t("breadcrumb_label")}
        className="min-w-0 truncate text-xs text-muted-foreground"
      >
        {projectName ? (
          <Link
            href={projectHref}
            className="hover:text-foreground hover:underline"
          >
            {projectName}
          </Link>
        ) : (
          <span>{t("project_unknown")}</span>
        )}
        <span className="mx-1.5">›</span>
        <span className="text-foreground">{title}</span>
      </nav>
      <div className="flex shrink-0 items-center gap-2">
        <span
          className="text-[11px] text-muted-foreground"
          data-testid="note-autosave-pill"
        >
          {t("autosave", { at: updatedAt })}
        </span>
        <NoteHistoryButton noteId={noteId} readOnly={readOnly} />
      </div>
    </div>
  );
}
