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
import { projectNoteLinksToNodes } from "./note-link-projection";

interface Props {
  projectId: string;
}

const TIMELINE_LABEL_MAX = 20;

function timelineLabel(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length <= TIMELINE_LABEL_MAX) return trimmed;
  return `${trimmed.slice(0, TIMELINE_LABEL_MAX - 3)}...`;
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

  const projected = useMemo(
    () => projectNoteLinksToNodes(data?.nodes ?? [], data?.noteLinks),
    [data?.nodes, data?.noteLinks],
  );
  const layout = useMemo(
    () => layoutTimeline(projected.nodes),
    [projected.nodes],
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
  if (!data || projected.nodes.length === 0) {
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
      {layout.omittedCount > 0 ? (
        <div className="mb-2 rounded border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {t("views.timelineOmitted", { count: layout.omittedCount })}
        </div>
      ) : null}
      <svg
        width={layout.width}
        height={layout.height}
        role="img"
        aria-label={t("views.timeline")}
      >
        {layout.lanes.map((lane) => (
          <g key={lane.id}>
            <line
              x1={0}
              x2={layout.width}
              y1={lane.y}
              y2={lane.y}
              className="stroke-muted-foreground/35"
            />
            <text
              x={16}
              y={lane.y - 16}
              className="fill-muted-foreground text-[11px] font-medium"
            >
              {t(`timeline.lanes.${lane.id}`)}
            </text>
          </g>
        ))}
        {layout.ticks.map((tk) => (
          <g key={tk.x}>
            <line
              x1={tk.x}
              x2={tk.x}
              y1={layout.lanes[0]?.y ?? 0}
              y2={layout.lanes[layout.lanes.length - 1]?.y ?? 0}
              className="stroke-muted-foreground"
              opacity={0.16}
            />
            <text
              x={tk.x}
              y={layout.height - 20}
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
              className={
                n.lane === "undated"
                  ? projected.noteNodeIds.has(n.id)
                    ? "fill-blue-500"
                    : "fill-muted-foreground"
                  : n.lane === "created"
                    ? "fill-sky-500"
                    : "fill-primary"
              }
            />
            <text
              x={n.x}
              y={n.y - 16}
              textAnchor="middle"
              className="fill-foreground text-[11px] font-medium"
              style={{
                paintOrder: "stroke",
                stroke: "var(--theme-bg)",
                strokeLinejoin: "round",
                strokeWidth: 4,
              }}
            >
              <title>{n.name}</title>
              {timelineLabel(n.name)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
