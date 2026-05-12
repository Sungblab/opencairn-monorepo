"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import cytoscape from "cytoscape";
import dagre from "cytoscape-dagre";
import { useLocale, useTranslations } from "next-intl";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { urls } from "@/lib/urls";
import { useTabsStore } from "@/stores/tabs-store";
import { useProjectGraph } from "../useProjectGraph";
import { evidenceBundleById, type GroundedEdge } from "../grounded-types";
import { CoMentionEdgePanel } from "./CoMentionEdgePanel";
import { EdgeEvidencePanel } from "./EdgeEvidencePanel";

// react-cytoscapejs imports cytoscape at module top level. Disable SSR — the
// underlying renderer needs DOM/window. Same pattern as ProjectGraph + Phase 1
// GraphView (and enforced by scripts/plan-5-graph-guard.sh for ProjectGraph).
const CytoscapeComponent = dynamic(() => import("react-cytoscapejs"), {
  ssr: false,
});

// Register dagre layout once on the client. Repeated calls during HMR are
// harmless — cytoscape no-ops duplicate registrations. The window guard keeps
// the registration off the SSR path.
if (typeof window !== "undefined") {
  cytoscape.use(dagre);
}

interface Props {
  projectId: string;
  root?: string;
}

function edgeElementId(edge: GroundedEdge) {
  return edge.id ?? `${edge.sourceId}->${edge.targetId}:${edge.relationType}`;
}

