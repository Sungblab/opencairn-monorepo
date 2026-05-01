import { z } from "zod";

export const MAX_EVIDENCE_BUNDLE_ENTRIES = 100;
export const MAX_CONCEPT_EXTRACTION_CHUNKS = 100;

export const evidencePurposeSchema = z.enum([
  "rag_answer",
  "wiki_update",
  "concept_extraction",
  "kg_edge",
  "card_summary",
  "mindmap",
  "lint",
]);
export type EvidencePurpose = z.infer<typeof evidencePurposeSchema>;

export const evidenceProducerSchema = z.object({
  kind: z.enum(["ingest", "chat", "worker", "api", "manual"]),
  runId: z.string().optional(),
  model: z.string().optional(),
  tool: z.string().optional(),
});
export type EvidenceProducer = z.infer<typeof evidenceProducerSchema>;

export const evidenceRetrievalChannelSchema = z.enum([
  "vector",
  "bm25",
  "graph",
  "rerank",
  "manual",
  "generated",
]);
export type EvidenceRetrievalChannel = z.infer<
  typeof evidenceRetrievalChannelSchema
>;

export const evidenceSourceOffsetsSchema = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  })
  .refine((value) => value.end >= value.start, {
    message: "end must be greater than or equal to start",
    path: ["end"],
  });
export type EvidenceSourceOffsets = z.infer<
  typeof evidenceSourceOffsetsSchema
>;

export const evidenceCitationSchema = z.object({
  label: z.string().min(1).max(32),
  title: z.string().min(1),
  locator: z.string().optional(),
  url: z.string().url().optional(),
});
export type EvidenceCitation = z.infer<typeof evidenceCitationSchema>;

export const evidenceEntrySchema = z.object({
  noteChunkId: z.string().uuid(),
  noteId: z.string().uuid(),
  noteType: z.enum(["source", "wiki", "note"]),
  sourceType: z.string().nullable(),
  headingPath: z.string(),
  sourceOffsets: evidenceSourceOffsetsSchema,
  score: z.number(),
  rank: z.number().int().positive(),
  retrievalChannel: evidenceRetrievalChannelSchema,
  quote: z.string().min(1).max(1200),
  citation: evidenceCitationSchema,
  metadata: z.record(z.unknown()).default({}),
});
export type EvidenceEntry = z.infer<typeof evidenceEntrySchema>;

export const evidenceBundleSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid(),
  purpose: evidencePurposeSchema,
  producer: evidenceProducerSchema,
  query: z.string().optional(),
  entries: z.array(evidenceEntrySchema),
  createdBy: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type EvidenceBundle = z.infer<typeof evidenceBundleSchema>;

export const createEvidenceBundleSchema = evidenceBundleSchema
  .omit({ id: true, createdAt: true })
  .extend({
    entries: z
      .array(evidenceEntrySchema)
      .min(1)
      .max(MAX_EVIDENCE_BUNDLE_ENTRIES),
  });
export type CreateEvidenceBundleInput = z.infer<
  typeof createEvidenceBundleSchema
>;

export const claimStatusSchema = z.enum([
  "active",
  "stale",
  "disputed",
  "retracted",
]);
export type ClaimStatus = z.infer<typeof claimStatusSchema>;

export const claimTypeSchema = z.enum([
  "relation",
  "summary",
  "definition",
  "contradiction",
  "synthesis",
]);
export type ClaimType = z.infer<typeof claimTypeSchema>;

export const claimProducerSchema = z.enum([
  "ingest",
  "wiki_maintenance",
  "chat_save",
  "lint",
]);
export type ClaimProducer = z.infer<typeof claimProducerSchema>;

export const edgeEvidenceStanceSchema = z.enum([
  "supports",
  "contradicts",
  "mentions",
]);
export type EdgeEvidenceStance = z.infer<typeof edgeEvidenceStanceSchema>;

export const graphEdgeEvidenceResponseSchema = z.object({
  edgeId: z.string().uuid(),
  claims: z.array(
    z.object({
      claimId: z.string().uuid(),
      claimText: z.string(),
      status: claimStatusSchema,
      confidence: z.number(),
      evidenceBundleId: z.string().uuid(),
      evidence: z.array(evidenceEntrySchema),
    }),
  ),
});
export type GraphEdgeEvidenceResponse = z.infer<
  typeof graphEdgeEvidenceResponseSchema
>;

export const createConceptExtractionSchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid(),
  conceptId: z.string().uuid().optional(),
  name: z.string().min(1),
  kind: z.enum(["concept", "entity", "topic", "claim_subject"]),
  normalizedName: z.string().min(1),
  description: z.string().default(""),
  confidence: z.number().min(0).max(1),
  evidenceBundleId: z.string().uuid(),
  sourceNoteId: z.string().uuid().optional(),
  createdByRunId: z.string().optional(),
  chunks: z
    .array(
      z.object({
        noteChunkId: z.string().uuid(),
        supportScore: z.number().min(0).max(1),
        quote: z.string().min(1).max(1200),
      }),
    )
    .min(1)
    .max(MAX_CONCEPT_EXTRACTION_CHUNKS),
});
export type CreateConceptExtractionInput = z.infer<
  typeof createConceptExtractionSchema
>;
