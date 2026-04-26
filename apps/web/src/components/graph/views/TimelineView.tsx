"use client";
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { useProjectGraph } from "../useProjectGraph";
import { useTabsStore } from "@/stores/tabs-store";
import {
  layoutTimeline,
  TIMELINE_NODE_RADIUS,
  type PositionedNode,
} from "./timeline-layout";

interface Props {
  projectId: string;
}

/**
 * `?view=timeline` — left-to-right SVG axis of concepts placed by curated
 * `eventYear` (or `createdAt` fallback). Pure React + SVG (no cytoscape, no
 * D3) so the axis math is testable in isolation (see timeline-layout.ts).
 */
export default function TimelineView({ projectId }: Props) {
  const t = useTranslations("graph");
  const { data, isLoading, error } = useProjectGraph(projectId, {
    view: "timeline",
  });
  const addOrReplacePreview = useTabsStore((s) => s.addOrReplacePreview);

  const layout = useMemo(
    () => layoutTimeline(data?.nodes ?? []),
    [data],
  );

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">…</div>;
  }
  if (error) {
    return (
      <div className="p-6 text-sm text-destructive">
        {t("errors.loadFailed")}
      </div>
    );
  }
  if (!data || data.nodes.length === 0) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        {t("views.noConcepts")}
      </div>
    );
  }

  function openNote(n: PositionedNode) {
    if (!n.firstNoteId) return;
    addOrReplacePreview({
      id: crypto.randomUUID(),
      kind: "note",
      targetId: n.firstNoteId,
      mode: "plate",
      title: n.name,
      pinned: false,
      preview: true,
      dirty: false,
      splitWith: null,
      splitSide: null,
      scrollY: 0,
    });
  }

  return (
    <div className="h-full overflow-x-auto p-4">
      <svg
        width={layout.width}
        height={layout.height}
        role="img"
        aria-label={t("views.timeline")}
      >
        <line
          x1={0}
          x2={layout.width}
          y1={layout.height / 2}
          y2={layout.height / 2}
          className="stroke-muted-foreground"
        />
        {layout.ticks.map((tk) => (
          <g key={tk.x}>
            <line
              x1={tk.x}
              x2={tk.x}
              y1={layout.height / 2 - 6}
              y2={layout.height / 2 + 6}
              className="stroke-muted-foreground"
            />
            <text
              x={tk.x}
              y={layout.height / 2 + 24}
              textAnchor="middle"
              className="fill-muted-foreground text-[10px]"
            >
              {tk.label}
            </text>
          </g>
        ))}
        {layout.nodes.map((n) => (
          <g
            key={n.id}
            onClick={() => openNote(n)}
            style={{ cursor: n.firstNoteId ? "pointer" : "default" }}
          >
            <circle
              cx={n.x}
              cy={n.y}
              r={TIMELINE_NODE_RADIUS}
              className="fill-primary"
            />
            <text
              x={n.x}
              y={n.y - 16}
              textAnchor="middle"
              className="fill-foreground text-xs"
            >
              {n.name}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
