"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useProjectGraph } from "../useProjectGraph";
import type { GroundedEdge } from "../grounded-types";

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
  nodeIds: string[],
  edges: GroundedEdge[],
): Map<string, BoardPosition> {
  const positions = new Map<string, BoardPosition>();
  if (nodeIds.length === 0) return positions;

  const degree = new Map(nodeIds.map((id) => [id, 0]));
  for (const edge of edges) {
    degree.set(edge.sourceId, (degree.get(edge.sourceId) ?? 0) + 1);
    degree.set(edge.targetId, (degree.get(edge.targetId) ?? 0) + 1);
  }
  const [hubId] = [...nodeIds].sort(
    (a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0),
  );
  const hubX = BOARD_WIDTH / 2 - NODE_WIDTH / 2;
  const hubY = BOARD_HEIGHT / 2 - NODE_HEIGHT / 2;
  positions.set(hubId, { x: hubX, y: hubY });

  const neighborIds = new Set<string>();
  for (const edge of edges) {
    if (edge.sourceId === hubId) neighborIds.add(edge.targetId);
    if (edge.targetId === hubId) neighborIds.add(edge.sourceId);
  }
  const ring = [...neighborIds].filter((id) => nodeIds.includes(id));
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
  const initialPositions = useMemo(
    () =>
      boardLayout(
        (data?.nodes ?? []).map((node) => node.id),
        data?.edges ?? [],
      ),
    [data?.edges, data?.nodes],
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

  return (
    <div className="h-full overflow-auto bg-muted/20 p-4">
      <div
        data-testid="board-canvas"
        className="relative rounded-lg border border-border bg-background"
        style={{ width: BOARD_WIDTH, height: BOARD_HEIGHT }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag) return;
          const dx = event.clientX - drag.startX;
          const dy = event.clientY - drag.startY;
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
          {data.edges.map((edge) => {
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
                    : "stroke-foreground/20"
                }
                strokeDasharray={edge.surfaceType === "co_mention" ? "5 7" : undefined}
                strokeWidth={edge.surfaceType === "co_mention" ? 1 : 2}
              />
            );
          })}
        </svg>
        {data.nodes.map((node) => {
          const pos = positions.get(node.id) ?? { x: 0, y: 0 };
          return (
            <button
              key={node.id}
              type="button"
              data-testid="board-node"
              className="absolute flex cursor-grab touch-none items-center gap-3 rounded-md border border-border bg-background px-3 py-2 text-left shadow-sm active:cursor-grabbing"
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
              <span className="size-3 shrink-0 rounded-full bg-foreground/70" />
              <span className="min-w-0 truncate text-sm font-medium">{node.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
