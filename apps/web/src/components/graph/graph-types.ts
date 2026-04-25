import type { GraphResponse } from "@opencairn/shared";

export type FilterState = {
  search: string;
  relation: string | null;
};

export const INITIAL_FILTERS: FilterState = { search: "", relation: null };

export type CytoscapeElement =
  | { data: { id: string; label: string; type: "node"; degree: number; firstNoteId: string | null } }
  | { data: { id: string; source: string; target: string; type: "edge"; relationType: string; weight: number } };

// `GraphSnapshot` is the in-cache shape used by useProjectGraph + the
// Cytoscape converter. Structurally identical to the wire DTO — alias
// keeps type-flow direct and avoids accidental drift if the server
// shape evolves.
export type GraphSnapshot = GraphResponse;
