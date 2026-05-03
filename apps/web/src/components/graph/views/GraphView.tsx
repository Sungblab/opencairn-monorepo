"use client";
import React, { useMemo, useState, useCallback, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import type CytoscapeComponentType from "react-cytoscapejs";
import cytoscape from "cytoscape";
import fcose from "cytoscape-fcose";
import { useRouter, useParams } from "next/navigation";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import { urls } from "@/lib/urls";
import { useTabsStore } from "@/stores/tabs-store";
import { useProjectGraph } from "../useProjectGraph";
import { toCytoscapeElements } from "../to-cytoscape-elements";
import { GRAPH_STYLESHEET } from "../cytoscape-stylesheet";
import { GraphFilters } from "../GraphFilters";
import { GraphSkeleton } from "../GraphSkeleton";
import { GraphError } from "../GraphError";
import { GraphEmpty } from "../GraphEmpty";
import { INITIAL_FILTERS, type FilterState } from "../graph-types";
import { evidenceBundleById, type GroundedEdge } from "../grounded-types";
import { EdgeEvidencePanel } from "./EdgeEvidencePanel";

// react-cytoscapejs ships an ESM build that imports cytoscape at top level.
// Disable SSR — Cytoscape needs DOM/window. Plan 7 Canvas does the same for
// its iframe runtime via dynamic import.
const CytoscapeComponent = dynamic<React.ComponentProps<typeof CytoscapeComponentType>>(
  () => import("react-cytoscapejs"),
  { ssr: false },
);

if (typeof window !== "undefined") {
  // Register the layout extension once. Repeated calls in HMR are harmless
  // (cytoscape ignores duplicate registrations).
  cytoscape.use(fcose);
}

export default function GraphView({ projectId }: { projectId: string }) {
  const t = useTranslations("graph");
  const locale = useLocale();
  const router = useRouter();
  const params = useParams<{ wsSlug: string }>();
  const wsSlug = params?.wsSlug;
  const { data, isLoading, error, expand } = useProjectGraph(projectId);
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);

  const elements = useMemo(
    () => (data ? toCytoscapeElements(data, filters) : []),
    [data, filters],
  );

  const visibleNodeCount = useMemo(
    () => elements.filter((el) => el.data.type === "node").length,
    [elements],
  );

  const relations = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    for (const e of data.edges) set.add(e.relationType);
    return [...set].sort();
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

  const addOrReplacePreview = useTabsStore((s) => s.addOrReplacePreview);

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

  // Park the latest handler in a ref so the cytoscape `dbltap` binding
  // closes over a stable indirection. Without this, the binding would
  // capture the *first* render's onNodeDoubleClick and miss any tabs-store
  // / router updates that happened since (classic stale-closure bug).
  // The ref-update effect is keyed on `onNodeDoubleClick` so it always
  // points at the current callback; the bind effect is keyed on `data`
  // so we only re-bind when cytoscape's underlying instance might be
  // rebuilt (elements arrival).
  const handlerRef = useRef(onNodeDoubleClick);
  useEffect(() => {
    handlerRef.current = onNodeDoubleClick;
  }, [onNodeDoubleClick]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const onTap = (evt: cytoscape.EventObject) => {
      if (evt.target === cy) return; // background click
      const node = evt.target;
      if (node?.isNode?.()) {
        const fid = node.data("firstNoteId") as string | null;
        const lbl = node.data("label") as string;
        handlerRef.current(fid, lbl);
      } else if (node?.isEdge?.()) {
        setSelectedEdgeId(node.id());
      }
    };
    cy.on("dbltap", "node", onTap);
    cy.on("tap", "edge", onTap);
    return () => {
      cy.off("dbltap", "node", onTap);
      cy.off("tap", "edge", onTap);
    };
  }, [data]);

  if (isLoading) return <GraphSkeleton />;
  if (error) return <GraphError error={error as Error} />;
  if (!data || data.nodes.length === 0) return <GraphEmpty />;

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
      <div className="relative flex-1">
        <CytoscapeComponent
          elements={elements as cytoscape.ElementDefinition[]}
          // fcose layout is non-deterministic by default. randomize:false
          // keeps positions stable across re-renders that don't add nodes.
          layout={{ name: "fcose", animate: true, randomize: false, padding: 30 } as cytoscape.LayoutOptions}
          stylesheet={GRAPH_STYLESHEET as cytoscape.StylesheetJsonBlock[]}
          cy={(cy: cytoscape.Core) => { cyRef.current = cy; }}
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
    </div>
  );
}
