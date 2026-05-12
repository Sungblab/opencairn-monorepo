"use client";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GroundedEdge } from "../grounded-types";

interface Props {
  edge: GroundedEdge;
  onClose: () => void;
}

export function CoMentionEdgePanel({ edge, onClose }: Props) {
  const t = useTranslations("graph.coMention");
  const sourceNoteIds = edge.sourceNoteIds ?? [];

  return (
    <aside
      className="absolute right-3 top-3 z-10 flex max-h-[calc(100%-1.5rem)] w-[340px] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-lg border border-border bg-background shadow-lg"
      data-testid="co-mention-panel"
    >
      <div className="flex items-start justify-between gap-3 border-b px-3 py-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">{t("title")}</div>
          <div className="truncate text-xs text-muted-foreground">
            {t("subtitle")}
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
          {t("body")}
        </p>
        <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
          <div className="text-xs font-medium">
            {t("sourceCount", { count: sourceNoteIds.length })}
          </div>
          {sourceNoteIds.length > 0 ? (
            <div className="mt-2 space-y-1">
              {sourceNoteIds.map((noteId) => (
                <div
                  key={noteId}
                  className="truncate rounded bg-background px-2 py-1 font-mono text-[11px] text-muted-foreground"
                  title={noteId}
                >
                  {noteId}
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
