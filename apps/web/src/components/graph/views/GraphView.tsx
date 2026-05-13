"use client";
import React, { useMemo, useState, useCallback, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import {
  FileText,
  HelpCircle,
  LocateFixed,
  Minus,
  Plus,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { urls } from "@/lib/urls";
import { useTabsStore } from "@/stores/tabs-store";
import { useProjectGraph } from "../useProjectGraph";
import { GraphFilters } from "../GraphFilters";
import { GraphSkeleton } from "../GraphSkeleton";
import { GraphError } from "../GraphError";
import { GraphEmpty } from "../GraphEmpty";
import { INITIAL_FILTERS, type FilterState } from "../graph-types";
import {
  evidenceBundleById,
  type GroundedEdge,
  type GroundedGraphResponse,
} from "../grounded-types";
import { CoMentionEdgePanel } from "./CoMentionEdgePanel";
import { EdgeEvidencePanel } from "./EdgeEvidencePanel";
import {
  buildForceGraphData,
  getForceGraphNeighborhood,
  getGraphLabel,
  getGraphLabelFontSize,
  type ForceGraphLink,
  type ForceGraphNode,
} from "./force-graph-model";

type ForceGraphNodeObject = ForceGraphNode & {
  x?: number;
  y?: number;
  fx?: number;
  fy?: number;
};

type ForceGraphLinkObject = Omit<ForceGraphLink, "source" | "target"> & {
  source?: string | number | ForceGraphNodeObject;
  target?: string | number | ForceGraphNodeObject;
};

type ForceGraphHandle = {
  centerAt: (x?: number, y?: number, durationMs?: number) => unknown;
  zoom: {
    (): number;
    (scale: number, durationMs?: number): unknown;
  };
  zoomToFit?: (durationMs?: number, padding?: number) => unknown;
  d3Force: (forceName: string, force?: unknown) => unknown;
  d3ReheatSimulation: () => unknown;
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
  linkCurvature: (link: ForceGraphLinkObject) => number;
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

type GraphForceTuning = {
  chargeStrength: number;
  linkDistance: number;
  centerStrength: number;
  homeStrength: number;
  collisionPadding: number;
};

type TunableForce = {
  strength?: (value: number) => unknown;
  distance?: (value: number | ((link: ForceGraphLinkObject) => number)) => unknown;
};

type SimulationNode = ForceGraphNodeObject & {
  vx?: number;
  vy?: number;
  layoutX?: number;
  layoutY?: number;
};

type SimulationForce = ((alpha: number) => void) & {
  initialize?: (nodes: SimulationNode[]) => void;
};

const GRAPH_AUTO_FIT_PADDING = 56;
const GRAPH_AUTO_FIT_DELAY_MS = 80;
const GRAPH_AUTO_FIT_DURATION_MS = 500;
const GRAPH_CONTROL_ZOOM_DURATION_MS = 220;
const GRAPH_CONTROL_RESET_DURATION_MS = 350;

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

function matchesGraphSearch(value: string | null | undefined, search: string) {
  return (value ?? "").toLowerCase().includes(search);
}

function hasRenderableGraphData(data: GroundedGraphResponse): boolean {
  return data.nodes.length > 0 || (data.noteLinks?.length ?? 0) > 0;
}

export function filterGraphDataForView(
  data: GroundedGraphResponse,
  filters: FilterState,
): GroundedGraphResponse {
  const search = filters.search.trim().toLowerCase();
  const visibleNodes = search
    ? data.nodes.filter(
        (node) =>
          matchesGraphSearch(node.name, search) ||
          matchesGraphSearch(node.description, search),
      )
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
  const noteLinks =
    filters.relation && filters.relation !== "wiki-link"
      ? []
      : (data.noteLinks ?? []).filter((link) => {
          if (!search) return true;
          return (
            matchesGraphSearch(link.sourceTitle, search) ||
            matchesGraphSearch(link.targetTitle, search)
          );
        });
  return { ...data, nodes: visibleNodes, edges: visibleEdges, noteLinks };
}

export function graphForceTuningForSize({
  nodeCount,
  linkCount,
}: {
  nodeCount: number;
  linkCount: number;
}): GraphForceTuning {
  const density = nodeCount > 1 ? linkCount / nodeCount : 0;
  if (nodeCount <= 25) {
    return {
      chargeStrength: density > 1.6 ? -230 : -280,
      linkDistance: density > 1.6 ? 110 : 125,
      centerStrength: 0.055,
      homeStrength: 0.085,
      collisionPadding: 14,
    };
  }
  if (nodeCount <= 70) {
    return {
      chargeStrength: density > 1.8 ? -165 : -205,
      linkDistance: density > 1.8 ? 96 : 112,
      centerStrength: 0.045,
      homeStrength: 0.06,
      collisionPadding: 10,
    };
  }
  return {
    chargeStrength: -130,
    linkDistance: 92,
    centerStrength: 0.03,
    homeStrength: 0.035,
    collisionPadding: 7,
  };
}

function linkDistanceForRenderedEdge(
  tuning: GraphForceTuning,
  link: ForceGraphLinkObject,
): number {
  if (link.synthetic && link.relationType === "source-note") {
    return Math.max(58, tuning.linkDistance * 0.56);
  }
  if (link.surfaceType === "wiki_link") {
    return Math.max(86, tuning.linkDistance * 1.12);
  }
  if (link.surfaceType === "co_mention") {
    return Math.max(100, tuning.linkDistance * 1.28);
  }
  return tuning.linkDistance;
}

function collisionRadiusForNode(node: SimulationNode, padding: number): number {
  const nodeRadius = Math.max(5, Math.min(18, node.val ?? 6));
  const labelWidth = Math.min(54, Math.max(16, node.shortLabel.length * 2.5));
  const labelBoost = node.kind === "note" || node.isHub ? 10 : 4;
  return nodeRadius + labelWidth * 0.32 + labelBoost + padding;
}

function createGraphHomeForce(strength: number): SimulationForce {
  let nodes: SimulationNode[] = [];
  const force = ((alpha: number) => {
    const scaled = strength * alpha;
    for (const node of nodes) {
      if (
        typeof node.x !== "number" ||
        typeof node.y !== "number" ||
        typeof node.layoutX !== "number" ||
        typeof node.layoutY !== "number"
      ) {
        continue;
      }
      node.vx = (node.vx ?? 0) + (node.layoutX - node.x) * scaled;
      node.vy = (node.vy ?? 0) + (node.layoutY - node.y) * scaled;
    }
  }) as SimulationForce;
  force.initialize = (nextNodes) => {
    nodes = nextNodes;
  };
  return force;
}

function createGraphCollisionForce(padding: number): SimulationForce {
  let nodes: SimulationNode[] = [];
  const force = ((alpha: number) => {
    const scaled = Math.min(0.42, 0.18 + alpha * 0.45);
    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i];
      if (!a || typeof a.x !== "number" || typeof a.y !== "number") continue;
      const ar = collisionRadiusForNode(a, padding);
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j];
        if (!b || typeof b.x !== "number" || typeof b.y !== "number") continue;
        const br = collisionRadiusForNode(b, padding);
        const minDistance = ar + br;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distanceSq = dx * dx + dy * dy;
        if (distanceSq >= minDistance * minDistance) continue;
        if (distanceSq === 0) {
          const jitter = ((i + 1) * 31 + (j + 1) * 17) % 360;
          dx = Math.cos(jitter) * 0.01;
          dy = Math.sin(jitter) * 0.01;
          distanceSq = dx * dx + dy * dy;
        }
        const distance = Math.sqrt(distanceSq);
        const push = ((minDistance - distance) / distance) * scaled;
        const total = ar + br;
        const aShare = br / total;
        const bShare = ar / total;
        a.vx = (a.vx ?? 0) - dx * push * aShare;
        a.vy = (a.vy ?? 0) - dy * push * aShare;
        b.vx = (b.vx ?? 0) + dx * push * bShare;
        b.vy = (b.vy ?? 0) + dy * push * bShare;
      }
    }
  }) as SimulationForce;
  force.initialize = (nextNodes) => {
    nodes = nextNodes;
  };
  return force;
}

