"use client";
import { useTabsStore } from "@/stores/tabs-store";
import type { EvidenceBundle, ViewNode } from "@opencairn/shared";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { GroundedCard } from "../grounded-types";
import { BookOpen, HelpCircle, Sparkles } from "lucide-react";

/**
 * One card in the `?view=cards` grid. Clicking opens the concept's first
 * source note as a *preview tab* (italic, single-slot) — same UX contract as
 * graph node single-click in Phase 1's GraphView. Disabled when the concept
 * has no source notes.
 */
export function ConceptCard({
  node,
  card,
  bundle,
  onAsk,
  onQuiz,
}: {
  node: ViewNode;
  card?: GroundedCard;
  bundle?: EvidenceBundle;
  onAsk?: () => void;
  onQuiz?: () => void;
}) {
  const t = useTranslations("graph.evidence");
  const tCards = useTranslations("graph.cards");
  const addOrReplacePreview = useTabsStore((s) => s.addOrReplacePreview);
  const title = card?.title ?? node.name;
  const summary = card?.summary ?? node.description;
  function open() {
    if (!node.firstNoteId) return;
    addOrReplacePreview({
      id: crypto.randomUUID(),
      kind: "note",
      targetId: node.firstNoteId,
      mode: "plate",
      title,
      pinned: false,
      preview: true,
      dirty: false,
      splitWith: null,
      splitSide: null,
      scrollY: 0,
    });
  }
  return (
    <article className="flex min-h-[180px] flex-col gap-3 rounded-lg border border-border bg-card p-4 text-left shadow-sm">
      <button
        type="button"
        onClick={open}
        disabled={!node.firstNoteId}
        className="flex min-w-0 flex-col items-start gap-2 text-left hover:text-foreground disabled:opacity-70"
      >
        <span className="line-clamp-2 text-sm font-semibold leading-5">
          {title}
        </span>
        {summary && (
          <span className="line-clamp-3 text-xs text-muted-foreground">
            {summary}
          </span>
        )}
      </button>
      {card && (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={card.citationCount > 0 ? "secondary" : "outline"}>
            {card.citationCount > 0
              ? t("citationCount", { count: card.citationCount })
              : t("noBundle")}
          </Badge>
          {card.evidenceBundleId && (
            <span className="font-mono text-[11px] text-muted-foreground">
              {card.evidenceBundleId.slice(0, 8)}
            </span>
          )}
        </div>
      )}
      {bundle && bundle.entries.length > 0 && (
        <details className="w-full text-xs text-muted-foreground">
          <summary className="cursor-pointer">{t("showSources")}</summary>
          <div className="mt-2 space-y-2">
            {bundle.entries.slice(0, 3).map((entry) => (
              <div
                key={`${entry.noteChunkId}-${entry.rank}`}
                className="rounded-md border border-border p-2"
              >
                <div className="font-medium text-foreground">
                  {entry.citation.title}
                </div>
                <div className="mt-1 line-clamp-3">{entry.quote}</div>
              </div>
            ))}
          </div>
        </details>
      )}
      {typeof node.degree === "number" && (
        <span className="text-xs text-muted-foreground">
          {tCards("relationCount", { count: node.degree })}
        </span>
      )}
      <div className="mt-auto grid grid-cols-3 gap-1.5 border-t border-border pt-3">
        <button
          type="button"
          onClick={open}
          disabled={!node.firstNoteId}
          className="inline-flex items-center justify-center gap-1 rounded border border-border px-2 py-1.5 text-xs hover:border-foreground disabled:opacity-50"
        >
          <BookOpen aria-hidden className="size-3.5" />
          {tCards("open")}
        </button>
        <button
          type="button"
          onClick={onAsk}
          disabled={!onAsk}
          className="inline-flex items-center justify-center gap-1 rounded border border-border px-2 py-1.5 text-xs hover:border-foreground disabled:opacity-50"
        >
          <HelpCircle aria-hidden className="size-3.5" />
          {tCards("ask")}
        </button>
        <button
          type="button"
          onClick={onQuiz}
          disabled={!onQuiz}
          className="inline-flex items-center justify-center gap-1 rounded border border-border px-2 py-1.5 text-xs hover:border-foreground disabled:opacity-50"
        >
          <Sparkles aria-hidden className="size-3.5" />
          {tCards("quiz")}
        </button>
      </div>
    </article>
  );
}
