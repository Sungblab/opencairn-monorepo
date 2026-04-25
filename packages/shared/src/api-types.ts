import { z } from "zod";

// ── Projects ──────────────────────────────────────────────────────────────────────
export const createProjectSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).default(""),
});

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
});

// ── Folders ───────────────────────────────────────────────────────────────────────
export const createFolderSchema = z.object({
  projectId: z.string().uuid(),
  parentId: z.string().uuid().nullable().default(null),
  name: z.string().min(1).max(100),
});

export const updateFolderSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  parentId: z.string().uuid().nullable().optional(),
  position: z.number().int().min(0).optional(),
});

// ── Tags ──────────────────────────────────────────────────────────────────────────
export const createTagSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(50),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#6b7280"),
});

// ── Notes ─────────────────────────────────────────────────────────────────────────
// Plate Value is an array of block nodes. `content` is jsonb in DB — we accept any
// JSON array here; strict Plate node validation happens client-side.
const plateValueSchema = z.array(z.unknown()).nullable();

const sourceTypeSchema = z.enum([
  "manual",
  "pdf",
  "audio",
  "video",
  "image",
  "youtube",
  "web",
  "notion",
  "unknown",
  "canvas",
]);

export const canvasLanguageSchema = z.enum([
  "python",
  "javascript",
  "html",
  "react",
]);
export type CanvasLanguage = z.infer<typeof canvasLanguageSchema>;

export const MAX_CANVAS_SOURCE_BYTES = 64 * 1024;

export const createNoteSchema = z
  .object({
    projectId: z.string().uuid(),
    folderId: z.string().uuid().nullable().default(null),
    title: z.string().max(300).default("Untitled"),
    content: plateValueSchema.default(null),
    type: z.enum(["note", "wiki", "source"]).default("note"),
    sourceType: sourceTypeSchema.optional(),
    canvasLanguage: canvasLanguageSchema.optional(),
    contentText: z.string().max(MAX_CANVAS_SOURCE_BYTES).optional(),
  })
  // Asymmetric on purpose: only the canvas → language direction is API-checked.
  // The reverse (canvasLanguage without sourceType=canvas) is rejected by the DB
  // CHECK constraint notes_canvas_language_check (Plan 7 Phase 1 Task 1).
  .refine(
    (d) => d.sourceType !== "canvas" || d.canvasLanguage !== undefined,
    {
      message: "canvasLanguage required when sourceType=canvas",
      path: ["canvasLanguage"],
    },
  );

export const updateNoteSchema = z.object({
  title: z.string().max(300).optional(),
  content: plateValueSchema.optional(),
  folderId: z.string().uuid().nullable().optional(),
});

export const patchCanvasSchema = z.object({
  source: z.string().max(MAX_CANVAS_SOURCE_BYTES),
  language: canvasLanguageSchema.optional(),
});

// ─── Plan 5 Phase 1: Knowledge Graph ───────────────────────────────────────

/**
 * One node in the project graph response. `firstNoteId` lets the UI
 * jump to the concept's representative source note on dblclick without
 * an extra round-trip; null means the concept has no source notes
 * registered yet (Compiler upserts the row before linking).
 */
export const graphNodeSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string(),
  degree: z.number().int().nonnegative(),
  noteCount: z.number().int().nonnegative(),
  firstNoteId: z.string().uuid().nullable(),
});
export type GraphNode = z.infer<typeof graphNodeSchema>;

export const graphEdgeSchema = z.object({
  id: z.string().uuid(),
  sourceId: z.string().uuid(),
  targetId: z.string().uuid(),
  /**
   * concept_edges.relation_type is `text` (free text, default 'related-to')
   * because Compiler emits arbitrary relation labels. The graph UI's
   * relation filter dropdown derives its options from observed values,
   * not a Zod enum.
   */
  relationType: z.string(),
  weight: z.number(),
});
export type GraphEdge = z.infer<typeof graphEdgeSchema>;

export const graphResponseSchema = z.object({
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
  /** True when totalConcepts > limit; UI shows a "narrow with filters" banner. */
  truncated: z.boolean(),
  totalConcepts: z.number().int().nonnegative(),
});
export type GraphResponse = z.infer<typeof graphResponseSchema>;

/** Same node/edge shape; expand returns a subgraph slice without truncation meta. */
export const graphExpandResponseSchema = z.object({
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
});
export type GraphExpandResponse = z.infer<typeof graphExpandResponseSchema>;

/** Server-side validators (mirrored to `apps/api/src/routes/graph.ts`). */
export const graphQuerySchema = z.object({
  limit: z.coerce.number().int().min(50).max(500).default(500),
  order: z.enum(["degree", "recent"]).default("degree"),
  relation: z.string().optional(),
});
export const graphExpandQuerySchema = z.object({
  hops: z.coerce.number().int().min(1).max(3).default(1),
});

// ─── Plan 5 Phase 1: Wiki-link Backlinks ──────────────────────────────────

export const backlinkSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  projectId: z.string().uuid(),
  projectName: z.string(),
  updatedAt: z.string().datetime(),
});
export type Backlink = z.infer<typeof backlinkSchema>;

export const backlinksResponseSchema = z.object({
  data: z.array(backlinkSchema),
  total: z.number().int().nonnegative(),
});
export type BacklinksResponse = z.infer<typeof backlinksResponseSchema>;
