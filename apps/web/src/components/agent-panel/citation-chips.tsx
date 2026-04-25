"use client";

// Wrapped row of `[N] Title` chips linking to either an external URL or an
// in-app note. The locale prefix has to match the active route so the user
// stays in their language; we read it from next-intl rather than hardcoding
// /ko, otherwise English users would silently flip languages on click.

import { useLocale } from "next-intl";

export interface Citation {
  index: number;
  title: string;
  url?: string;
  noteId?: string;
}

export function CitationChips({ citations }: { citations: Citation[] }) {
  const locale = useLocale();

  if (!citations?.length) return null;

  return (
    <div className="flex flex-wrap gap-1 pt-1">
      {citations.map((c) => {
        const href = c.url ?? (c.noteId ? `/${locale}/app/notes/${c.noteId}` : "#");
        return (
          <a
            key={c.index}
            href={href}
            target={c.url ? "_blank" : undefined}
            rel={c.url ? "noreferrer" : undefined}
            className="rounded border border-border px-1.5 text-[10px] hover:bg-accent"
          >
            [{c.index}] {c.title}
          </a>
        );
      })}
    </div>
  );
}
