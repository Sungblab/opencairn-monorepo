"use client";

// Wrapped row of `[N] Title` chips linking to either an external URL or an
// in-app note. The locale prefix has to match the active route so the user
// stays in their language; we read it from next-intl rather than hardcoding
// /ko, otherwise English users would silently flip languages on click.

import { useLocale } from "next-intl";
import { useParams } from "next/navigation";

import { safeHref } from "@/lib/url/safe-href";

export interface Citation {
  index: number;
  title: string;
  url?: string;
  noteId?: string;
}

export function CitationChips({ citations }: { citations: Citation[] }) {
  const locale = useLocale();
  const { wsSlug } = useParams<{ wsSlug?: string }>();

  if (!citations?.length) return null;

  return (
    <div className="flex flex-wrap gap-1 pt-1">
      {citations.map((c) => {
        // c.url comes from chat-llm citations which are populated from RAG
        // hits — i.e. user-imported documents and LLM-grounded sources. Run
        // it through safeHref so a `javascript:` URL emitted by the model
        // (or smuggled through prompt-injected ingest content) cannot fire
        // on click.
        const href = c.url
          ? safeHref(c.url)
          : c.noteId
            ? wsSlug
              ? `/${locale}/app/w/${wsSlug}/n/${c.noteId}`
              : "#"
            : "#";
        return (
          <a
            key={c.index}
            href={href}
            target={c.url ? "_blank" : undefined}
            rel={c.url ? "noopener noreferrer nofollow" : undefined}
            className="app-hover inline-flex max-w-[180px] items-center gap-1 rounded-[var(--radius-chip)] border border-border px-2 py-0.5 text-[10px]"
          >
            <span className="font-medium">[{c.index}]</span>
            <span className="truncate">{c.title}</span>
          </a>
        );
      })}
    </div>
  );
}
