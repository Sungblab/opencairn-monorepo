"use client";
import { useMemo } from "react";
import dynamic from "next/dynamic";
import type cytoscape from "cytoscape";
import { useTranslations } from "next-intl";
import { useProjectGraph } from "../useProjectGraph";

// SSR-disabled dynamic import — react-cytoscapejs touches `window` at module
// load time. Same pattern as ProjectGraph + MindmapView; enforced for
// ProjectGraph by scripts/plan-5-graph-guard.sh.
const CytoscapeComponent = dynamic(() => import("react-cytoscapejs"), {
  ssr: false,
});

interface Props {
  projectId: string;
  root?: string;
}

export default function BoardView({ projectId, root }: Props) {
  const t = useTranslations("graph");
  const { data, isLoading, error } = useProjectGraph(projectId, {
    view: "board",
    root,
  });

  const elements = useMemo(() => {
    if (!data) return [];
    return [
      ...data.nodes.map((n, i) => ({
        data: { id: n.id, label: n.name, type: "node" },
        // Phase 2 server doesn't yet persist board positions, so fall back to
        // a deterministic concentric layout. Phase 3 will replace this with
        // user-saved positions from concept_positions.
        position: n.position ?? autoConcentric(i, data.nodes.length),
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
      <div className="p-6 text-sm text-muted-foreground">
        {t("views.noConcepts")}
      </div>
    );
  }

  return (
    <CytoscapeComponent
      elements={elements as cytoscape.ElementDefinition[]}
      layout={
        { name: "preset", fit: true, padding: 30 } as cytoscape.LayoutOptions
      }
      stylesheet={
        [
          {
            selector: "node",
            style: { label: "data(label)", "font-size": 12 },
          },
          {
            selector: "edge",
            style: {
              "curve-style": "bezier",
              "line-color": "#bbb",
            },
          },
        ] as cytoscape.StylesheetJsonBlock[]
      }
      style={{ width: "100%", height: "100%" }}
    />
  );
}

// Concentric ring fallback — places node `i` of `n` on a 12-slot ring,
// expanding the radius every full revolution. Stable across renders so the
// canvas doesn't reflow when react-query refetches with the same data.
function autoConcentric(i: number, _n: number) {
  const radius = 200 + Math.floor(i / 12) * 120;
  const theta = (i % 12) * ((2 * Math.PI) / 12);
  return { x: radius * Math.cos(theta), y: radius * Math.sin(theta) };
}
