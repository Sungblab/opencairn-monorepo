import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  db,
  comments,
  commentMentions,
  notes,
  user,
  workspaceMembers,
  concepts,
  projects,
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
import { persistAndPublish } from "../lib/notification-events";
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

    const authorIds = Array.from(new Set(rows.map((r) => r.authorId)));
    const authors = new Map<string, { name: string | null; image: string | null }>();
    if (authorIds.length) {
      const authorRows = await db
        .select({ id: user.id, name: user.name, image: user.image })
        .from(user)
        .where(inArray(user.id, authorIds));
      for (const a of authorRows) {
        authors.set(a.id, { name: a.name, image: a.image });
      }
    }

    const response: CommentResponse[] = rows.map((r) => ({
      ...serialize(r),
      authorName: authors.get(r.authorId)?.name ?? null,
      authorAvatarUrl: authors.get(r.authorId)?.image ?? null,
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

      const body = c.req.valid("json");

      // Block-anchored comments attach metadata to a specific editor block,
      // which is a write against the page's structural content. Require
      // `editor` (canWrite). Page-level comments stay at `commenter` (canComment).
      // See api-contract.md §Comments.
      //
      // Explicit `!= null` rather than truthy — createCommentSchema already
      // rejects empty strings via `.min(1)`, but the permission gate and the
      // INSERT path should not disagree on what counts as "anchored". If the
      // schema ever relaxes, an empty string must still route through
      // canWrite, not leak into canComment.
      const resource = { type: "note" as const, id: noteId };
      const allowed = body.anchorBlockId != null
        ? await canWrite(userId, resource)
        : await canComment(userId, resource);
      if (!allowed) return c.json({ error: "Forbidden" }, 403);

      // Derive workspaceId from the note (notes.workspaceId is denormalized).
      const [note] = await db
        .select({ workspaceId: notes.workspaceId })
        .from(notes)
        .where(and(eq(notes.id, noteId), isNull(notes.deletedAt)));
      if (!note) return c.json({ error: "Not found" }, 404);

      const mentions = parseMentions(body.body);
      if (!(await mentionsAreValidForWorkspace(userId, note.workspaceId, mentions))) {
        return c.json({ error: "Invalid mention" }, 400);
      }

      // Atomic: insert comment + all mention rows in one tx.
      const result = await db.transaction(async (tx) => {
        let parentAuthorId: string | null = null;
        if (body.parentId) {
          const [parent] = await tx
            .select({
              authorId: comments.authorId,
              noteId: comments.noteId,
              workspaceId: comments.workspaceId,
            })
            .from(comments)
            .where(eq(comments.id, body.parentId))
            .for("update");
          if (
            !parent ||
            parent.noteId !== noteId ||
            parent.workspaceId !== note.workspaceId
          ) {
            return { error: "Invalid parent" as const };
          }
          parentAuthorId = parent.authorId;
        }

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

        return { inserted: row!, parentAuthorId };
      });
      if ("error" in result) {
        return c.json({ error: result.error }, 400);
      }
      const { inserted, parentAuthorId } = result;
      const currentUser = c.get("user") as { name?: string | null; image?: string | null };

      const response: CommentResponse = {
        ...serialize(inserted),
        authorName: currentUser.name ?? null,
        authorAvatarUrl: currentUser.image ?? null,
        mentions,
      };

      // App Shell Phase 5 Task 9 — fan out a notification per mentioned user
      // (skip self-mentions). Done AFTER the transaction commits so a rolled
      // back insert never surfaces a phantom alert; awaited so the test can
      // assert on the resulting row, but silent-on-failure (a notification
      // outage shouldn't 500 the comment write).
      const userMentionIds = Array.from(
        new Set(
          mentions
            .filter((m) => m.type === "user" && m.id !== userId)
            .map((m) => m.id),
        ),
      );
      await Promise.all(
        userMentionIds.map((mentionedId) =>
          persistAndPublish({
            userId: mentionedId,
            kind: "mention",
            payload: {
              summary: body.body,
              noteId,
              commentId: inserted.id,
              fromUserId: userId,
            },
          }).catch(() => undefined),
        ),
      );

      // Plan 2C — comment_reply notification. Fires when:
      //   - the new comment is a reply (parentId set), AND
      //   - the parent author is not the current user
      // Mention + comment_reply double-fire is allowed (both meaningful;
      // both link to the same note).
      if (body.parentId && parentAuthorId) {
        if (parentAuthorId !== userId) {
          await persistAndPublish({
            userId: parentAuthorId,
            kind: "comment_reply",
            payload: {
              summary: body.body.slice(0, 200),
              noteId,
              commentId: inserted.id,
              parentCommentId: body.parentId,
              fromUserId: userId,
            },
          }).catch(() => undefined);
        }
      }

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
      if (!(await mentionsAreValidForWorkspace(userId, row.workspaceId, mentions))) {
        return c.json({ error: "Invalid mention" }, 400);
      }

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

async function mentionsAreValidForWorkspace(
  userId: string,
  workspaceId: string,
  mentions: MentionToken[],
): Promise<boolean> {
  const results = await Promise.all(
    mentions.map((mention) =>
      mentionIsValidForWorkspace(userId, workspaceId, mention),
    ),
  );
  return results.every(Boolean);
}

async function mentionIsValidForWorkspace(
  userId: string,
  workspaceId: string,
  mention: MentionToken,
): Promise<boolean> {
  if (mention.type === "user") {
    const [member] = await db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, mention.id),
        ),
      )
      .limit(1);
    return !!member;
  }

  if (mention.type === "page") {
    if (!isUuid(mention.id)) return false;
    const [page] = await db
      .select({ workspaceId: notes.workspaceId })
      .from(notes)
      .where(and(eq(notes.id, mention.id), isNull(notes.deletedAt)))
      .limit(1);
    if (!page || page.workspaceId !== workspaceId) return false;
    return canRead(userId, { type: "note", id: mention.id });
  }

  if (mention.type === "concept") {
    if (!isUuid(mention.id)) return false;
    const [concept] = await db
      .select({
        projectId: concepts.projectId,
        workspaceId: projects.workspaceId,
      })
      .from(concepts)
      .innerJoin(projects, eq(projects.id, concepts.projectId))
      .where(eq(concepts.id, mention.id))
      .limit(1);
    if (!concept || concept.workspaceId !== workspaceId) return false;
    return canRead(userId, { type: "project", id: concept.projectId });
  }

  return true;
}

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
