import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  db,
  comments,
  commentMentions,
  notes,
  eq,
  and,
  desc,
  inArray,
  isNull,
} from "@opencairn/db";
import {
  createCommentSchema,
  type CommentResponse,
  type MentionToken,
} from "@opencairn/shared";
import { requireAuth } from "../middleware/auth";
import { canRead, resolveRole } from "../lib/permissions";
import { parseMentions } from "../lib/mention-parser";
import { isUuid } from "../lib/validators";
import type { AppEnv } from "../lib/types";

const COMMENTER_ROLES = ["owner", "admin", "editor", "commenter"] as const;

export const commentsRouter = new Hono<AppEnv>()
  .use("*", requireAuth)

  .get("/notes/:noteId/comments", async (c) => {
    const userId = c.get("userId");
    const noteId = c.req.param("noteId");
    if (!isUuid(noteId)) return c.json({ error: "Bad Request" }, 400);
    if (!(await canRead(userId, { type: "note", id: noteId }))) {
      return c.json({ error: "Forbidden" }, 403);
    }

    const rows = await db
      .select()
      .from(comments)
      .where(eq(comments.noteId, noteId))
      .orderBy(desc(comments.createdAt));

    // Bucketize mentions by commentId in a single IN query
    // (plan pseudocode used rows[0].id as the only key — bug).
    const mentionsByComment = new Map<string, MentionToken[]>();
    if (rows.length) {
      const ids = rows.map((r) => r.id);
      const allMentions = await db
        .select()
        .from(commentMentions)
        .where(inArray(commentMentions.commentId, ids));
      for (const m of allMentions) {
        const arr = mentionsByComment.get(m.commentId) ?? [];
        arr.push({
          type: m.mentionedType as MentionToken["type"],
          id: m.mentionedId,
        });
        mentionsByComment.set(m.commentId, arr);
      }
    }

    const response: CommentResponse[] = rows.map((r) => ({
      id: r.id,
      noteId: r.noteId,
      parentId: r.parentId,
      anchorBlockId: r.anchorBlockId,
      authorId: r.authorId,
      body: r.body,
      resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
      resolvedBy: r.resolvedBy,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      mentions: mentionsByComment.get(r.id) ?? [],
    }));

    return c.json({ comments: response });
  })

  .post(
    "/notes/:noteId/comments",
    zValidator("json", createCommentSchema),
    async (c) => {
      const userId = c.get("userId");
      const noteId = c.req.param("noteId");
      if (!isUuid(noteId)) return c.json({ error: "Bad Request" }, 400);

      const role = await resolveRole(userId, { type: "note", id: noteId });
      if (!COMMENTER_ROLES.includes(role as (typeof COMMENTER_ROLES)[number])) {
        return c.json({ error: "Forbidden" }, 403);
      }

      const body = c.req.valid("json");

      // Derive workspaceId from the note (notes.workspaceId is denormalized).
      const [note] = await db
        .select({ workspaceId: notes.workspaceId })
        .from(notes)
        .where(and(eq(notes.id, noteId), isNull(notes.deletedAt)));
      if (!note) return c.json({ error: "Not found" }, 404);

      const mentions = parseMentions(body.body);

      // Atomic: insert comment + all mention rows in one tx.
      const inserted = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(comments)
          .values({
            workspaceId: note.workspaceId,
            noteId,
            parentId: body.parentId ?? null,
            anchorBlockId: body.anchorBlockId ?? null,
            authorId: userId,
            body: body.body,
          })
          .returning();

        if (mentions.length) {
          await tx.insert(commentMentions).values(
            mentions.map((m) => ({
              commentId: row!.id,
              mentionedType: m.type,
              mentionedId: m.id,
            })),
          );
        }

        return row!;
      });

      const response: CommentResponse = {
        id: inserted.id,
        noteId: inserted.noteId,
        parentId: inserted.parentId,
        anchorBlockId: inserted.anchorBlockId,
        authorId: inserted.authorId,
        body: inserted.body,
        resolvedAt: inserted.resolvedAt
          ? inserted.resolvedAt.toISOString()
          : null,
        resolvedBy: inserted.resolvedBy,
        createdAt: inserted.createdAt.toISOString(),
        updatedAt: inserted.updatedAt.toISOString(),
        mentions,
      };

      return c.json(response, 201);
    },
  );
