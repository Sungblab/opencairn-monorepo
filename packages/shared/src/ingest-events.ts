import { z } from "zod";

export const IngestEventKind = z.enum([
  "started",
  "stage_changed",
  "completed",
  "failed",
  "unit_started",
  "unit_parsed",
  "figure_extracted",
  "artifact_created",
  "bundle_status_changed",
  "outline_node",
  "enrichment",
]);
export type IngestEventKind = z.infer<typeof IngestEventKind>;

const baseEnvelope = {
  workflowId: z.string(),
  seq: z.number().int().nonnegative(),
  ts: z.string().datetime(),
};

export const IngestStartedPayload = z.object({
  mime: z.string(),
  fileName: z.string().nullable(),
  url: z.string().nullable(),
  totalUnits: z.number().int().positive().nullable(),
});

export const IngestStageChangedPayload = z.object({
  stage: z.enum(["downloading", "parsing", "enhancing", "persisting"]),
  pct: z.number().min(0).max(100).nullable(),
});

export const IngestUnitStartedPayload = z.object({
  index: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  label: z.string(),
});

export const IngestUnitParsedPayload = z.object({
  index: z.number().int().nonnegative(),
  unitKind: z.enum(["page", "segment", "section", "document"]),
  charCount: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
});

export const IngestFigureExtractedPayload = z.object({
  sourceUnit: z.number().int().nonnegative(),
  objectKey: z.string(),
  figureKind: z.enum(["image", "table", "chart", "equation"]),
  caption: z.string().nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
});

export const IngestArtifactCreatedPayload = z.object({
  nodeId: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  kind: z.enum(["note", "agent_file", "artifact", "artifact_group"]),
  label: z.string(),
  role: z.string(),
  pageIndex: z.number().int().min(0).optional(),
  figureIndex: z.number().int().min(0).optional(),
});

export const IngestBundleStatusChangedPayload = z.object({
  bundleNodeId: z.string().uuid(),
  status: z.enum(["running", "completed", "failed"]),
  reason: z.string().optional(),
});

export const IngestOutlineNodePayload = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  level: z.number().int().min(1).max(6),
  title: z.string().max(200),
});

export const IngestCompletedPayload = z.object({
  noteId: z.string().uuid(),
  totalDurationMs: z.number().int().nonnegative(),
});

export const IngestFailedPayload = z.object({
  reason: z.string(),
  quarantineKey: z.string().nullable(),
  retryable: z.boolean(),
});

export const IngestEnrichmentPayload = z.object({
  type: z.string(),
  data: z.unknown(),
});

export const IngestEvent = z.discriminatedUnion("kind", [
  z.object({ ...baseEnvelope, kind: z.literal("started"), payload: IngestStartedPayload }),
  z.object({ ...baseEnvelope, kind: z.literal("stage_changed"), payload: IngestStageChangedPayload }),
  z.object({ ...baseEnvelope, kind: z.literal("unit_started"), payload: IngestUnitStartedPayload }),
  z.object({ ...baseEnvelope, kind: z.literal("unit_parsed"), payload: IngestUnitParsedPayload }),
  z.object({ ...baseEnvelope, kind: z.literal("figure_extracted"), payload: IngestFigureExtractedPayload }),
  z.object({ ...baseEnvelope, kind: z.literal("artifact_created"), payload: IngestArtifactCreatedPayload }),
  z.object({ ...baseEnvelope, kind: z.literal("bundle_status_changed"), payload: IngestBundleStatusChangedPayload }),
  z.object({ ...baseEnvelope, kind: z.literal("outline_node"), payload: IngestOutlineNodePayload }),
  z.object({ ...baseEnvelope, kind: z.literal("completed"), payload: IngestCompletedPayload }),
  z.object({ ...baseEnvelope, kind: z.literal("failed"), payload: IngestFailedPayload }),
  z.object({ ...baseEnvelope, kind: z.literal("enrichment"), payload: IngestEnrichmentPayload }),
]);
export type IngestEvent = z.infer<typeof IngestEvent>;
