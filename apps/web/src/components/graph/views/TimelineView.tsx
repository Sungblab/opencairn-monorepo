"use client";
import { type PointerEvent, useCallback, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { LocateFixed, Minus, Plus, RotateCcw } from "lucide-react";
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
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const panRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);

  const projected = useMemo(
    () => projectNoteLinksToNodes(data?.nodes ?? [], data?.noteLinks),
    [data?.nodes, data?.noteLinks],
  );
  const layout = useMemo(
    () => layoutTimeline(projected.nodes),
    [projected.nodes],
  );

  const clampZoom = useCallback((value: number) => {
    return Math.max(0.55, Math.min(2.2, value));
  }, []);
  const fitTimeline = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const availableWidth = Math.max(320, viewport.clientWidth - 48);
    const availableHeight = Math.max(240, viewport.clientHeight - 48);
    setZoom(clampZoom(Math.min(availableWidth / layout.width, availableHeight / layout.height)));
  }, [clampZoom, layout.height, layout.width]);
  const startPan = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as Element | null;
    if (target?.closest("[data-timeline-node='true'],button,a")) return;
    const viewport = event.currentTarget;
    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    };
    setIsPanning(true);
    viewport.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }, []);
  const movePan = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    const viewport = event.currentTarget;
    viewport.scrollLeft = pan.scrollLeft - (event.clientX - pan.startX);
    viewport.scrollTop = pan.scrollTop - (event.clientY - pan.startY);
  }, []);
  const stopPan = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    panRef.current = null;
    setIsPanning(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }, []);

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
    <div
      ref={viewportRef}
      data-testid="timeline-viewport"
      className={`relative h-full overflow-auto bg-background p-4 ${
        isPanning ? "cursor-grabbing select-none" : "cursor-grab"
      }`}
      onPointerDown={startPan}
      onPointerMove={movePan}
      onPointerUp={stopPan}
      onPointerCancel={stopPan}
    >
      <ViewZoomControls
        onFit={fitTimeline}
        onZoomIn={() => setZoom((value) => clampZoom(value * 1.16))}
        onZoomOut={() => setZoom((value) => clampZoom(value / 1.16))}
        onReset={() => setZoom(1)}
      />
      {layout.omittedCount > 0 ? (
        <div className="mb-2 rounded border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {t("views.timelineOmitted", { count: layout.omittedCount })}
        </div>
      ) : null}
      <div
        data-testid="timeline-canvas"
        className="relative origin-top-left"
        style={{
          width: layout.width * zoom,
          height: layout.height * zoom,
          minWidth: "100%",
        }}
      >
      <div
        className="origin-top-left"
        style={{
          width: layout.width,
          height: layout.height,
          transform: `scale(${zoom})`,
        }}
      >
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
            data-timeline-node="true"
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
      </div>
    </div>
  );
}

function ViewZoomControls({
  onFit,
  onZoomIn,
  onZoomOut,
  onReset,
}: {
  onFit: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}) {
  const t = useTranslations("graph.controls");
  const buttons = [
    { label: t("fit"), icon: LocateFixed, onClick: onFit },
    { label: t("zoomIn"), icon: Plus, onClick: onZoomIn },
    { label: t("zoomOut"), icon: Minus, onClick: onZoomOut },
    { label: t("reset"), icon: RotateCcw, onClick: onReset },
  ];
  return (
    <div className="sticky right-3 top-3 z-20 ml-auto mr-3 mt-3 flex w-fit items-center gap-1 rounded-lg border border-border bg-background/90 p-1 shadow-sm backdrop-blur">
      {buttons.map(({ label, icon: Icon, onClick }) => (
        <button
          key={label}
          type="button"
          aria-label={label}
          title={label}
          onClick={onClick}
          className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30"
        >
          <Icon aria-hidden className="size-4" />
        </button>
      ))}
    </div>
  );
}
