"use client";
import { type PointerEvent, useCallback, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import { LocateFixed, Minus, Plus, RotateCcw } from "lucide-react";
import { urls } from "@/lib/urls";
import { useProjectGraph } from "../useProjectGraph";
import { evidenceBundleById, type GroundedEdge } from "../grounded-types";
import { ConceptCard } from "./ConceptCard";
import { projectNoteLinksToGraph } from "./note-link-projection";
import { simplifyGraphForDefaultView } from "./display-graph";

interface Props {
  projectId: string;
}

const CARD_WIDTH = 260;
const CARD_HEIGHT = 236;
const CARD_PADDING = 24;
const CARD_COLUMN_GAP = 150;
const CARD_ROW_GAP = 48;

type CardPosition = { x: number; y: number };

function cardGraphLayout(
  nodes: Array<{ id: string; degree?: number }>,
  edges: GroundedEdge[],
  focusedId: string | null,
) {
  const nodeIds = nodes.map((node) => node.id);
  const incidentCounts = new Map<string, number>();
  for (const edge of edges) {
    incidentCounts.set(edge.sourceId, (incidentCounts.get(edge.sourceId) ?? 0) + 1);
    incidentCounts.set(edge.targetId, (incidentCounts.get(edge.targetId) ?? 0) + 1);
  }
  const defaultFocusId = [...nodes].sort((a, b) => {
    const edgeDelta = (incidentCounts.get(b.id) ?? 0) - (incidentCounts.get(a.id) ?? 0);
    if (edgeDelta !== 0) return edgeDelta;
    return (b.degree ?? 0) - (a.degree ?? 0);
  })[0]?.id;
  const resolvedFocusId = focusedId && nodeIds.includes(focusedId) ? focusedId : defaultFocusId;
  const positions = new Map<string, CardPosition>();
  if (!resolvedFocusId) {
    return { positions, width: 800, height: 420, focusId: null, activeEdgeIds: new Set<string>() };
  }

  const activeEdgeIds = new Set<string>();
  const neighborIds: string[] = [];
  for (const edge of edges) {
    if (edge.sourceId === resolvedFocusId || edge.targetId === resolvedFocusId) {
      activeEdgeIds.add(edge.id);
      const otherId = edge.sourceId === resolvedFocusId ? edge.targetId : edge.sourceId;
      if (nodeIds.includes(otherId) && !neighborIds.includes(otherId)) {
        neighborIds.push(otherId);
      }
    }
  }

  const neighborStackHeight = Math.max(
    CARD_HEIGHT,
    neighborIds.length * CARD_HEIGHT + Math.max(0, neighborIds.length - 1) * CARD_ROW_GAP,
  );
  const focusX = CARD_PADDING + 56;
  const focusY = CARD_PADDING + Math.max(0, (neighborStackHeight - CARD_HEIGHT) / 2);
  positions.set(resolvedFocusId, { x: focusX, y: focusY });

  neighborIds.forEach((id, index) => {
    positions.set(id, {
      x: focusX + CARD_WIDTH + CARD_COLUMN_GAP,
      y: CARD_PADDING + index * (CARD_HEIGHT + CARD_ROW_GAP),
    });
  });

  const secondaryIds = nodeIds.filter((id) => id !== resolvedFocusId && !positions.has(id));
  const secondaryColumns = Math.max(1, Math.min(2, Math.ceil(secondaryIds.length / 5)));
  secondaryIds.forEach((id, index) => {
    const row = index % 5;
    const col = Math.floor(index / 5);
    positions.set(id, {
      x: focusX + (col + 2) * (CARD_WIDTH + CARD_COLUMN_GAP),
      y: CARD_PADDING + row * (CARD_HEIGHT + CARD_ROW_GAP),
    });
  });

  const xs = [...positions.values()].map((p) => p.x);
  const ys = [...positions.values()].map((p) => p.y);
  const minX = Math.min(...xs, CARD_PADDING);
  const minY = Math.min(...ys, CARD_PADDING);
  if (minX < CARD_PADDING || minY < CARD_PADDING) {
    for (const pos of positions.values()) {
      pos.x += CARD_PADDING - minX;
      pos.y += CARD_PADDING - minY;
    }
  }
  const maxX = Math.max(...[...positions.values()].map((p) => p.x + CARD_WIDTH));
  const maxY = Math.max(...[...positions.values()].map((p) => p.y + CARD_HEIGHT));
  return {
    positions,
    width: Math.max(980, maxX + CARD_PADDING),
    height: Math.max(620, maxY + CARD_PADDING),
    focusId: resolvedFocusId,
    activeEdgeIds,
  };
}

function edgePath(
  edge: GroundedEdge,
  positions: Map<string, { x: number; y: number }>,
) {
  const source = positions.get(edge.sourceId);
  const target = positions.get(edge.targetId);
  if (!source || !target) return null;
  const x1 = source.x + CARD_WIDTH;
  const y1 = source.y + CARD_HEIGHT / 2;
  const x2 = target.x;
  const y2 = target.y + CARD_HEIGHT / 2;
  const bend = Math.max(72, Math.abs(x2 - x1) * 0.45);
  return {
    x1,
    y1,
    x2,
    y2,
    d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
    labelX: (x1 + x2) / 2,
    labelY: (y1 + y2) / 2,
  };
}

/**
 * `?view=cards` — connected concept cards. This keeps cards readable while
 * preserving the ontology edges that make the view useful as a knowledge map.
 */
export default function CardsView({ projectId }: Props) {
  const t = useTranslations("graph");
  const locale = useLocale();
  const router = useRouter();
  const params = useParams<{ wsSlug?: string }>();
  const wsSlug = params?.wsSlug;
  const { data, isLoading, error } = useProjectGraph(projectId, {
    view: "cards",
  });
  const [focusedConceptId, setFocusedConceptId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.72);
  const [isPanning, setIsPanning] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const panRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);

  const displayData = useMemo(
    () =>
      data
        ? simplifyGraphForDefaultView(data, {
            maxNodes: 14,
            maxEdges: 28,
          })
        : null,
    [data],
  );

  const cardsByConceptId = useMemo(() => {
    return new Map((displayData?.cards ?? []).map((card) => [card.conceptId, card]));
  }, [displayData?.cards]);
  const bundlesById = useMemo(
    () => evidenceBundleById(displayData?.evidenceBundles),
    [displayData?.evidenceBundles],
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
  const layout = useMemo(
    () =>
      cardGraphLayout(
        projected.nodes,
        projected.edges,
        focusedConceptId,
      ),
    [focusedConceptId, projected.edges, projected.nodes],
  );

  const clampZoom = useCallback((value: number) => {
    return Math.max(0.42, Math.min(1.55, value));
  }, []);
  const fitCards = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const availableWidth = Math.max(320, viewport.clientWidth - 48);
    const availableHeight = Math.max(320, viewport.clientHeight - 48);
    setZoom(
      clampZoom(
        Math.min(availableWidth / layout.width, availableHeight / layout.height),
      ),
    );
  }, [clampZoom, layout.height, layout.width]);

  const startPan = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("[data-card-node='true'],button,a")) return;
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

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div
        ref={viewportRef}
        data-testid="concept-card-viewport"
        className={`relative min-h-0 flex-1 overflow-auto bg-background ${
          isPanning ? "cursor-grabbing select-none" : "cursor-grab"
        }`}
        onPointerDown={startPan}
        onPointerMove={movePan}
        onPointerUp={stopPan}
        onPointerCancel={stopPan}
      >
        <ViewZoomControls
          onFit={fitCards}
          onZoomIn={() => setZoom((value) => clampZoom(value * 1.16))}
          onZoomOut={() => setZoom((value) => clampZoom(value / 1.16))}
          onReset={() => setZoom(0.72)}
        />
        <div
          data-testid="concept-card-graph"
          className="relative"
          style={{
            width: layout.width * zoom,
            height: layout.height * zoom,
            minWidth: "100%",
          }}
        >
        <div
          className="relative origin-top-left"
          style={{
            width: layout.width,
            height: layout.height,
            transform: `scale(${zoom})`,
          }}
        >
          <svg
            aria-hidden
            className="pointer-events-none absolute inset-0"
            width={layout.width}
            height={layout.height}
          >
            <defs>
              <marker
                id="concept-card-arrow"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" className="fill-foreground/40" />
              </marker>
            </defs>
            {projected.edges.map((edge) => {
              const path = edgePath(edge, layout.positions);
              if (!path) return null;
              const active = layout.activeEdgeIds.has(edge.id);
              return (
                <g key={edge.id ?? `${edge.sourceId}-${edge.targetId}`}>
                  <path
                    data-testid="concept-card-edge"
                    d={path.d}
                    fill="none"
                    className={
                      edge.surfaceType === "co_mention"
                        ? active
                          ? "stroke-emerald-500/50"
                          : "stroke-emerald-500/15"
                        : edge.surfaceType === "wiki_link"
                          ? active
                            ? "stroke-blue-500/65"
                            : "stroke-blue-500/20"
                        : edge.surfaceType === "source_membership"
                          ? active
                            ? "stroke-amber-500/65"
                            : "stroke-amber-500/20"
                        : active
                          ? "stroke-foreground/45"
                          : "stroke-foreground/12"
                    }
                    strokeDasharray={
                      edge.surfaceType === "co_mention"
                        ? "4 6"
                        : edge.surfaceType === "source_membership"
                          ? "7 4"
                          : undefined
                    }
                    opacity={active ? 1 : 0.55}
                    strokeWidth={
                      edge.surfaceType === "co_mention"
                        ? Math.max(0.75, Math.min(1.5, (edge.weight ?? 1) * 1.5))
                        : edge.surfaceType === "source_membership"
                          ? Math.max(1, Math.min(2.5, (edge.weight ?? 1) * 2))
                        : Math.max(1, Math.min(3, (edge.weight ?? 1) * 2))
                    }
                    markerEnd={
                      edge.surfaceType === "co_mention" ? undefined : "url(#concept-card-arrow)"
                    }
                  />
                  {active && edge.surfaceType !== "co_mention" ? (
                    <text
                      x={path.labelX}
                      y={path.labelY - 6}
                      textAnchor="middle"
                      className="fill-muted-foreground text-[10px] font-medium"
                      style={{
                        paintOrder: "stroke",
                        stroke: "var(--theme-bg)",
                        strokeLinejoin: "round",
                        strokeWidth: 4,
                      }}
                    >
                      {edge.relationType}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
        {projected.nodes.map((node) => {
          const card = cardsByConceptId.get(node.id);
          const bundle = card?.evidenceBundleId
            ? bundlesById.get(card.evidenceBundleId)
            : undefined;
          const position = layout.positions.get(node.id) ?? { x: 0, y: 0 };
          const noteOnly = projected.noteNodeIds.has(node.id);
          return (
            <div
              key={node.id}
              data-card-node="true"
              data-testid={`concept-card-node-${node.id}`}
              className="absolute rounded-lg transition data-[active=true]:shadow-lg data-[active=true]:ring-2 data-[active=true]:ring-foreground/60"
              style={{
                left: position.x,
                top: position.y,
                width: CARD_WIDTH,
                minHeight: CARD_HEIGHT,
              }}
              data-active={node.id === layout.focusId}
              onClickCapture={() => setFocusedConceptId(node.id)}
            >
              <ConceptCard
                node={node}
                card={card}
                bundle={bundle}
                onAsk={noteOnly ? undefined : () => {
                  if (!wsSlug) return;
                  router.push(
                    `${urls.workspace.projectLearnSocratic(locale, wsSlug, projectId)}?concept=${encodeURIComponent(card?.title ?? node.name)}`,
                  );
                }}
                onQuiz={noteOnly ? undefined : () => {
                  if (!wsSlug) return;
                  router.push(urls.workspace.projectLearnFlashcards(locale, wsSlug, projectId));
                }}
              />
            </div>
          );
        })}
        </div>
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
