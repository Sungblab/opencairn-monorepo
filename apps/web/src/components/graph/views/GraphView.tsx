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
  getGraphLabelFontSize,
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
  async () => {
    const { default: ForceGraphComponent } = await import("react-force-graph-2d");
    const ForwardedForceGraph = React.forwardRef<
      ForceGraphHandle,
      Omit<ForceGraph2DProps, "ref">
    >((props, ref) => {
      const Component = ForceGraphComponent as unknown as React.ComponentType<
        Omit<ForceGraph2DProps, "ref"> & { ref?: React.Ref<ForceGraphHandle> }
      >;
      return <Component {...props} ref={ref} />;
    });
    ForwardedForceGraph.displayName = "ForwardedForceGraph2D";
    return ForwardedForceGraph;
  },
  { ssr: false },
) as unknown as (props: ForceGraph2DProps) => React.ReactElement;

type GraphCanvasPalette = {
  background: string;
  foreground: string;
  foregroundMuted: string;
  primary: string;
  destructive: string;
  border: string;
  fadedNode: string;
  mutedNode: string;
  inactiveLink: string;
  activeLink: string;
  supportedLink: string;
  disputedLink: string;
  labelBackground: string;
  fadedLabel: string;
};

const DEFAULT_CANVAS_PALETTE: GraphCanvasPalette = {
  background: "#ffffff",
  foreground: "#171717",
  foregroundMuted: "#737373",
  primary: "#171717",
  destructive: "#dc2626",
  border: "#e5e5e5",
  fadedNode: "rgba(115, 115, 115, 0.32)",
  mutedNode: "rgba(115, 115, 115, 0.82)",
  inactiveLink: "rgba(115, 115, 115, 0.18)",
  activeLink: "rgba(115, 115, 115, 0.48)",
  supportedLink: "rgba(23, 23, 23, 0.72)",
  disputedLink: "rgba(220, 38, 38, 0.72)",
  labelBackground: "rgba(255, 255, 255, 0.88)",
  fadedLabel: "rgba(115, 115, 115, 0.72)",
};

function resolveThemeColor(
  styles: CSSStyleDeclaration,
  name: string,
  fallback: string,
) {
  return styles.getPropertyValue(name).trim() || fallback;
}

