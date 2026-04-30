import { zValidator } from "@hono/zod-validator";
import {
  and,
  captureNoteVersion,
  db,
  desc,
  eq,
  lt,
  noteVersions,
  notes,
  previewText,
  restoreNoteVersion,
  yjsDocuments,
} from "@opencairn/db";
import {
  noteVersionDetailResponseSchema,
  noteVersionDiffSchema,
  noteVersionListResponseSchema,
  restoreNoteVersionResponseSchema,
} from "@opencairn/shared";
import { Hono } from "hono";
import { z } from "zod";

import { diffPlateValues } from "../lib/note-version-diff";
import { canRead, canWrite } from "../lib/permissions";
import type { AppEnv } from "../lib/types";
import { isUuid } from "../lib/validators";
import { requireAuth } from "../middleware/auth";

const checkpointSchema = z.object({
  reason: z.string().max(500).optional(),
});

function parseVersion(value: string): number | null {
  const version = Number(value);
  return Number.isInteger(version) && version > 0 ? version : null;
}

function toListItem(row: typeof noteVersions.$inferSelect) {
  return {
    id: row.id,
    version: row.version,
    title: row.title,
    contentTextPreview: previewText(row.contentText),
    actor: { type: row.actorType, id: row.actorId, name: null },
    source: row.source,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  };
}

function mapRestoreError(error: unknown): {
  status: 404 | 409 | 500;
  code: string;
} {
  const message = error instanceof Error ? error.message : "restore_failed";
  if (message === "version_not_found" || message === "note_not_found") {
    return { status: 404, code: message };
  }
  if (message === "version_already_current") {
    return { status: 409, code: message };
  }
  return { status: 500, code: "restore_failed" };
}

export const noteVersionRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get("/:id/versions", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
    if (!(await canRead(user.id, { type: "note", id }))) {
      return c.json({ error: "Forbidden" }, 403);
    }

    const limit = Math.min(
      Math.max(Number(c.req.query("limit") ?? 50), 1),
      100,
    );
    const cursor = c.req.query("cursor");
    const cursorVersion = cursor ? parseVersion(cursor) : null;
    if (cursor && !cursorVersion) return c.json({ error: "Bad Request" }, 400);

    const rows = await db
      .select()
      .from(noteVersions)
      .where(
        cursorVersion
          ? and(
              eq(noteVersions.noteId, id),
              lt(noteVersions.version, cursorVersion),
            )
          : eq(noteVersions.noteId, id),
      )
      .orderBy(desc(noteVersions.version))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const payload = {
      versions: page.map(toListItem),
      nextCursor:
        rows.length > limit ? String(rows[limit]?.version ?? "") : null,
    };
    return c.json(noteVersionListResponseSchema.parse(payload));
  })
  .get("/:id/versions/:version", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const version = parseVersion(c.req.param("version"));
    if (!isUuid(id) || !version) return c.json({ error: "Bad Request" }, 400);
    if (!(await canRead(user.id, { type: "note", id }))) {
      return c.json({ error: "Forbidden" }, 403);
    }

    const [row] = await db
      .select()
      .from(noteVersions)
      .where(
        and(eq(noteVersions.noteId, id), eq(noteVersions.version, version)),
      )
      .limit(1);
    if (!row) return c.json({ error: "Not found" }, 404);

    return c.json(
      noteVersionDetailResponseSchema.parse({
        ...toListItem(row),
        content: row.content,
        contentText: row.contentText,
      }),
    );
  })
  .get("/:id/versions/:version/diff", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const version = parseVersion(c.req.param("version"));
    const against = c.req.query("against") ?? "current";
    if (!isUuid(id) || !version) return c.json({ error: "Bad Request" }, 400);
    if (against !== "current" && against !== "previous") {
      return c.json({ error: "Bad Request" }, 400);
    }
    if (!(await canRead(user.id, { type: "note", id }))) {
      return c.json({ error: "Forbidden" }, 403);
    }

    const [target] = await db
      .select()
      .from(noteVersions)
      .where(
        and(eq(noteVersions.noteId, id), eq(noteVersions.version, version)),
      )
      .limit(1);
    if (!target) return c.json({ error: "Not found" }, 404);

    const diff =
      against === "previous"
        ? await diffAgainstPrevious(id, target)
        : await diffAgainstCurrent(id, target);
    return c.json(noteVersionDiffSchema.parse(diff));
  })
  .post(
    "/:id/versions/checkpoint",
    zValidator("json", checkpointSchema),
    async (c) => {
      const user = c.get("user");
      const id = c.req.param("id");
      if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
      if (!(await canWrite(user.id, { type: "note", id }))) {
        return c.json({ error: "Forbidden" }, 403);
      }

      const [note] = await db
        .select()
        .from(notes)
        .where(eq(notes.id, id))
        .limit(1);
      if (!note) return c.json({ error: "Not found" }, 404);
      const [doc] = await db
        .select()
        .from(yjsDocuments)
        .where(eq(yjsDocuments.name, `page:${id}`))
        .limit(1);
      if (!doc) return c.json({ error: "version_not_restorable" }, 409);

      try {
        const result = await captureNoteVersion({
          noteId: id,
          title: note.title,
          content: note.content ?? [],
          contentText: note.contentText ?? "",
          yjsState: doc.state,
          yjsStateVector: doc.stateVector,
          source: "manual_checkpoint",
          actorType: "user",
          actorId: user.id,
          reason: c.req.valid("json").reason ?? null,
          force: true,
        });
        return c.json(result, result.created ? 201 : 200);
      } catch (error) {
        if (error instanceof Error && error.message === "version_too_large") {
          return c.json({ error: "version_too_large" }, 413);
        }
        throw error;
      }
    },
  )
  .post("/:id/versions/:version/restore", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const version = parseVersion(c.req.param("version"));
    if (!isUuid(id) || !version) return c.json({ error: "Bad Request" }, 400);
    if (!(await canWrite(user.id, { type: "note", id }))) {
      return c.json({ error: "Forbidden" }, 403);
    }

    try {
      const result = await restoreNoteVersion({
        noteId: id,
        version,
        actorId: user.id,
      });
      return c.json(restoreNoteVersionResponseSchema.parse(result));
    } catch (error) {
      const mapped = mapRestoreError(error);
      return c.json({ error: mapped.code }, mapped.status);
    }
  });

async function diffAgainstCurrent(
  noteId: string,
  target: typeof noteVersions.$inferSelect,
) {
  const [note] = await db
    .select()
    .from(notes)
    .where(eq(notes.id, noteId))
    .limit(1);
  if (!note) throw new Error("note_not_found");
  return diffPlateValues({
    fromVersion: target.version,
    toVersion: "current",
    before: target.content,
    after: note.content ?? [],
  });
}

async function diffAgainstPrevious(
  noteId: string,
  target: typeof noteVersions.$inferSelect,
) {
  const [previous] = await db
    .select()
    .from(noteVersions)
    .where(
      and(
        eq(noteVersions.noteId, noteId),
        eq(noteVersions.version, target.version - 1),
      ),
    )
    .limit(1);
  if (!previous) {
    return diffPlateValues({
      fromVersion: target.version,
      toVersion: target.version,
      before: target.content,
      after: target.content,
    });
  }
  return diffPlateValues({
    fromVersion: previous.version,
    toVersion: target.version,
    before: previous.content,
    after: target.content,
  });
}
