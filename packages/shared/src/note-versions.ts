import { z } from "zod";

export const NoteVersionActorTypeSchema = z.enum(["user", "agent", "system"]);

export const NoteVersionSourceSchema = z.enum([
  "auto_save",
  "title_change",
  "ai_edit",
  "restore",
  "manual_checkpoint",
  "import",
]);

export const NoteVersionActorSchema = z.object({
  type: NoteVersionActorTypeSchema,
  id: z.string().nullable(),
  name: z.string().nullable(),
});

export const NoteVersionListItemSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  title: z.string(),
  contentTextPreview: z.string(),
  actor: NoteVersionActorSchema,
  source: NoteVersionSourceSchema,
  reason: z.string().nullable(),
  createdAt: z.string(),
});

export const NoteVersionListResponseSchema = z.object({
  versions: z.array(NoteVersionListItemSchema),
  nextCursor: z.string().nullable(),
});

export const NoteVersionDetailResponseSchema = NoteVersionListItemSchema.extend(
  {
    content: z.unknown(),
    contentText: z.string(),
  },
);

export const NoteVersionTextDiffPartSchema = z.object({
  kind: z.enum(["equal", "insert", "delete"]),
  text: z.string(),
});

export const NoteVersionDiffSchema = z.object({
  fromVersion: z.union([z.number().int().positive(), z.literal("current")]),
  toVersion: z.union([z.number().int().positive(), z.literal("current")]),
  summary: z.object({
    addedBlocks: z.number().int().min(0),
    removedBlocks: z.number().int().min(0),
    changedBlocks: z.number().int().min(0),
    addedWords: z.number().int().min(0),
    removedWords: z.number().int().min(0),
  }),
  blocks: z.array(
    z.object({
      key: z.string(),
      status: z.enum(["added", "removed", "changed", "unchanged"]),
      before: z.unknown().optional(),
      after: z.unknown().optional(),
      textDiff: z.array(NoteVersionTextDiffPartSchema).optional(),
    }),
  ),
});

export const RestoreNoteVersionResponseSchema = z.object({
  noteId: z.string().uuid(),
  restoredFromVersion: z.number().int().positive(),
  newVersion: z.number().int().positive(),
  updatedAt: z.string(),
});

export const noteVersionActorTypeSchema = NoteVersionActorTypeSchema;
export const noteVersionSourceSchema = NoteVersionSourceSchema;
export const noteVersionActorSchema = NoteVersionActorSchema;
export const noteVersionListItemSchema = NoteVersionListItemSchema;
export const noteVersionListResponseSchema = NoteVersionListResponseSchema;
export const noteVersionDetailResponseSchema = NoteVersionDetailResponseSchema;
export const noteVersionDetailSchema = NoteVersionDetailResponseSchema;
export const noteVersionDiffSchema = NoteVersionDiffSchema;
export const restoreNoteVersionResponseSchema =
  RestoreNoteVersionResponseSchema;

export type NoteVersionActorType = z.infer<typeof NoteVersionActorTypeSchema>;
export type NoteVersionSource = z.infer<typeof NoteVersionSourceSchema>;
export type NoteVersionActor = z.infer<typeof NoteVersionActorSchema>;
export type NoteVersionListItem = z.infer<typeof NoteVersionListItemSchema>;
export type NoteVersionListResponse = z.infer<
  typeof NoteVersionListResponseSchema
>;
export type NoteVersionDetailResponse = z.infer<
  typeof NoteVersionDetailResponseSchema
>;
export type NoteVersionDetail = NoteVersionDetailResponse;
export type NoteVersionTextDiffPart = z.infer<
  typeof NoteVersionTextDiffPartSchema
>;
export type NoteVersionDiff = z.infer<typeof NoteVersionDiffSchema>;
export type RestoreNoteVersionResponse = z.infer<
  typeof RestoreNoteVersionResponseSchema
>;
