"use client";
import React, { useMemo, useState, useCallback, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import { FileText, HelpCircle, Sparkles } from "lucide-react";
import { urls } from "@/lib/urls";
import { useTabsStore } from "@/stores/tabs-store";
import { useProjectGraph } from "../useProjectGraph";
import { GraphFilters } from "../GraphFilters";
import { GraphSkeleton } from "../GraphSkeleton";
import { GraphError } from "../GraphError";
import { GraphEmpty } from "../GraphEmpty";
import { INITIAL_FILTERS, type FilterState } from "../graph-types";
import { evidenceBundleById, type GroundedEdge } from "../grounded-types";
import { EdgeEvidencePanel } from "./EdgeEvidencePanel";
import {
  buildForceGraphData,
  getGraphLabel,
  getGraphNeighborhood,
  type ForceGraphLink,
  type ForceGraphNode,
} from "./force-graph-model";

type ForceGraphNodeObject = ForceGraphNode & {
  x?: number;
  y?: number;
  fx?: number;
  fy?: number;
};

type ForceGraphLinkObject = ForceGraphLink & {
  source?: string | number | ForceGraphNodeObject;
  target?: string | number | ForceGraphNodeObject;
};

type ForceGraphHandle = {
  centerAt: (x?: number, y?: number, durationMs?: number) => unknown;
  zoom: {
    (): number;
    (scale: number, durationMs?: number): unknown;
  };
};

type ForceGraph2DProps = {
  ref?: React.Ref<ForceGraphHandle>;
  graphData: { nodes: ForceGraphNode[]; links: ForceGraphLink[] };
  width: number;
  height: number;
  backgroundColor: string;
  nodeId: string;
  nodeVal: string;
  nodeLabel: (node: ForceGraphNodeObject) => string;
  nodeCanvasObject: (
    node: ForceGraphNodeObject,
    ctx: CanvasRenderingContext2D,
    globalScale: number,
  ) => void;
  nodeCanvasObjectMode: () => "replace";
  linkSource: string;
  linkTarget: string;
  linkLabel: (link: ForceGraphLinkObject) => string;
  linkColor: (link: ForceGraphLinkObject) => string;
  linkWidth: (link: ForceGraphLinkObject) => number;
  linkDirectionalArrowLength: (link: ForceGraphLinkObject) => number;
  linkDirectionalArrowRelPos: number;
  linkLineDash: (link: ForceGraphLinkObject) => number[] | null;
  cooldownTicks: number;
  d3AlphaDecay: number;
  d3VelocityDecay: number;
  enableNodeDrag: boolean;
  onNodeHover: (node: ForceGraphNodeObject | null) => void;
  onNodeClick: (node: ForceGraphNodeObject, event?: MouseEvent) => void;
  onNodeDragEnd: (node: ForceGraphNodeObject) => void;
  onLinkClick: (link: ForceGraphLinkObject) => void;
  onBackgroundClick: () => void;
  showPointerCursor: boolean;
};

const ForceGraph2D = dynamic(
  () => import("react-force-graph-2d"),
  { ssr: false },
) as unknown as (props: ForceGraph2DProps) => React.ReactElement;

export default function GraphView({ projectId }: { projectId: string }) {
  const t = useTranslations("graph");
  const locale = useLocale();
  const router = useRouter();
  const params = useParams<{ wsSlug: string }>();
  const searchParams = useSearchParams();
  const wsSlug = params?.wsSlug;
  const { data, isLoading, error, expand } = useProjectGraph(projectId);
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const selectedEdgeParam = searchParams.get("edge");
  const consumedEdgeParam = useRef<string | null>(null);
  const graphRef = useRef<ForceGraphHandle>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 900, height: 640 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setSize({
        width: Math.max(320, Math.floor(rect.width || 900)),
        height: Math.max(320, Math.floor(rect.height || 640)),
      });
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const filteredData = useMemo(() => {
    if (!data) return null;
    const search = filters.search.trim().toLowerCase();
    const visibleNodes = search
      ? data.nodes.filter((node) => node.name.toLowerCase().includes(search))
      : data.nodes;
    const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
    const visibleEdges = data.edges.filter((edge) => {
      if (!visibleNodeIds.has(edge.sourceId) || !visibleNodeIds.has(edge.targetId)) {
        return false;
      }
      if (filters.relation && edge.relationType !== filters.relation) {
        return false;
      }
      return true;
    });
    return { ...data, nodes: visibleNodes, edges: visibleEdges };
  }, [data, filters]);

  const graphData = useMemo(
    () => (filteredData ? buildForceGraphData(filteredData) : null),
    [filteredData],
  );

  const visibleNodeCount = useMemo(
    () => filteredData?.nodes.length ?? 0,
    [filteredData],
  );

  const relations = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    for (const e of data.edges) set.add(e.relationType);
    return [...set].sort();
  }, [data]);

  const selectedEdge = useMemo(
    () => filteredData?.edges.find((edge) => edge.id === selectedEdgeId) as
      | GroundedEdge
      | undefined,
    [filteredData?.edges, selectedEdgeId],
  );
  const bundlesById = useMemo(
    () => evidenceBundleById(filteredData?.evidenceBundles),
    [filteredData?.evidenceBundles],
  );
  const selectedNode = useMemo(
    () => filteredData?.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [filteredData?.nodes, selectedNodeId],
  );
  const activeNodeId = hoveredNodeId ?? selectedNodeId;
  const neighborhood = useMemo(
    () => getGraphNeighborhood(filteredData?.edges ?? [], activeNodeId),
    [filteredData?.edges, activeNodeId],
  );

  const addOrReplacePreview = useTabsStore((s) => s.addOrReplacePreview);

  useEffect(() => {
    if (!selectedEdgeParam) {
      consumedEdgeParam.current = null;
      return;
    }
    if (selectedEdgeParam === consumedEdgeParam.current) return;
    if (filteredData?.edges.some((edge) => edge.id === selectedEdgeParam)) {
      setSelectedEdgeId(selectedEdgeParam);
      consumedEdgeParam.current = selectedEdgeParam;
    }
  }, [filteredData?.edges, selectedEdgeParam]);

  const onNodeDoubleClick = useCallback(
    (firstNoteId: string | null, conceptName: string) => {
      if (!firstNoteId) {
        toast.message(t("nodeMenu.openFirstNoteDisabled"));
        return;
      }
      addOrReplacePreview({
        id: crypto.randomUUID(),
        kind: "note",
        targetId: firstNoteId,
        mode: "plate",
        title: conceptName,
        pinned: false,
        preview: true,
        dirty: false,
        splitWith: null,
        splitSide: null,
        scrollY: 0,
      });
      router.push(urls.workspace.note(locale, wsSlug, firstNoteId));
    },
    [addOrReplacePreview, locale, router, wsSlug, t],
  );

  const centerNode = useCallback((node: ForceGraphNodeObject) => {
    const graph = graphRef.current;
    if (!graph || typeof node.x !== "number" || typeof node.y !== "number") {
      return;
    }
    graph.centerAt(node.x, node.y, 450);
    graph.zoom(Math.max(1.15, graph.zoom()), 450);
  }, []);

  const drawNode = useCallback(
    (
      node: ForceGraphNodeObject,
      ctx: CanvasRenderingContext2D,
      globalScale: number,
    ) => {
      const forceNode = node;
      const important =
        selectedNodeId === forceNode.id ||
        hoveredNodeId === forceNode.id ||
        neighborhood.nodeIds.has(forceNode.id);
      const faded = activeNodeId ? !important : false;
      const radius = Math.max(4, Math.min(12, forceNode.val ?? 5));
      ctx.beginPath();
      ctx.arc(forceNode.x ?? 0, forceNode.y ?? 0, radius, 0, 2 * Math.PI, false);
      ctx.fillStyle = selectedNodeId === forceNode.id
        ? "#111827"
        : hoveredNodeId === forceNode.id
          ? "#2563eb"
          : faded
            ? "rgba(156, 163, 175, 0.32)"
            : "rgba(107, 114, 128, 0.82)";
      ctx.fill();
      if (important) {
        ctx.lineWidth = 1.5 / globalScale;
        ctx.strokeStyle = selectedNodeId === forceNode.id ? "#111827" : "#2563eb";
        ctx.stroke();
      }

      const label = getGraphLabel(forceNode, {
        zoom: globalScale,
        topNodeIds: graphData?.topNodeIds ?? new Set(),
        hoveredNodeId,
        selectedNodeId,
        neighborIds: neighborhood.nodeIds,
      });
      if (!label) return;
      const fontSize = Math.max(9, 12 / Math.max(0.9, globalScale));
      ctx.font = `600 ${fontSize}px Pretendard, Inter, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const textWidth = ctx.measureText(label).width;
      const x = forceNode.x ?? 0;
      const y = (forceNode.y ?? 0) + radius + 4;
      ctx.fillStyle = "rgba(255, 255, 255, 0.88)";
      ctx.fillRect(x - textWidth / 2 - 4, y - 2, textWidth + 8, fontSize + 5);
      ctx.fillStyle = faded ? "rgba(55, 65, 81, 0.58)" : "#111827";
      ctx.fillText(label, x, y);
    },
    [
      activeNodeId,
      graphData?.topNodeIds,
      hoveredNodeId,
      neighborhood.nodeIds,
      selectedNodeId,
    ],
  );

  const linkActive = useCallback(
    (link: ForceGraphLinkObject) => {
      const edgeId = link.edgeId;
      return !activeNodeId || neighborhood.edgeIds.has(edgeId);
    },
    [activeNodeId, neighborhood.edgeIds],
  );

  if (isLoading) return <GraphSkeleton />;
  if (error) return <GraphError error={error as Error} />;
  if (!data || data.nodes.length === 0) return <GraphEmpty />;
  if (!filteredData || !graphData || filteredData.nodes.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <GraphFilters
          filters={filters}
          relations={relations}
          truncated={data.truncated}
          shown={0}
          total={data.totalConcepts}
          onChange={(next) => setFilters((f) => ({ ...f, ...next }))}
        />
        <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
          {t("views.noConcepts")}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <GraphFilters
        filters={filters}
        relations={relations}
        truncated={data.truncated}
        shown={visibleNodeCount}
        total={data.totalConcepts}
        onChange={(next) => setFilters((f) => ({ ...f, ...next }))}
      />
      <div ref={containerRef} className="relative min-h-0 flex-1 bg-background">
        <ForceGraph2D
          ref={graphRef}
          graphData={graphData}
          width={size.width}
          height={size.height}
          backgroundColor="rgba(255,255,255,0)"
          nodeId="id"
          nodeVal="val"
          nodeLabel={(node) => node.name}
          nodeCanvasObject={drawNode}
          nodeCanvasObjectMode={() => "replace"}
          linkSource="source"
          linkTarget="target"
          linkLabel={(link) => link.relationType}
          linkColor={(link) => {
            if (!linkActive(link)) return "rgba(156, 163, 175, 0.18)";
            const status = link.supportStatus;
            if (status === "supported") return "rgba(37, 99, 235, 0.72)";
            if (status === "disputed") return "rgba(220, 38, 38, 0.72)";
            return "rgba(107, 114, 128, 0.48)";
          }}
          linkWidth={(link) =>
            linkActive(link)
              ? Math.max(0.8, Math.min(3, link.weight * 2))
              : 0.45
          }
          linkDirectionalArrowLength={(link) =>
            linkActive(link) ? 4 : 0
          }
          linkDirectionalArrowRelPos={1}
          linkLineDash={(link) => {
            const status = link.supportStatus;
            if (status === "weak") return [4, 3];
            if (status === "missing") return [2, 4];
            return null;
          }}
          cooldownTicks={120}
          d3AlphaDecay={0.035}
          d3VelocityDecay={0.32}
          enableNodeDrag
          onNodeHover={(node) =>
            setHoveredNodeId(node ? node.id : null)
          }
          onNodeClick={(node, event) => {
            if (event?.detail && event.detail > 1) {
              onNodeDoubleClick(node.firstNoteId, node.name);
              return;
            }
            setSelectedNodeId(node.id);
            setSelectedEdgeId(null);
            centerNode(node);
          }}
          onNodeDragEnd={(node) => {
            node.fx = node.x;
            node.fy = node.y;
          }}
          onLinkClick={(link) => {
            setSelectedEdgeId(link.edgeId);
            setSelectedNodeId(null);
          }}
          onBackgroundClick={() => {
            setSelectedNodeId(null);
            setSelectedEdgeId(null);
          }}
          showPointerCursor
        />
        {selectedNode && (
          <ConceptInspector
            name={selectedNode.name}
            description={selectedNode.description}
            degree={selectedNode.degree ?? 0}
            noteCount={selectedNode.noteCount ?? 0}
            onClose={() => setSelectedNodeId(null)}
            onOpen={() =>
              onNodeDoubleClick(selectedNode.firstNoteId ?? null, selectedNode.name)
            }
            onExpand={() => {
              void expand(selectedNode.id, 1);
            }}
            onAsk={() => {
              if (!wsSlug) return;
              router.push(
                `${urls.workspace.projectLearnSocratic(locale, wsSlug, projectId)}?concept=${encodeURIComponent(selectedNode.name)}`,
              );
            }}
          />
        )}
        {selectedEdge && (
          <EdgeEvidencePanel
            edge={selectedEdge}
            bundle={
              selectedEdge.support?.evidenceBundleId
                ? bundlesById.get(selectedEdge.support.evidenceBundleId)
                : null
            }
            onClose={() => setSelectedEdgeId(null)}
          />
        )}
      </div>
    </div>
  );
}

function ConceptInspector({
  name,
  description,
  degree,
  noteCount,
  onClose,
  onOpen,
  onExpand,
  onAsk,
}: {
  name: string;
  description?: string;
  degree: number;
  noteCount: number;
  onClose: () => void;
  onOpen: () => void;
  onExpand: () => void;
  onAsk: () => void;
}) {
  const t = useTranslations("graph.inspector");
  return (
    <aside
      data-testid="graph-concept-inspector"
      className="absolute bottom-3 left-3 z-10 flex w-[360px] max-w-[calc(100%-1.5rem)] flex-col gap-3 rounded-lg border border-border bg-background p-3 shadow-lg"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{name}</h3>
          {description ? (
            <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {t("close")}
        </button>
      </div>
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span>{t("degree", { count: degree })}</span>
        <span>{t("noteCount", { count: noteCount })}</span>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex items-center justify-center gap-1 rounded border border-border px-2 py-1.5 text-xs hover:border-foreground"
        >
          <FileText aria-hidden className="size-3.5" />
          {t("open")}
        </button>
        <button
          type="button"
          onClick={onAsk}
          className="inline-flex items-center justify-center gap-1 rounded border border-border px-2 py-1.5 text-xs hover:border-foreground"
        >
          <HelpCircle aria-hidden className="size-3.5" />
          {t("ask")}
        </button>
        <button
          type="button"
          onClick={onExpand}
          className="inline-flex items-center justify-center gap-1 rounded border border-border px-2 py-1.5 text-xs hover:border-foreground"
        >
          <Sparkles aria-hidden className="size-3.5" />
          {t("expand")}
        </button>
      </div>
    </aside>
  );
}
