"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import cytoscape from "cytoscape";
import dagre from "cytoscape-dagre";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { useProjectGraph } from "../useProjectGraph";
import { evidenceBundleById, type GroundedEdge } from "../grounded-types";
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

export default function MindmapView({ projectId, root }: Props) {
  const t = useTranslations("graph");
  const router = useRouter();
  const params = useSearchParams();
  const { data, isLoading, error } = useProjectGraph(projectId, {
    view: "mindmap",
    root,
  });
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

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
          id: e.id ?? `${e.sourceId}-${e.targetId}`,
          source: e.sourceId,
          target: e.targetId,
          type: "edge",
          supportStatus: e.support?.status,
        },
      })),
    ];
  }, [data]);

  const selectedEdge = useMemo(
    () => data?.edges.find((edge) => edge.id === selectedEdgeId) as
      | GroundedEdge
      | undefined,
    [data?.edges, selectedEdgeId],
  );
  const bundlesById = useMemo(
    () => evidenceBundleById(data?.evidenceBundles),
    [data?.evidenceBundles],
  );

  const cyRef = useRef<cytoscape.Core | null>(null);

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
        handlerRef.current(node.id());
      } else if (node?.isEdge?.()) {
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
          spacingFactor: 1.2,
          fit: true,
          padding: 30,
        } as cytoscape.LayoutOptions
      }
      stylesheet={
        [
          {
            selector: "node",
            style: { label: "data(label)", "font-size": 12 },
          },
          {
            selector: "node[?isRoot]",
            style: { "border-width": 2, "background-color": "#666" },
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
            style: { "line-color": "hsl(var(--primary))", "target-arrow-color": "hsl(var(--primary))" },
          },
          {
            selector: 'edge[supportStatus = "weak"], edge[supportStatus = "missing"]',
            style: { "line-style": "dotted", opacity: 0.65 },
          },
          {
            selector: 'edge[supportStatus = "disputed"]',
            style: { "line-color": "hsl(var(--destructive))", "target-arrow-color": "hsl(var(--destructive))" },
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
    </div>
  );
}
