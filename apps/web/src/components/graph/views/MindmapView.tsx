"use client";
import { useMemo } from "react";
import dynamic from "next/dynamic";
import cytoscape from "cytoscape";
import dagre from "cytoscape-dagre";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { useProjectGraph } from "../useProjectGraph";

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
          id: `${e.sourceId}-${e.targetId}`,
          source: e.sourceId,
          target: e.targetId,
          type: "edge",
        },
      })),
    ];
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
        ] as cytoscape.StylesheetJsonBlock[]
      }
      cy={(cy: cytoscape.Core) => {
        cy.removeAllListeners();
        cy.on("tap", "node", (evt) => {
          const id = evt.target.id();
          if (id === data.rootId) return;
          const next = new URLSearchParams(params.toString());
          next.set("view", "mindmap");
          next.set("root", id);
          router.replace(`?${next.toString()}`, { scroll: false });
        });
      }}
      style={{ width: "100%", height: "100%" }}
    />
  );
}
