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
  updateCommentSchema,
  type CommentResponse,
  type MentionToken,
} from "@opencairn/shared";
import { requireAuth } from "../middleware/auth";
import { canRead, canWrite, canComment } from "../lib/permissions";
import { parseMentions } from "../lib/mention-parser";
import { isUuid } from "../lib/validators";
import type { AppEnv } from "../lib/types";

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
      ...serialize(r),
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

      if (!(await canComment(userId, { type: "note", id: noteId }))) {
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
        ...serialize(inserted),
        mentions,
      };

      return c.json(response, 201);
    },
  )

  .patch(
    "/comments/:id",
    zValidator("json", updateCommentSchema),
    async (c) => {
      const userId = c.get("userId");
      const id = c.req.param("id");
      if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);

      const [row] = await db
        .select()
        .from(comments)
        .where(eq(comments.id, id));
      if (!row) return c.json({ error: "NotFound" }, 404);
      if (row.authorId !== userId) return c.json({ error: "Forbidden" }, 403);

      const { body } = c.req.valid("json");
      const mentions = parseMentions(body);

      const updated = await db.transaction(async (tx) => {
        const [u] = await tx
          .update(comments)
          .set({
            body,
            bodyAst: mentions.length ? { mentions } : null,
            updatedAt: new Date(),
          })
          .where(eq(comments.id, id))
          .returning();
        await tx
          .delete(commentMentions)
          .where(eq(commentMentions.commentId, id));
        if (mentions.length) {
          await tx.insert(commentMentions).values(
            mentions.map((m) => ({
              commentId: id,
              mentionedType: m.type,
              mentionedId: m.id,
            })),
          );
        }
        return u!;
      });

      const response: CommentResponse = { ...serialize(updated), mentions };
      return c.json(response);
    },
  )

  .delete("/comments/:id", async (c) => {
    const userId = c.get("userId");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);

    const [row] = await db
      .select()
      .from(comments)
      .where(eq(comments.id, id));
    if (!row) return c.json({ error: "NotFound" }, 404);

    const isAuthor = row.authorId === userId;
    if (!isAuthor) {
      const writable = await canWrite(userId, {
        type: "note",
        id: row.noteId,
      });
      if (!writable) return c.json({ error: "Forbidden" }, 403);
    }

    await db.delete(comments).where(eq(comments.id, id));
    return c.body(null, 204);
  })

  .post("/comments/:id/resolve", async (c) => {
    const userId = c.get("userId");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);

    const [row] = await db
      .select()
      .from(comments)
      .where(eq(comments.id, id));
    if (!row) return c.json({ error: "NotFound" }, 404);

    const isAuthor = row.authorId === userId;
    const allowed =
      isAuthor ||
      (await canWrite(userId, { type: "note", id: row.noteId }));
    if (!allowed) return c.json({ error: "Forbidden" }, 403);

    const [updated] = await db
      .update(comments)
      .set({
        resolvedAt: row.resolvedAt ? null : new Date(),
        resolvedBy: row.resolvedAt ? null : userId,
        updatedAt: new Date(),
      })
      .where(eq(comments.id, id))
      .returning();
    return c.json(serialize(updated!));
  });

function serialize(
  r: typeof comments.$inferSelect,
): Omit<CommentResponse, "mentions"> {
  return {
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
  };
}