function tuneForceGraphLayout(
  graph: ForceGraphHandle | null,
  tuning: GraphForceTuning,
) {
  if (!graph) return;
  const charge = graph.d3Force("charge") as TunableForce | undefined;
  charge?.strength?.(tuning.chargeStrength);
  const link = graph.d3Force("link") as TunableForce | undefined;
  link?.distance?.((linkObj) => linkDistanceForRenderedEdge(tuning, linkObj));
  const center = graph.d3Force("center") as TunableForce | undefined;
  center?.strength?.(tuning.centerStrength);
  graph.d3Force("opencairn-home", createGraphHomeForce(tuning.homeStrength));
  graph.d3Force(
    "opencairn-collide",
    createGraphCollisionForce(tuning.collisionPadding),
  );
  graph.d3ReheatSimulation();
}

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
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  const searchQuery = filters.search.trim() || undefined;
  const { data, isLoading, error, expand } = useProjectGraph(projectId, {
    query: searchQuery,
  });
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedCoMentionEdgeId, setSelectedCoMentionEdgeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const selectedEdgeParam = searchParams.get("edge");
  const consumedEdgeParam = useRef<string | null>(null);
  const graphRef = useRef<ForceGraphHandle>(null);
  const graphTuningRef = useRef<GraphForceTuning | null>(null);
  const lastAutoFitKeyRef = useRef<string | null>(null);
  const pendingAutoFitKeyRef = useRef<string | null>(null);
  const autoFitTimerRef = useRef<number | null>(null);
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
    return filterGraphDataForView(data, filters);
  }, [data, filters]);

  const graphData = useMemo(
    () => (filteredData ? buildForceGraphData(filteredData) : null),
    [filteredData],
  );

  const graphAutoFitKey = useMemo(() => {
    if (!graphData) return null;
    const nodeKey = graphData.nodes.map((node) => node.id).join("|");
    const linkKey = graphData.links.map((link) => link.edgeId).join("|");
    return `${size.width}x${size.height}:${nodeKey}:${linkKey}`;
  }, [graphData, size.height, size.width]);

  const graphTuning = useMemo(
    () =>
      graphForceTuningForSize({
        nodeCount: graphData?.nodes.length ?? 0,
        linkCount: graphData?.links.length ?? 0,
      }),
    [graphData?.links.length, graphData?.nodes.length],
  );

  const scheduleGraphAutoFit = useCallback((key: string | null) => {
    if (!key || !graphRef.current?.zoomToFit) return;
    if (
      lastAutoFitKeyRef.current === key ||
      pendingAutoFitKeyRef.current === key
    ) {
      return;
    }
    if (autoFitTimerRef.current !== null) {
      window.clearTimeout(autoFitTimerRef.current);
    }
    pendingAutoFitKeyRef.current = key;
    autoFitTimerRef.current = window.setTimeout(() => {
      const graph = graphRef.current;
      if (pendingAutoFitKeyRef.current !== key || !graph?.zoomToFit) {
        pendingAutoFitKeyRef.current = null;
        autoFitTimerRef.current = null;
        return;
      }
      graph.zoomToFit(GRAPH_AUTO_FIT_DURATION_MS, GRAPH_AUTO_FIT_PADDING);
      lastAutoFitKeyRef.current = key;
      pendingAutoFitKeyRef.current = null;
      autoFitTimerRef.current = null;
    }, GRAPH_AUTO_FIT_DELAY_MS);
  }, []);

  const setGraphHandle = useCallback(
    (graph: ForceGraphHandle | null) => {
      graphRef.current = graph;
      if (graphTuningRef.current) {
        tuneForceGraphLayout(graph, graphTuningRef.current);
      }
      scheduleGraphAutoFit(graphAutoFitKey);
    },
    [graphAutoFitKey, scheduleGraphAutoFit],
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

  useEffect(() => {
    graphTuningRef.current = graphTuning;
    tuneForceGraphLayout(graphRef.current, graphTuning);
  }, [graphTuning]);

  useEffect(() => {
    scheduleGraphAutoFit(graphAutoFitKey);
  }, [graphAutoFitKey, scheduleGraphAutoFit]);

  useEffect(() => {
    return () => {
      if (autoFitTimerRef.current !== null) {
        window.clearTimeout(autoFitTimerRef.current);
      }
    };
  }, []);

  const selectedEdge = useMemo(
    () => filteredData?.edges.find((edge) => edge.id === selectedEdgeId) as
      | GroundedEdge
      | undefined,
    [filteredData?.edges, selectedEdgeId],
  );
  const selectedCoMentionEdge = useMemo(
    () => filteredData?.edges.find((edge) => edge.id === selectedCoMentionEdgeId) as
      | GroundedEdge
      | undefined,
    [filteredData?.edges, selectedCoMentionEdgeId],
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
    () => getForceGraphNeighborhood(graphData?.links ?? [], activeNodeId),
    [graphData?.links, activeNodeId],
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

  const openSourceNote = useCallback(
    (noteId: string, title: string) => {
      addOrReplacePreview({
        id: crypto.randomUUID(),
        kind: "note",
        targetId: noteId,
        mode: "plate",
        title,
        pinned: false,
        preview: true,
        dirty: false,
        splitWith: null,
        splitSide: null,
        scrollY: 0,
      });
      router.push(urls.workspace.note(locale, wsSlug, noteId));
    },
    [addOrReplacePreview, locale, router, wsSlug],
  );

  const centerNode = useCallback((node: ForceGraphNodeObject) => {
    const graph = graphRef.current;
    if (!graph || typeof node.x !== "number" || typeof node.y !== "number") {
      return;
    }
    graph.centerAt(node.x, node.y, 450);
    graph.zoom(Math.max(1.15, graph.zoom()), 450);
  }, []);

  const fitGraph = useCallback(() => {
    graphRef.current?.zoomToFit?.(
      GRAPH_AUTO_FIT_DURATION_MS,
      GRAPH_AUTO_FIT_PADDING,
    );
  }, []);

  const zoomGraphBy = useCallback((factor: number) => {
    const graph = graphRef.current;
    if (!graph) return;
    const nextZoom = Math.max(0.25, Math.min(4, graph.zoom() * factor));
    graph.zoom(nextZoom, GRAPH_CONTROL_ZOOM_DURATION_MS);
  }, []);

  const resetGraphView = useCallback(() => {
    const graph = graphRef.current;
    if (!graph) return;
    graph.centerAt(0, 0, GRAPH_CONTROL_RESET_DURATION_MS);
    graph.zoom(1, GRAPH_CONTROL_RESET_DURATION_MS);
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
      const label = getGraphLabel(forceNode, {
        zoom: globalScale,
        topNodeIds: graphData?.topNodeIds ?? new Set(),
        hoveredNodeId,
        selectedNodeId,
        neighborIds: neighborhood.nodeIds,
      });
      if (!label && !isNoteHub) return;
      const fontSize = getGraphLabelFontSize({
        zoom: globalScale,
        important: labelImportant || isNoteHub,
      });
      if (fontSize === 0) return;
      const visibleLabel = label || forceNode.shortLabel;
      ctx.font = `${labelImportant || isNoteHub ? 600 : 500} ${fontSize}px Pretendard, Inter, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const textWidth = ctx.measureText(visibleLabel).width;
      const x = forceNode.x ?? 0;
      const y = (forceNode.y ?? 0) + radius + 5;
      if (labelImportant || isNoteHub) {
        ctx.fillStyle = palette.labelBackground;
        ctx.fillRect(x - textWidth / 2 - 4, y - 2, textWidth + 8, fontSize + 5);
      }
      ctx.fillStyle = faded ? palette.fadedLabel : palette.foreground;
      ctx.fillText(visibleLabel, x, y);
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
      const sourceId =
        typeof link.source === "object" ? link.source.id : String(link.source);
      const targetId =
        typeof link.target === "object" ? link.target.id : String(link.target);
      if (activeNodeId && (sourceId === activeNodeId || targetId === activeNodeId)) {
        return true;
      }
      const edgeId = link.edgeId;
      return !activeNodeId || neighborhood.edgeIds.has(edgeId);
    },
    [activeNodeId, neighborhood.edgeIds],
  );

  if (isLoading) return <GraphSkeleton />;
  if (error) return <GraphError error={error as Error} />;
  if (!data) return <GraphEmpty />;
  if (!hasRenderableGraphData(data)) return <GraphEmpty />;
  if (!filteredData || !graphData || graphData.nodes.length === 0) {
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
          ref={setGraphHandle}
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
            if (link.synthetic && link.surfaceType === "wiki_link") {
              return linkActive(link)
                ? "rgba(59, 130, 246, 0.58)"
                : "rgba(59, 130, 246, 0.22)";
            }
            if (link.synthetic) return "rgba(115, 115, 115, 0.16)";
            if (link.surfaceType === "co_mention") {
              return linkActive(link)
                ? "rgba(34, 197, 94, 0.32)"
                : "rgba(34, 197, 94, 0.10)";
            }
            if (link.surfaceType === "wiki_link") {
              return linkActive(link)
                ? "rgba(59, 130, 246, 0.62)"
                : "rgba(59, 130, 246, 0.18)";
            }
            if (link.surfaceType === "source_membership") {
              return linkActive(link)
                ? "rgba(245, 158, 11, 0.66)"
                : "rgba(245, 158, 11, 0.20)";
            }
            if (!linkActive(link)) return palette.inactiveLink;
            const status = link.supportStatus;
            if (status === "supported") return palette.supportedLink;
            if (status === "disputed") return palette.disputedLink;
            return palette.activeLink;
          }}
          linkWidth={(link) =>
            link.synthetic && link.surfaceType === "wiki_link"
              ? linkActive(link)
                ? 1.6
                : 0.7
            : link.synthetic
              ? 0.45
              : link.surfaceType === "co_mention"
                ? linkActive(link)
                  ? Math.max(0.45, Math.min(1.35, link.weight))
                  : 0.25
              : link.surfaceType === "wiki_link"
                ? linkActive(link)
                  ? Math.max(1.1, Math.min(2.4, link.weight * 2.2))
                  : 0.4
              : link.surfaceType === "source_membership"
                ? linkActive(link)
                  ? Math.max(0.95, Math.min(2.1, link.weight * 1.9))
                  : 0.35
              : linkActive(link)
              ? Math.max(0.8, Math.min(2.2, link.weight * 1.35))
              : 0.35
          }
          linkCurvature={(link) => {
            if (link.synthetic && link.surfaceType === "wiki_link") return 0.22;
            if (link.surfaceType === "wiki_link") return 0.16;
            if (link.surfaceType === "co_mention") return 0.1;
            if (link.surfaceType === "source_membership") return 0.06;
            return 0.025;
          }}
          linkDirectionalArrowLength={() => 0}
          linkDirectionalArrowRelPos={1}
          linkLineDash={(link) => {
            if (link.surfaceType === "co_mention") return [3, 5];
            if (link.surfaceType === "source_membership") return [7, 4];
            const status = link.supportStatus;
            if (status === "weak") return [4, 3];
            if (status === "missing") return [2, 4];
            return null;
          }}
          cooldownTicks={260}
          d3AlphaDecay={0.018}
          d3VelocityDecay={0.32}
          enableNodeDrag
          onNodeHover={(node) =>
            setHoveredNodeId(node ? node.id : null)
          }
          onNodeClick={(node, event) => {
            if (event?.detail && event.detail > 1) {
              if (node.kind === "note" && node.firstNoteId) {
                openSourceNote(node.firstNoteId, node.name);
              } else {
                onNodeDoubleClick(node.firstNoteId, node.name);
              }
              return;
            }
            setSelectedNodeId(node.id);
            setSelectedEdgeId(null);
            setSelectedCoMentionEdgeId(null);
            centerNode(node);
          }}
          onNodeDragEnd={(node) => {
            node.fx = node.x;
            node.fy = node.y;
          }}
          onLinkClick={(link) => {
            if (link.displayOnly) {
              setSelectedCoMentionEdgeId(link.edgeId);
              setSelectedEdgeId(null);
              setSelectedNodeId(null);
              return;
            }
            setSelectedEdgeId(link.edgeId);
            setSelectedCoMentionEdgeId(null);
            setSelectedNodeId(null);
          }}
          onBackgroundClick={() => {
            setSelectedNodeId(null);
            setSelectedEdgeId(null);
            setSelectedCoMentionEdgeId(null);
          }}
          showPointerCursor
        />
        <GraphCanvasControls
          onFit={fitGraph}
          onZoomIn={() => zoomGraphBy(1.2)}
          onZoomOut={() => zoomGraphBy(1 / 1.2)}
          onReset={resetGraphView}
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
        {selectedCoMentionEdge && (
          <CoMentionEdgePanel
            edge={selectedCoMentionEdge}
            onClose={() => setSelectedCoMentionEdgeId(null)}
            onOpenNote={openSourceNote}
          />
        )}
      </div>
    </div>
  );
}

function GraphCanvasControls({
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
    <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-lg border border-border bg-background/90 p-1 shadow-sm backdrop-blur">
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