function rgbaFromHex(hex: string, alpha: number, fallback: string) {
  const value = hex.trim();
  const match = /^#?([0-9a-f]{6})$/i.exec(value);
  if (!match) return fallback;
  const int = Number.parseInt(match[1], 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function resolveCanvasPalette(el: HTMLElement | null): GraphCanvasPalette {
  if (typeof window === "undefined") return DEFAULT_CANVAS_PALETTE;
  const styles = window.getComputedStyle(el ?? document.documentElement);
  const background = resolveThemeColor(
    styles,
    "--theme-bg",
    DEFAULT_CANVAS_PALETTE.background,
  );
  const foreground = resolveThemeColor(
    styles,
    "--theme-fg",
    DEFAULT_CANVAS_PALETTE.foreground,
  );
  const foregroundMuted = resolveThemeColor(
    styles,
    "--theme-fg-muted",
    DEFAULT_CANVAS_PALETTE.foregroundMuted,
  );
  const destructive = resolveThemeColor(
    styles,
    "--theme-danger",
    DEFAULT_CANVAS_PALETTE.destructive,
  );
  const border = resolveThemeColor(
    styles,
    "--theme-border",
    DEFAULT_CANVAS_PALETTE.border,
  );

  return {
    background,
    foreground,
    foregroundMuted,
    primary: foreground,
    destructive,
    border,
    fadedNode: rgbaFromHex(foregroundMuted, 0.32, DEFAULT_CANVAS_PALETTE.fadedNode),
    mutedNode: rgbaFromHex(foregroundMuted, 0.82, DEFAULT_CANVAS_PALETTE.mutedNode),
    inactiveLink: rgbaFromHex(border, 0.36, DEFAULT_CANVAS_PALETTE.inactiveLink),
    activeLink: rgbaFromHex(foregroundMuted, 0.58, DEFAULT_CANVAS_PALETTE.activeLink),
    supportedLink: rgbaFromHex(foreground, 0.72, DEFAULT_CANVAS_PALETTE.supportedLink),
    disputedLink: rgbaFromHex(destructive, 0.72, DEFAULT_CANVAS_PALETTE.disputedLink),
    labelBackground: rgbaFromHex(background, 0.88, DEFAULT_CANVAS_PALETTE.labelBackground),
    fadedLabel: rgbaFromHex(foregroundMuted, 0.72, DEFAULT_CANVAS_PALETTE.fadedLabel),
  };
}

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
  const canvasPaletteRef = useRef<GraphCanvasPalette>(DEFAULT_CANVAS_PALETTE);
  const [size, setSize] = useState({ width: 900, height: 640 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      canvasPaletteRef.current = resolveCanvasPalette(el);
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
    const themeObserver = new MutationObserver(update);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });
    return () => {
      observer.disconnect();
      themeObserver.disconnect();
    };
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
      const topNode = graphData?.topNodeIds.has(forceNode.id) ?? false;
      const important =
        selectedNodeId === forceNode.id ||
        hoveredNodeId === forceNode.id ||
        neighborhood.nodeIds.has(forceNode.id);
      const labelImportant = important || topNode;
      const faded = activeNodeId ? !important : false;
      const radius = Math.max(4, Math.min(14, forceNode.val ?? 5));
      const palette = canvasPaletteRef.current;
      const isNoteHub = forceNode.kind === "note";
      ctx.beginPath();
      ctx.arc(forceNode.x ?? 0, forceNode.y ?? 0, radius, 0, 2 * Math.PI, false);
      ctx.fillStyle = selectedNodeId === forceNode.id
        ? forceNode.color
        : hoveredNodeId === forceNode.id
          ? forceNode.color
          : faded
            ? palette.fadedNode
            : forceNode.color;
      ctx.fill();
      ctx.lineWidth = (forceNode.isHub ? 2 : 1.2) / Math.max(1, globalScale);
      ctx.strokeStyle = faded ? "rgba(255, 255, 255, 0.45)" : palette.background;
      ctx.stroke();
      if (important || forceNode.isHub) {
        ctx.beginPath();
        ctx.arc(
          forceNode.x ?? 0,
          forceNode.y ?? 0,
          radius + (forceNode.isHub ? 5 : 3),
          0,
          2 * Math.PI,
          false,
        );
        ctx.fillStyle = `${forceNode.color}24`;
        ctx.fill();
      }
      if (isNoteHub) return;

      const label = getGraphLabel(forceNode, {
        zoom: globalScale,
        topNodeIds: graphData?.topNodeIds ?? new Set(),
        hoveredNodeId,
        selectedNodeId,
        neighborIds: neighborhood.nodeIds,
      });
      if (!label) return;
      const fontSize = getGraphLabelFontSize({
        zoom: globalScale,
        important: labelImportant,
      });
      if (fontSize === 0) return;
      ctx.font = `${labelImportant ? 600 : 500} ${fontSize}px Pretendard, Inter, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const textWidth = ctx.measureText(label).width;
      const x = forceNode.x ?? 0;
      const y = (forceNode.y ?? 0) + radius + 5;
      if (labelImportant) {
        ctx.fillStyle = palette.labelBackground;
        ctx.fillRect(x - textWidth / 2 - 4, y - 2, textWidth + 8, fontSize + 5);
      }
      ctx.fillStyle = faded ? palette.fadedLabel : palette.foreground;
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
            const palette = canvasPaletteRef.current;
            if (link.synthetic) return "rgba(115, 115, 115, 0.16)";
            if (link.surfaceType === "co_mention") {
              return linkActive(link)
                ? "rgba(34, 197, 94, 0.32)"
                : "rgba(34, 197, 94, 0.10)";
            }
            if (!linkActive(link)) return palette.inactiveLink;
            const status = link.supportStatus;
            if (status === "supported") return palette.supportedLink;
            if (status === "disputed") return palette.disputedLink;
            return palette.activeLink;
          }}
          linkWidth={(link) =>
            link.synthetic
              ? 0.45
              : link.surfaceType === "co_mention"
                ? linkActive(link)
                  ? Math.max(0.45, Math.min(1.35, link.weight))
                  : 0.25
              : linkActive(link)
              ? Math.max(0.8, Math.min(2.2, link.weight * 1.35))
              : 0.35
          }
          linkDirectionalArrowLength={() => 0}
          linkDirectionalArrowRelPos={1}
          linkLineDash={(link) => {
            if (link.surfaceType === "co_mention") return [3, 5];
            const status = link.supportStatus;
            if (status === "weak") return [4, 3];
            if (status === "missing") return [2, 4];
            return null;
          }}
          cooldownTicks={180}
          d3AlphaDecay={0.025}
          d3VelocityDecay={0.24}
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
            if (link.displayOnly) return;
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
