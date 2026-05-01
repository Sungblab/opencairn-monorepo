import { z } from "zod";

export const mentionTokenSchema = z.object({
  type: z.enum(["user", "page", "concept", "date"]),
  id: z.string().min(1),
  label: z.string().optional(),
});
export type MentionToken = z.infer<typeof mentionTokenSchema>;

export const createCommentSchema = z.object({
  body: z.string().min(1).max(8000),
  anchorBlockId: z.string().min(1).max(128).nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
});
export type CreateCommentInput = z.infer<typeof createCommentSchema>;

export const updateCommentSchema = z.object({
  body: z.string().min(1).max(8000),
});
export type UpdateCommentInput = z.infer<typeof updateCommentSchema>;

export const commentResponseSchema = z.object({
  id: z.string().uuid(),
  noteId: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  anchorBlockId: z.string().nullable(),
  authorId: z.string(),
  authorName: z.string().nullable().optional(),
  authorAvatarUrl: z.string().nullable().optional(),
  body: z.string(),
  resolvedAt: z.string().datetime().nullable(),
  resolvedBy: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  mentions: z.array(mentionTokenSchema),
});
export type CommentResponse = z.infer<typeof commentResponseSchema>;

export const mentionSearchQuerySchema = z.object({
  type: z.enum(["user", "page", "concept"]), // 'date' resolved client-side
  q: z.string().min(0).max(80),
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});
export type MentionSearchQuery = z.infer<typeof mentionSearchQuerySchema>;

export const mentionSearchResultSchema = z.object({
  type: z.enum(["user", "page", "concept"]),
  id: z.string(),
  label: z.string(),
  sublabel: z.string().optional(),
  avatarUrl: z.string().url().optional(),
});
export type MentionSearchResult = z.infer<typeof mentionSearchResultSchema>;
