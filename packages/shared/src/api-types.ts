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
  /**
   * ISO-8601 timestamp of `concepts.created_at`. Optional for Phase 1
   * super-set compatibility — older clients ignore the field; the timeline
   * view renderer reads it as the X-axis fallback when `eventYear` is
   * absent (the deterministic path's default since the Vis Agent only
   * sets `eventYear` for concepts it can date-anchor explicitly).
   */
  createdAt: z.string().optional(),
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

/**
 * Plan 5 Phase 2: in-tab view types under the single `mode='graph'` tab.
 * `graph` is the Phase 1 default and remains regression-zero.
 */
export const graphViewTypeSchema = z.enum([
  "graph",
  "mindmap",
  "cards",
  "timeline",
  "board",
]);
export type GraphViewType = z.infer<typeof graphViewTypeSchema>;

/** Server-suggested layout hint for the renderer (cytoscape-* algorithms). */
export const graphLayoutSchema = z.enum(["fcose", "dagre", "preset"]);
export type GraphLayout = z.infer<typeof graphLayoutSchema>;

export const graphResponseSchema = z.object({
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
  /** True when totalConcepts > limit; UI shows a "narrow with filters" banner. */
  truncated: z.boolean(),
  totalConcepts: z.number().int().nonnegative(),
  /**
   * Echo of the requested `?view=` (defaults to `graph` for Phase 1 callers).
   * Phase 1 clients ignore this field (super-set compatibility).
   */
  viewType: graphViewTypeSchema,
  /** Layout hint for the client renderer. */
  layout: graphLayoutSchema,
  /**
   * Echoed seed concept id for `view=mindmap|board`. `null` for the other
   * three views and for `mindmap` against an empty project.
   */
  rootId: z.string().uuid().nullable(),
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
  /**
   * Plan 5 Phase 2: in-tab view selector. `graph` (default) is regression-zero
   * vs Phase 1 — same nodes/edges/truncated/totalConcepts shape, plus the
   * `viewType`/`layout`/`rootId` echo fields appended.
   */
  view: graphViewTypeSchema.default("graph"),
  /**
   * Seed concept id for `view=mindmap|board`. For `mindmap` it is auto-selected
   * (highest-degree concept in the project) when omitted. Ignored by
   * `view=graph|cards|timeline`.
   */
  root: z.string().uuid().optional(),
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

// ─── Plan 5 Phase 2: ViewSpec ────────────────────────────────────────

export const ViewType = z.enum([
  "graph", "mindmap", "cards", "timeline", "board",
]);
export type ViewType = z.infer<typeof ViewType>;

export const ViewLayout = z.enum(["fcose", "dagre", "preset", "cose-bilkent"]);
export type ViewLayout = z.infer<typeof ViewLayout>;

export const ViewNode = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().optional(),
  degree: z.number().int().min(0).optional(),
  noteCount: z.number().int().min(0).optional(),
  firstNoteId: z.string().uuid().nullable().optional(),
  eventYear: z.number().int().min(-3000).max(3000).optional(),
  /**
   * ISO-8601 created_at fallback used by the timeline layout when the Vis
   * Agent (or deterministic path) didn't supply an explicit `eventYear`.
   * Without this the deterministic timeline collapses every node onto the
   * axis midpoint — see timeline-layout.ts `nodeYear`.
   */
  createdAt: z.string().optional(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
});
export type ViewNode = z.infer<typeof ViewNode>;

export const ViewEdge = z.object({
  id: z.string().uuid().optional(),
  sourceId: z.string().uuid(),
  targetId: z.string().uuid(),
  relationType: z.string(),
  weight: z.number().min(0).max(1),
});
export type ViewEdge = z.infer<typeof ViewEdge>;

export const ViewSpec = z.object({
  viewType: ViewType,
  layout: ViewLayout,
  rootId: z.string().uuid().nullable(),
  nodes: z.array(ViewNode).max(500),
  edges: z.array(ViewEdge).max(2000),
  rationale: z.string().max(200).optional(),
});
export type ViewSpec = z.infer<typeof ViewSpec>;

export const GraphViewResponse = ViewSpec.extend({
  truncated: z.boolean(),
  totalConcepts: z.number().int().min(0),
});
export type GraphViewResponse = z.infer<typeof GraphViewResponse>;
