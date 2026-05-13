"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { LocateFixed, Minus, Plus, RotateCcw } from "lucide-react";
import type { ViewNode } from "@opencairn/shared";
import { useProjectGraph } from "../useProjectGraph";
import type { GroundedEdge } from "../grounded-types";
import { projectNoteLinksToGraph } from "./note-link-projection";
import { simplifyGraphForDefaultView } from "./display-graph";

interface Props {
  projectId: string;
  root?: string;
}

type BoardPosition = { x: number; y: number };

const BOARD_WIDTH = 1440;
const BOARD_HEIGHT = 920;
const NODE_WIDTH = 210;
const NODE_HEIGHT = 58;

function boardLayout(
  nodes: ViewNode[],
  edges: GroundedEdge[],
  rootId?: string | null,
): Map<string, BoardPosition> {
  const positions = new Map<string, BoardPosition>();
  const nodeIds = nodes.map((node) => node.id);
  if (nodeIds.length === 0) return positions;
  for (const node of nodes) {
    if (node.position) {
      positions.set(node.id, clampPosition(node.position));
    }
  }

  const degree = new Map(nodeIds.map((id) => [id, 0]));
  for (const edge of edges) {
    degree.set(edge.sourceId, (degree.get(edge.sourceId) ?? 0) + 1);
    degree.set(edge.targetId, (degree.get(edge.targetId) ?? 0) + 1);
  }
  const [degreeHubId] = [...nodeIds].sort(
    (a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0),
  );
  const hubId = rootId && nodeIds.includes(rootId) ? rootId : degreeHubId;
  const hubX = BOARD_WIDTH / 2 - NODE_WIDTH / 2;
  const hubY = BOARD_HEIGHT / 2 - NODE_HEIGHT / 2;
  if (!positions.has(hubId)) {
    positions.set(hubId, { x: hubX, y: hubY });
  }

  const neighborIds = new Set<string>();
  for (const edge of edges) {
    if (edge.sourceId === hubId) neighborIds.add(edge.targetId);
    if (edge.targetId === hubId) neighborIds.add(edge.sourceId);
  }
  const ring = [...neighborIds].filter((id) => nodeIds.includes(id) && !positions.has(id));
  ring.forEach((id, index) => {
    const angle = -Math.PI / 2 + (index / Math.max(1, ring.length)) * Math.PI * 2;
    positions.set(id, {
      x: hubX + Math.cos(angle) * 430,
      y: hubY + Math.sin(angle) * 300,
    });
  });

  const rest = nodeIds.filter((id) => !positions.has(id));
  rest.forEach((id, index) => {
    const col = index % 5;
    const row = Math.floor(index / 5);
    positions.set(id, {
      x: 80 + col * 260,
      y: 760 + row * 92,
    });
  });

  return positions;
}

function clampPosition(pos: BoardPosition): BoardPosition {
  return {
    x: Math.max(16, Math.min(BOARD_WIDTH - NODE_WIDTH - 16, pos.x)),
    y: Math.max(16, Math.min(BOARD_HEIGHT - NODE_HEIGHT - 16, pos.y)),
  };
}

