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

const MAX_CANVAS_SOURCE_BYTES = 64 * 1024;

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
