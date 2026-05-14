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
  snippet?: string;
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
        ...(typeof record.snippet === "string" && record.snippet.trim()
          ? { snippet: record.snippet.trim() }
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

export function citationHref(
  citation: Citation,
  locale: string,
  wsSlug?: string,
): string {
  if (citation.url) return safeHref(citation.url);
  if (citation.noteId && wsSlug) {
    return urls.workspace.note(locale, wsSlug, citation.noteId);
  }
  return "#";
}

export function InlineCitationMarker({ citation }: { citation: Citation }) {
  const locale = useLocale();
  const t = useTranslations("agentPanel.bubble");
  const { wsSlug } = useParams<{ wsSlug?: string }>();
  const title = displayCitationTitle(citation, (values) =>
    t("citation_fallback", values),
  );
  const href = citationHref(citation, locale, wsSlug);
  const isExternal = Boolean(citation.url);

  return (
    <span className="group relative mx-0.5 inline-flex align-baseline">
      <a
        href={href}
        target={isExternal ? "_blank" : undefined}
        rel={isExternal ? "noopener noreferrer nofollow" : undefined}
        aria-label={`${title} [${citation.index}]`}
        className="inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-primary/20 bg-primary/10 px-1 text-[10px] font-semibold leading-none text-primary no-underline shadow-sm transition hover:border-primary/40 hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {citation.index}
      </a>
      <span className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 hidden w-72 -translate-x-1/2 rounded-[var(--radius-card)] border border-border bg-popover p-3 text-left text-xs leading-5 text-popover-foreground shadow-xl group-hover:block group-focus-within:block">
        <span className="block font-semibold text-foreground">{title}</span>
        {citation.snippet ? (
          <span className="mt-1 block line-clamp-4 text-muted-foreground">
            {citation.snippet}
          </span>
        ) : null}
        <span className="mt-2 block text-[11px] font-medium text-primary">
          {t("citation_view_source")}
        </span>
      </span>
    </span>
  );
}

export function CitationChips({ citations }: { citations: Citation[] }) {
  const locale = useLocale();
  const t = useTranslations("agentPanel.bubble");
  const { wsSlug } = useParams<{ wsSlug?: string }>();
  const visibleCitations = dedupeCitations(citations);

  if (!visibleCitations.length) return null;

  return (
    <div className="flex flex-wrap gap-1 pt-1">
      {visibleCitations.map((c) => {
        // c.url comes from chat-llm citations which are populated from RAG
        // hits — i.e. user-imported documents and LLM-grounded sources. Run
        // it through safeHref so a `javascript:` URL emitted by the model
        // (or smuggled through prompt-injected ingest content) cannot fire
        // on click.
        const href = citationHref(c, locale, wsSlug);
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

function dedupeCitations(citations: Citation[]): Citation[] {
  const seen = new Set<string>();
  const result: Citation[] = [];
  for (const citation of citations) {
    const key =
      citation.url?.trim() ||
      citation.noteId?.trim() ||
      citation.title.trim().toLowerCase() ||
      String(citation.index);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(citation);
  }
  return result;
}