export default function BoardView({ projectId, root }: Props) {
  const t = useTranslations("graph");
  const { data, isLoading, error } = useProjectGraph(projectId, {
    view: "board",
    root,
  });
  const [zoom, setZoom] = useState(0.76);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const displayData = useMemo(
    () =>
      data
        ? simplifyGraphForDefaultView(data, {
            maxNodes: 18,
            maxEdges: 36,
          })
        : null,
    [data],
  );
  const projected = useMemo(
    () =>
      projectNoteLinksToGraph(
        displayData?.nodes ?? [],
        displayData?.edges ?? [],
        displayData?.noteLinks,
      ),
    [displayData?.edges, displayData?.nodes, displayData?.noteLinks],
  );
  const initialPositions = useMemo(
    () =>
      boardLayout(
        projected.nodes,
        projected.edges,
        data?.rootId ?? root ?? null,
      ),
    [data?.rootId, projected.edges, projected.nodes, root],
  );
  const [positions, setPositions] = useState(initialPositions);
  const dragRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    origin: BoardPosition;
  } | null>(null);

  useEffect(() => {
    setPositions(initialPositions);
  }, [initialPositions]);

  const clampZoom = useCallback((value: number) => {
    return Math.max(0.42, Math.min(1.6, value));
  }, []);
  const fitBoard = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const availableWidth = Math.max(320, viewport.clientWidth - 48);
    const availableHeight = Math.max(320, viewport.clientHeight - 48);
    setZoom(clampZoom(Math.min(availableWidth / BOARD_WIDTH, availableHeight / BOARD_HEIGHT)));
  }, [clampZoom]);

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

  return (
    <div
      ref={viewportRef}
      className="relative h-full overflow-auto bg-background"
    >
      <ViewZoomControls
        onFit={fitBoard}
        onZoomIn={() => setZoom((value) => clampZoom(value * 1.16))}
        onZoomOut={() => setZoom((value) => clampZoom(value / 1.16))}
        onReset={() => setZoom(0.76)}
      />
      <div
        className="p-4"
        style={{ width: BOARD_WIDTH * zoom + 32, height: BOARD_HEIGHT * zoom + 32 }}
      >
      <div
        data-testid="board-canvas"
        className="relative origin-top-left rounded-lg border border-border bg-background shadow-sm"
        style={{
          width: BOARD_WIDTH,
          height: BOARD_HEIGHT,
          transform: `scale(${zoom})`,
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag) return;
          const dx = (event.clientX - drag.startX) / zoom;
          const dy = (event.clientY - drag.startY) / zoom;
          setPositions((current) => {
            const next = new Map(current);
            next.set(
              drag.id,
              clampPosition({ x: drag.origin.x + dx, y: drag.origin.y + dy }),
            );
            return next;
          });
        }}
        onPointerUp={() => {
          dragRef.current = null;
        }}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
      >
        <svg
          aria-hidden
          className="pointer-events-none absolute inset-0"
          width={BOARD_WIDTH}
          height={BOARD_HEIGHT}
        >
          {projected.edges.map((edge) => {
            const source = positions.get(edge.sourceId);
            const target = positions.get(edge.targetId);
            if (!source || !target) return null;
            return (
              <line
                key={edge.id}
                data-testid="board-edge"
                x1={source.x + NODE_WIDTH / 2}
                y1={source.y + NODE_HEIGHT / 2}
                x2={target.x + NODE_WIDTH / 2}
                y2={target.y + NODE_HEIGHT / 2}
                className={
                  edge.surfaceType === "co_mention"
                    ? "stroke-emerald-500/30"
                    : edge.surfaceType === "wiki_link"
                      ? "stroke-blue-500/55"
                      : edge.surfaceType === "source_membership"
                        ? "stroke-amber-500/55"
                        : "stroke-foreground/20"
                }
                strokeDasharray={
                  edge.surfaceType === "co_mention"
                    ? "5 7"
                    : edge.surfaceType === "source_membership"
                      ? "7 4"
                      : undefined
                }
                strokeWidth={edge.surfaceType === "co_mention" ? 1 : 2}
              />
            );
          })}
        </svg>
        {projected.nodes.map((node) => {
          const pos = positions.get(node.id) ?? { x: 0, y: 0 };
          const noteOnly = projected.noteNodeIds.has(node.id);
          return (
            <button
              key={node.id}
              type="button"
              data-testid={`board-node-${node.id}`}
              data-role="board-node"
              className="absolute flex cursor-grab touch-none items-center gap-3 rounded-md border border-border bg-background px-3 py-2 text-left shadow-sm active:cursor-grabbing data-[note=true]:border-blue-500/35 data-[note=true]:bg-blue-500/5"
              data-root={node.id === (data.rootId ?? root ?? null)}
              data-note={noteOnly}
              style={{ left: pos.x, top: pos.y, width: NODE_WIDTH, minHeight: NODE_HEIGHT }}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture?.(event.pointerId);
                dragRef.current = {
                  id: node.id,
                  startX: event.clientX,
                  startY: event.clientY,
                  origin: pos,
                };
              }}
            >
              <span className={noteOnly ? "size-3 shrink-0 rounded-full bg-blue-500/80" : "size-3 shrink-0 rounded-full bg-foreground/70"} />
              <span className="min-w-0 truncate text-sm font-medium">{node.name}</span>
            </button>
          );
        })}
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
