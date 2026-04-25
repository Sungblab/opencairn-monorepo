import type { TElement } from "platejs";

// Plate v49 void custom element. Worker-generated. Slate runtime requires
// `children: [{ text: "" }]` for void blocks.
//
// All own-fields are JSON-safe primitives or arrays of primitive-only
// objects so Yjs can serialize the node verbatim through the Plate ↔ Yjs
// bridge (see ResearchMetaElement.test.tsx for the roundtrip pin).

export const RESEARCH_META_KEY = "research-meta" as const;

export type ResearchMetaModel =
  | "deep-research-preview-04-2026"
  | "deep-research-max-preview-04-2026";

export interface ResearchMetaSource {
  title: string;
  url: string;
  seq: number;
}

export interface ResearchMetaElement extends TElement {
  type: typeof RESEARCH_META_KEY;
  runId: string;
  model: ResearchMetaModel;
  plan: string;
  sources: ResearchMetaSource[];
  thoughtSummaries?: string[];
  costUsdCents?: number;
  children: [{ text: "" }];
}

export function isResearchMetaElement(
  node: unknown,
): node is ResearchMetaElement {
  return (
    typeof node === "object" &&
    node !== null &&
    (node as { type?: unknown }).type === RESEARCH_META_KEY
  );
}
