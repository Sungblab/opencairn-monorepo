"use client";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GroundedEdge } from "../grounded-types";

interface Props {
  edge: GroundedEdge;
  onClose: () => void;
  onOpenNote?: (noteId: string, title: string) => void;
}

export function CoMentionEdgePanel({ edge, onClose, onOpenNote }: Props) {
  const t = useTranslations("graph.coMention");
  const isWikiLink = edge.surfaceType === "wiki_link";
  const isSourceProximity = edge.surfaceType === "source_membership";
  const titleKey = isWikiLink
    ? "wikiTitle"
    : isSourceProximity
      ? "sourceTitle"
      : "title";
  const subtitleKey = isWikiLink
    ? "wikiSubtitle"
    : isSourceProximity
      ? "sourceSubtitle"
      : "subtitle";
  const bodyKey = isWikiLink
    ? "wikiBody"
    : isSourceProximity
      ? "sourceBody"
      : "body";
  const sourceNoteIds = edge.sourceNoteIds ?? [];
  const sourceNoteById = new Map(
    (edge.sourceNotes ?? []).map((note) => [note.id, note]),
  );
  const sourceNotes =
    isSourceProximity && edge.sourceContexts?.length
      ? edge.sourceContexts.map((context) => ({
          id: context.noteId,
          title: context.noteTitle,
          detail:
            context.headingPath?.trim() ||
            (typeof context.chunkIndex === "number"
              ? t("chunkIndex", { index: context.chunkIndex + 1 })
              : null),
        }))
      : (sourceNoteIds.length > 0
          ? sourceNoteIds.map((id) => sourceNoteById.get(id) ?? { id, title: id })
          : edge.sourceNotes ?? []
        ).map((note) => ({ ...note, detail: null as string | null }));

  return (
    <aside
      className="absolute right-3 top-3 z-10 flex max-h-[calc(100%-1.5rem)] w-[340px] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-lg border border-border bg-background shadow-lg"
      data-testid="co-mention-panel"
    >
      <div className="flex items-start justify-between gap-3 border-b px-3 py-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">
            {t(titleKey)}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {t(subtitleKey)}
          </div>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-7 shrink-0"
          aria-label={t("close")}
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </div>
      <div className="space-y-3 overflow-y-auto p-3 text-sm">
        <p className="text-xs leading-5 text-muted-foreground">
          {t(bodyKey)}
        </p>
        <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
          <div className="text-xs font-medium">
            {t("sourceCount", { count: sourceNotes.length })}
          </div>
          {sourceNotes.length > 0 ? (
            <div className="mt-2 space-y-1">
              {sourceNotes.map((note) => (
                <div
                  key={note.id}
                  className="flex items-center justify-between gap-2 rounded bg-background px-2 py-1 text-[11px] text-muted-foreground"
                  title={note.title}
                >
                  <span className="min-w-0">
                    <span className="block truncate">{note.title}</span>
                    {note.detail ? (
                      <span className="block truncate text-[10px] text-muted-foreground/80">
                        {note.detail}
                      </span>
                    ) : null}
                  </span>
                  {onOpenNote ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-6 shrink-0 px-2 text-[11px]"
                      onClick={() => onOpenNote(note.id, note.title)}
                    >
                      {t("openSource")}
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-2 text-xs text-muted-foreground">
              {t("noSources")}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
