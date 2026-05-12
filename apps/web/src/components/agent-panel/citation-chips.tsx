"use client";

// Wrapped row of `[N] Title` chips linking to either an external URL or an
// in-app note. The locale prefix has to match the active route so the user
// stays in their language; we read it from next-intl rather than hardcoding
// /ko, otherwise English users would silently flip languages on click.

import { useLocale, useTranslations } from "next-intl";
import { useParams } from "next/navigation";

import { safeHref } from "@/lib/url/safe-href";
import { urls } from "@/lib/urls";

export interface Citation {
  index: number;
  title: string;
  url?: string;
  noteId?: string;
}

export function asCitations(v: unknown): Citation[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((c): Citation[] => {
    const rawIndex = (c as { index?: unknown })?.index;
    if (
      typeof c !== "object" ||
      c === null ||
      typeof rawIndex !== "number"
    ) {
      return [];
    }
    const record = c as Record<string, unknown>;
    const title =
      typeof record.title === "string" && record.title.trim()
        ? record.title
        : typeof record.source_title === "string" && record.source_title.trim()
          ? record.source_title
          : typeof record.label === "string" && record.label.trim()
            ? record.label
            : "Untitled source";
    return [
      {
        index: rawIndex,
        title,
        ...(typeof record.url === "string" ? { url: record.url } : {}),
        ...(typeof record.noteId === "string"
          ? { noteId: record.noteId }
          : typeof record.source_id === "string" && record.source_type === "note"
            ? { noteId: record.source_id }
            : {}),
      },
    ];
  });
}

export function stripRenderedCitationMarkers(
  body: string,
  citations: Citation[],
): string {
  if (citations.length === 0) return body;
  const citationIndexes = new Set(citations.map((citation) => citation.index));
  return body
    .replace(/\s*\[\^(\d+)\]/g, (match, index: string) =>
      citationIndexes.has(Number(index)) ? "" : match,
    )
    .trimEnd();
}

function displayCitationTitle(
  citation: Citation,
  fallback: (values: { index: number }) => string,
): string {
  const title = citation.title.trim();
  if (title && title !== "Untitled" && title !== "Untitled source") {
    return title;
  }
  return fallback({ index: citation.index });
}

export function CitationChips({ citations }: { citations: Citation[] }) {
  const locale = useLocale();
  const t = useTranslations("agentPanel.bubble");
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
          : c.noteId && wsSlug
            ? urls.workspace.note(locale, wsSlug, c.noteId)
            : "#";
        return (
          <a
            key={c.index}
            href={href}
            target={c.url ? "_blank" : undefined}
            rel={c.url ? "noopener noreferrer nofollow" : undefined}
            className="app-hover inline-flex max-w-[180px] items-center gap-1 rounded-[var(--radius-control)] border border-border px-2 py-0.5 text-[10px]"
          >
            <span className="font-medium">[{c.index}]</span>
            <span className="truncate">
              {displayCitationTitle(c, (values) =>
                t("citation_fallback", values),
              )}
            </span>
          </a>
        );
      })}
    </div>
  );
}
