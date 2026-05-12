"use client";
import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import { urls } from "@/lib/urls";
import { useProjectGraph } from "../useProjectGraph";
import { evidenceBundleById, type GroundedEdge } from "../grounded-types";
import { ConceptCard } from "./ConceptCard";
import { projectNoteLinksToGraph } from "./note-link-projection";

interface Props {
  projectId: string;
}

const CARD_WIDTH = 260;
const CARD_HEIGHT = 178;
const CARD_PADDING = 24;

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
  const positions = new Map<string, { x: number; y: number }>();
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

  const focusX = CARD_PADDING + 360;
  const focusY = CARD_PADDING + 240;
  positions.set(resolvedFocusId, { x: focusX, y: focusY });

  const ringRadiusX = 390;
  const ringRadiusY = 260;
  neighborIds.forEach((id, index) => {
    const angle = -Math.PI / 2 + (index / Math.max(1, neighborIds.length)) * Math.PI * 2;
    positions.set(id, {
      x: focusX + Math.cos(angle) * ringRadiusX,
      y: focusY + Math.sin(angle) * ringRadiusY,
    });
  });

  const secondaryIds = nodeIds.filter((id) => id !== resolvedFocusId && !positions.has(id));
  const secondaryColumns = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(secondaryIds.length))));
  secondaryIds.forEach((id, index) => {
    const row = Math.floor(index / secondaryColumns);
    const col = index % secondaryColumns;
    positions.set(id, {
      x: CARD_PADDING + col * (CARD_WIDTH + 36),
      y: focusY + ringRadiusY + 170 + row * (CARD_HEIGHT + 36),
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
  const x1 = source.x + CARD_WIDTH / 2;
  const y1 = source.y + CARD_HEIGHT / 2;
  const x2 = target.x + CARD_WIDTH / 2;
  const y2 = target.y + CARD_HEIGHT / 2;
  return {
    x1,
    y1,
    x2,
    y2,
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

  const cardsByConceptId = useMemo(() => {
    return new Map((data?.cards ?? []).map((card) => [card.conceptId, card]));
  }, [data]);
  const bundlesById = useMemo(
    () => evidenceBundleById(data?.evidenceBundles),
    [data?.evidenceBundles],
  );
  const projected = useMemo(
    () =>
      projectNoteLinksToGraph(
        data?.nodes ?? [],
        data?.edges ?? [],
        data?.noteLinks,
      ),
    [data?.edges, data?.nodes, data?.noteLinks],
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
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{t("cards.title")}</h2>
          <p className="text-xs text-muted-foreground">
            {t("cards.description", { count: projected.nodes.length })}
          </p>
        </div>
        {data.truncated ? (
          <span className="rounded border border-border px-2 py-1 text-xs text-muted-foreground">
            {t("cards.truncated", {
              shown: data.nodes.length,
              total: data.totalConcepts,
            })}
          </span>
        ) : null}
      </div>
      <div className="overflow-auto rounded-lg border border-border bg-muted/20">
        <div
          data-testid="concept-card-graph"
          className="relative"
          style={{
            width: layout.width,
            height: layout.height,
            minWidth: "100%",
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
                  <line
                    data-testid="concept-card-edge"
                    x1={path.x1}
                    y1={path.y1}
                    x2={path.x2}
                    y2={path.y2}
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
  );
}
