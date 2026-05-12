"use client";
import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import { urls } from "@/lib/urls";
import { useProjectGraph } from "../useProjectGraph";
import { evidenceBundleById, type GroundedEdge } from "../grounded-types";
import { ConceptCard } from "./ConceptCard";

interface Props {
  projectId: string;
}

const CARD_WIDTH = 260;
const CARD_HEIGHT = 178;
const CARD_GAP_X = 72;
const CARD_GAP_Y = 58;
const CARD_PADDING = 24;

function cardGraphLayout(nodeIds: string[]) {
  const columns = Math.max(1, Math.ceil(Math.sqrt(nodeIds.length)));
  const positions = new Map<string, { x: number; y: number }>();
  nodeIds.forEach((id, index) => {
    const row = Math.floor(index / columns);
    const col = index % columns;
    positions.set(id, {
      x: CARD_PADDING + col * (CARD_WIDTH + CARD_GAP_X),
      y: CARD_PADDING + row * (CARD_HEIGHT + CARD_GAP_Y),
    });
  });
  const rows = Math.max(1, Math.ceil(nodeIds.length / columns));
  return {
    positions,
    width: CARD_PADDING * 2 + columns * CARD_WIDTH + (columns - 1) * CARD_GAP_X,
    height: CARD_PADDING * 2 + rows * CARD_HEIGHT + (rows - 1) * CARD_GAP_Y,
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

  const cardsByConceptId = useMemo(() => {
    return new Map((data?.cards ?? []).map((card) => [card.conceptId, card]));
  }, [data]);
  const bundlesById = useMemo(
    () => evidenceBundleById(data?.evidenceBundles),
    [data?.evidenceBundles],
  );
  const layout = useMemo(
    () => cardGraphLayout((data?.nodes ?? []).map((node) => node.id)),
    [data?.nodes],
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

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{t("cards.title")}</h2>
          <p className="text-xs text-muted-foreground">
            {t("cards.description", { count: data.nodes.length })}
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
            {data.edges.map((edge) => {
              const path = edgePath(edge, layout.positions);
              if (!path) return null;
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
                        ? "stroke-emerald-500/25"
                        : "stroke-foreground/25"
                    }
                    strokeDasharray={edge.surfaceType === "co_mention" ? "4 6" : undefined}
                    strokeWidth={
                      edge.surfaceType === "co_mention"
                        ? Math.max(0.75, Math.min(1.5, (edge.weight ?? 1) * 1.5))
                        : Math.max(1, Math.min(3, (edge.weight ?? 1) * 2))
                    }
                    markerEnd={
                      edge.surfaceType === "co_mention" ? undefined : "url(#concept-card-arrow)"
                    }
                  />
                  {edge.surfaceType !== "co_mention" ? (
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
        {data.nodes.map((node) => {
          const card = cardsByConceptId.get(node.id);
          const bundle = card?.evidenceBundleId
            ? bundlesById.get(card.evidenceBundleId)
            : undefined;
          const position = layout.positions.get(node.id) ?? { x: 0, y: 0 };
          return (
            <div
              key={node.id}
              className="absolute"
              style={{
                left: position.x,
                top: position.y,
                width: CARD_WIDTH,
                minHeight: CARD_HEIGHT,
              }}
            >
              <ConceptCard
                node={node}
                card={card}
                bundle={bundle}
                onAsk={() => {
                  if (!wsSlug) return;
                  router.push(
                    `${urls.workspace.projectLearnSocratic(locale, wsSlug, projectId)}?concept=${encodeURIComponent(card?.title ?? node.name)}`,
                  );
                }}
                onQuiz={() => {
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
