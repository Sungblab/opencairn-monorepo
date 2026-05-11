"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import cytoscape from "cytoscape";
import fcose from "cytoscape-fcose";
import { useTranslations } from "next-intl";
import { useTabsStore } from "@/stores/tabs-store";
import { useProjectGraph } from "../useProjectGraph";
import { evidenceBundleById, type GroundedEdge } from "../grounded-types";
import { EdgeEvidencePanel } from "./EdgeEvidencePanel";

const CytoscapeComponent = dynamic(() => import("react-cytoscapejs"), {
  ssr: false,
});

if (typeof window !== "undefined") {
  cytoscape.use(fcose);
}

interface Props {
  projectId: string;
}

function edgeElementId(edge: GroundedEdge) {
  return edge.id ?? `${edge.sourceId}->${edge.targetId}:${edge.relationType}`;
}

/**
 * `?view=cards` — connected concept cards. The API keeps the recent-concepts
 * selection that made the old card grid useful, but now includes intra-set
 * edges so relationships remain visible.
 */
export default function CardsView({ projectId }: Props) {
  const t = useTranslations("graph");
  const { data, isLoading, error } = useProjectGraph(projectId, {
    view: "cards",
  });
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const addOrReplacePreview = useTabsStore((s) => s.addOrReplacePreview);

  const elements = useMemo(() => {
    if (!data) return [];
    const cardsByConceptId = new Map(
      (data.cards ?? []).map((card) => [card.conceptId, card]),
    );
    return [
      ...data.nodes.map((node) => {
        const card = cardsByConceptId.get(node.id);
        return {
          data: {
            id: node.id,
            label: card?.title ?? node.name,
            summary: card?.summary ?? node.description,
            citationCount: card?.citationCount ?? 0,
            degree: node.degree ?? 0,
            noteCount: node.noteCount ?? 0,
            firstNoteId: node.firstNoteId ?? null,
          },
        };
      }),
      ...data.edges.map((edge) => ({
        data: {
          id: edgeElementId(edge as GroundedEdge),
          source: edge.sourceId,
          target: edge.targetId,
          label: edge.relationType,
          weight: edge.weight,
          supportStatus: (edge as GroundedEdge).support?.status,
        },
      })),
    ];
  }, [data]);

  const selectedEdge = useMemo(
    () =>
      data?.edges.find((edge) => edgeElementId(edge as GroundedEdge) === selectedEdgeId) as
        | GroundedEdge
        | undefined,
    [data?.edges, selectedEdgeId],
  );
  const bundlesById = useMemo(
    () => evidenceBundleById(data?.evidenceBundles),
    [data?.evidenceBundles],
  );

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const onTap = (evt: cytoscape.EventObject) => {
      if (evt.target === cy) {
        setSelectedEdgeId(null);
        return;
      }
      const target = evt.target;
      if (target?.isEdge?.()) {
        setSelectedEdgeId(target.id());
      }
    };
    const onNodeDoubleTap = (evt: cytoscape.EventObject) => {
      const target = evt.target;
      if (!target?.isNode?.()) return;
      const firstNoteId = target.data("firstNoteId") as string | null;
      if (!firstNoteId) return;
      addOrReplacePreview({
        id: crypto.randomUUID(),
        kind: "note",
        targetId: firstNoteId,
        mode: "plate",
        title: target.data("label") as string,
        pinned: false,
        preview: true,
        dirty: false,
        splitWith: null,
        splitSide: null,
        scrollY: 0,
      });
    };
    cy.on("tap", onTap);
    cy.on("dbltap", "node", onNodeDoubleTap);
    return () => {
      cy.off("tap", onTap);
      cy.off("dbltap", "node", onNodeDoubleTap);
    };
  }, [addOrReplacePreview, data]);

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
    <div className="relative h-full">
      <CytoscapeComponent
        elements={elements as cytoscape.ElementDefinition[]}
        layout={{
          name: "fcose",
          animate: true,
          randomize: false,
          padding: 42,
        } as cytoscape.LayoutOptions}
        stylesheet={CARD_GRAPH_STYLESHEET as cytoscape.StylesheetJsonBlock[]}
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

const CARD_GRAPH_STYLESHEET: cytoscape.StylesheetStyle[] = [
  {
    selector: "node",
    style: {
      shape: "round-rectangle",
      label: "data(label)",
      "font-size": "11px",
      "font-weight": 600,
      color: "hsl(var(--foreground))",
      "background-color": "hsl(var(--background))",
      "border-color": "hsl(var(--border))",
      "border-width": 1,
      width: "mapData(degree, 0, 20, 110, 170)",
      height: "mapData(noteCount, 0, 12, 48, 70)",
      "text-wrap": "wrap",
      "text-max-width": "145px",
      "text-valign": "center",
      "text-halign": "center",
    },
  },
  {
    selector: "node[citationCount > 0]",
    style: {
      "border-width": 2,
      "border-color": "hsl(var(--primary))",
    },
  },
  {
    selector: "edge",
    style: {
      "curve-style": "bezier",
      "line-color": "hsl(var(--border))",
      width: "mapData(weight, 0, 1, 1, 4)",
      "target-arrow-shape": "triangle",
      "target-arrow-color": "hsl(var(--border))",
      label: "data(label)",
      "font-size": "9px",
      color: "hsl(var(--muted-foreground))",
      "text-background-color": "hsl(var(--background))",
      "text-background-opacity": 0.85,
      "text-background-padding": "2px",
    },
  },
  {
    selector: 'edge[supportStatus = "supported"]',
    style: {
      "line-color": "hsl(var(--primary))",
      "target-arrow-color": "hsl(var(--primary))",
    },
  },
  {
    selector: 'edge[supportStatus = "weak"]',
    style: {
      "line-style": "dashed",
      opacity: 0.7,
    },
  },
  {
    selector: 'edge[supportStatus = "missing"]',
    style: {
      "line-style": "dotted",
      opacity: 0.55,
    },
  },
];
