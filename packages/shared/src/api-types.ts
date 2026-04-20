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
export const createNoteSchema = z.object({
  projectId: z.string().uuid(),
  folderId: z.string().uuid().nullable().default(null),
  title: z.string().max(300).default("Untitled"),
  content: z.record(z.unknown()).nullable().default(null),
  type: z.enum(["note", "wiki", "source"]).default("note"),
});

export const updateNoteSchema = z.object({
  title: z.string().max(300).optional(),
  content: z.record(z.unknown()).nullable().optional(),
  folderId: z.string().uuid().nullable().optional(),
});
