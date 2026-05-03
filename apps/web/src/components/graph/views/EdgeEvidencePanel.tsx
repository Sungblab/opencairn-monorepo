"use client";
import type { EvidenceBundle } from "@opencairn/shared";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { GroundedEdge } from "../grounded-types";

interface Props {
  edge: GroundedEdge;
  bundle?: EvidenceBundle | null;
  onClose: () => void;
}

export function EdgeEvidencePanel({ edge, bundle, onClose }: Props) {
  const t = useTranslations("graph.evidence");
  const support = edge.support ?? {
    status: "missing" as const,
    supportScore: 0,
    citationCount: 0,
    evidenceBundleId: null,
    claimId: null,
  };
  const entries = bundle?.entries ?? [];

  return (
    <aside
      className="absolute right-3 top-3 z-10 flex max-h-[calc(100%-1.5rem)] w-[340px] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-lg border border-border bg-background shadow-lg"
      data-testid="edge-evidence-panel"
    >
      <div className="flex items-start justify-between gap-3 border-b px-3 py-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">{t("title")}</div>
          <div className="truncate text-xs text-muted-foreground">
            {edge.relationType}
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
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={support.status === "disputed" ? "destructive" : "secondary"}>
            {t(`status.${support.status}`)}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {t("score", { score: Math.round(support.supportScore * 100) })}
          </span>
          <span className="text-xs text-muted-foreground">
            {t("citationCount", { count: support.citationCount })}
          </span>
        </div>
        {support.evidenceBundleId && (
          <div className="rounded-md bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground">
            {support.evidenceBundleId}
          </div>
        )}
        {entries.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("noEntries")}</p>
        ) : (
          <div className="space-y-2">
            {entries.map((entry) => (
              <div
                key={`${entry.noteChunkId}-${entry.rank}`}
                className="rounded-md border border-border p-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-medium">
                    {entry.citation.title}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {entry.citation.label}
                  </span>
                </div>
                {entry.headingPath && (
                  <div className="mt-1 truncate text-[11px] text-muted-foreground">
                    {entry.headingPath}
                  </div>
                )}
                <p className="mt-2 line-clamp-4 text-xs text-muted-foreground">
                  {entry.quote}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