export default function MindmapView({ projectId, root }: Props) {
  const t = useTranslations("graph");
  const locale = useLocale();
  const router = useRouter();
  const routeParams = useParams<{ wsSlug?: string }>();
  const params = useSearchParams();
  const wsSlug = routeParams?.wsSlug;
  const addOrReplacePreview = useTabsStore((s) => s.addOrReplacePreview);
  const { data, isLoading, error } = useProjectGraph(projectId, {
    view: "mindmap",
    root,
  });
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedCoMentionEdgeId, setSelectedCoMentionEdgeId] = useState<string | null>(null);
  const selectedEdgeParam = params.get("edge");
  const consumedEdgeParam = useRef<string | null>(null);

  const elements = useMemo(() => {
    if (!data) return [];
    return [
      ...data.nodes.map((n) => ({
        data: {
          id: n.id,
          label: n.name,
          type: "node",
          isRoot: n.id === data.rootId,
        },
      })),
      ...data.edges.map((e) => ({
        data: {
          id: edgeElementId(e),
          source: e.sourceId,
          target: e.targetId,
          type: "edge",
          supportStatus: e.support?.status,
          surfaceType: e.surfaceType ?? "semantic_relation",
          sourceNoteIds: e.sourceNoteIds ?? [],
        },
      })),
    ];
  }, [data]);

  const selectedEdge = useMemo(
    () => data?.edges.find((edge) => edgeElementId(edge) === selectedEdgeId) as
      | GroundedEdge
      | undefined,
    [data?.edges, selectedEdgeId],
  );
  const selectedCoMentionEdge = useMemo(
    () => data?.edges.find((edge) => edgeElementId(edge) === selectedCoMentionEdgeId) as
      | GroundedEdge
      | undefined,
    [data?.edges, selectedCoMentionEdgeId],
  );
  const bundlesById = useMemo(
    () => evidenceBundleById(data?.evidenceBundles),
    [data?.evidenceBundles],
  );

  const cyRef = useRef<cytoscape.Core | null>(null);

  useEffect(() => {
    if (!selectedEdgeParam) {
      consumedEdgeParam.current = null;
      return;
    }
    if (selectedEdgeParam === consumedEdgeParam.current) return;
    if (data?.edges.some((edge) => edgeElementId(edge) === selectedEdgeParam)) {
      setSelectedEdgeId(selectedEdgeParam);
      consumedEdgeParam.current = selectedEdgeParam;
    }
  }, [data?.edges, selectedEdgeParam]);

  // Latest tap handler. Closes over `params`, `router`, `data?.rootId` —
  // all of which can change while the cytoscape instance is mounted (e.g.
  // user clicks a child node → URL params change → re-render but cytoscape
  // instance stays). Without the ref-indirection, the listener bound in
  // the `cy` callback would freeze the *first* render's params/data and
  // never see updates. Same pattern as GraphView.tsx (gemini-code-assist
  // post-merge review follow-up — Plan 5 KG Phase 2).
  const onNodeTap = useCallback(
    (id: string) => {
      if (id === data?.rootId) return;
      const next = new URLSearchParams(params.toString());
      next.set("view", "mindmap");
      next.set("root", id);
      router.replace(`?${next.toString()}`, { scroll: false });
    },
    [data?.rootId, params, router],
  );

  const openSourceNote = useCallback(
    (noteId: string, title: string) => {
      if (!wsSlug) return;
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

  const handlerRef = useRef(onNodeTap);
  useEffect(() => {
    handlerRef.current = onNodeTap;
  }, [onNodeTap]);

  // Bind the cytoscape `tap` listener once per dataset. We re-bind when
  // `data` changes because react-cytoscapejs may rebuild the underlying
  // graph; pointing at `handlerRef.current` keeps the bound callback
  // current without re-binding on every render.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const onTap = (evt: cytoscape.EventObject) => {
      if (evt.target === cy) return;
      const node = evt.target;
      if (node?.isNode?.()) {
        setSelectedCoMentionEdgeId(null);
        handlerRef.current(node.id());
      } else if (node?.isEdge?.()) {
        if (node.data("surfaceType") === "co_mention") {
          setSelectedCoMentionEdgeId(node.id());
          setSelectedEdgeId(null);
          return;
        }
        setSelectedCoMentionEdgeId(null);
        setSelectedEdgeId(node.id());
      }
    };
    cy.on("tap", "node", onTap);
    cy.on("tap", "edge", onTap);
    return () => {
      cy.off("tap", "node", onTap);
      cy.off("tap", "edge", onTap);
    };
  }, [data]);

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
      <div
        data-testid="mindmap-needs-root"
        className="p-6 text-sm text-muted-foreground"
      >
        {t("views.needsRoot")}
      </div>
    );
  }

  return (
    <div className="relative h-full">
      <CytoscapeComponent
      elements={elements as cytoscape.ElementDefinition[]}
      layout={
        {
          name: "dagre",
          rankDir: "LR",
          spacingFactor: 1.75,
          nodeSep: 80,
          rankSep: 120,
          fit: true,
          padding: 30,
        } as cytoscape.LayoutOptions
      }
      stylesheet={
        [
          {
            selector: "node",
            style: {
              label: "data(label)",
              "font-size": 11,
              "font-weight": 600,
              "text-wrap": "wrap",
              "text-max-width": 150,
              color: "#171717",
              "background-color": "#a3a3a3",
              "text-background-color": "#ffffff",
              "text-background-opacity": 0.9,
              "text-background-padding": 3,
              "text-margin-y": -8,
            },
          },
          {
            selector: "node[?isRoot]",
            style: { "border-width": 2, "background-color": "#171717" },
          },
          {
            selector: "edge",
            style: {
              "curve-style": "bezier",
              "target-arrow-shape": "triangle",
              "target-arrow-color": "#888",
              "line-color": "#bbb",
            },
          },
          {
            selector: 'edge[supportStatus = "supported"]',
            style: { "line-color": "#171717", "target-arrow-color": "#171717" },
          },
          {
            selector: 'edge[supportStatus = "weak"]',
            style: { "line-style": "dashed", opacity: 0.65 },
          },
          {
            selector: 'edge[supportStatus = "missing"]',
            style: { "line-style": "dotted", opacity: 0.65 },
          },
          {
            selector: 'edge[supportStatus = "disputed"]',
            style: { "line-color": "#dc2626", "target-arrow-color": "#dc2626" },
          },
          {
            selector: 'edge[surfaceType = "co_mention"]',
            style: {
              "line-color": "#86efac",
              "target-arrow-shape": "none",
              "line-style": "dashed",
              opacity: 0.72,
            },
          },
          {
            selector: 'edge[surfaceType = "wiki_link"]',
            style: {
              "line-color": "#3b82f6",
              "target-arrow-color": "#3b82f6",
              width: 2,
              opacity: 0.82,
            },
          },
        ] as cytoscape.StylesheetJsonBlock[]
      }
      cy={(cy: cytoscape.Core) => {
        cyRef.current = cy;
      }}
      style={{ width: "100%", height: "100%" }}
      />
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
  );
}
