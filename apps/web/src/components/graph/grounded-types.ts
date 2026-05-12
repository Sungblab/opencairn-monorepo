import type { EvidenceBundle, GraphViewResponse } from "@opencairn/shared";

export type SupportStatus =
  | "supported"
  | "weak"
  | "stale"
  | "disputed"
  | "missing";

export type EdgeSupport = {
  claimId: string | null;
  evidenceBundleId: string | null;
  supportScore: number;
  citationCount: number;
  status: SupportStatus;
};

export type GroundedEdge = GraphViewResponse["edges"][number] & {
  id: string;
  surfaceType?: "semantic_relation" | "wiki_link" | "co_mention" | "source_membership" | "sequence" | "bridge";
  displayOnly?: boolean;
  sourceNoteIds?: string[];
  sourceNotes?: Array<{ id: string; title: string }>;
  sourceContexts?: Array<{
    noteId: string;
    noteTitle: string;
    chunkId?: string;
    headingPath?: string;
    chunkIndex?: number;
  }>;
  support?: EdgeSupport;
};

export type GroundedCard = {
  id: string;
  conceptId: string;
  title: string;
  summary: string;
  evidenceBundleId: string | null;
  citationCount: number;
};

export type GroundedGraphResponse = Omit<GraphViewResponse, "edges"> & {
  edges: GroundedEdge[];
  noteLinks?: NonNullable<GraphViewResponse["noteLinks"]>;
  cards?: GroundedCard[];
  evidenceBundles?: EvidenceBundle[];
};

export function evidenceBundleById(
  bundles: EvidenceBundle[] | undefined,
): Map<string, EvidenceBundle> {
  return new Map((bundles ?? []).map((bundle) => [bundle.id, bundle]));
}
