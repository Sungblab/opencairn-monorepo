import type { GraphViewResponse } from "@opencairn/shared";

export type FilterState = {
  search: string;
  relation: string | null;
};

export const INITIAL_FILTERS: FilterState = { search: "", relation: null };

export type CytoscapeElement =
  | { data: { id: string; label: string; type: "node"; degree: number; firstNoteId: string | null } }
  | { data: { id: string; source: string; target: string; type: "edge"; relationType: string; weight: number } };

// `GraphSnapshot` is the in-cache shape used by useProjectGraph + the
// Cytoscape converter. Plan 5 Phase 2 widens this to `GraphViewResponse`
// (ViewSpec + truncated/totalConcepts) so the AI-emitted ViewSpec inline
// path and the four new view types share the same in-memory representation
// as Phase 1 graph fetches. ViewNode's `degree`/`noteCount`/`firstNoteId`
// are optional vs Phase 1's required GraphNode — consumers should default
// missing fields (see `to-cytoscape-elements.ts`).
export type GraphSnapshot = GraphViewResponse;
