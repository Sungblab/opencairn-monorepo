import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  db,
  notes,
  noteEnrichments,
  projects,
  projectTreeNodes,
  sourcePdfAnnotations,
  wikiLinks,
  eq,
  and,
  desc,
  isNull,
  isNotNull,
  sql,
} from "@opencairn/db";
import {
  createNoteSchema,
  updateNoteSchema,
  patchCanvasSchema,
} from "@opencairn/shared";

// PATCH body ignores `content` — Yjs (via Hocuspocus) is canonical (Plan 2B).
// `folderId` is also stripped here: moves must go through /:id/move, which
// enforces cross-project scope via moveNote(). Allowing folderId on this
// route would let a caller re-parent a note into another project's folder,
// since the DB has no FK guarding `notes.folder_id → folders.project_id =
// notes.project_id`.
const patchNoteSchema = updateNoteSchema.omit({
  content: true,
  folderId: true,
});

// Move-only body. A dedicated endpoint keeps this orthogonal to the
// Yjs-coupled `/:id` PATCH that silently strips `content`.
const moveNoteSchema = z.object({
  folderId: z.string().uuid().nullable(),
});

const pdfAnnotationsSchema = z.object({
  annotations: z.array(z.record(z.string(), z.unknown())).max(2000),
});

import { requireAuth } from "../middleware/auth";
import { canRead, canWrite, resolveRole } from "../lib/permissions";
import { isUuid } from "../lib/validators";
import { plateValueToText } from "../lib/plate-text";
import { moveNote } from "../lib/tree-queries";
import { emitTreeEvent } from "../lib/tree-events";
import { refreshNoteChunkIndexBestEffort } from "../lib/note-chunk-refresh";
import {
  createTreeNode,
  softDeleteTreeNode,
} from "../lib/project-tree-service";
import type { AppEnv } from "../lib/types";

const TRASH_RETENTION_DAYS = 30;
const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

function trashExpiresAt(deletedAt: Date): Date {
  return new Date(deletedAt.getTime() + TRASH_RETENTION_MS);
}

async function findReadableSourcePdfNote(noteId: string) {
  const [note] = await db
    .select({
      id: notes.id,
      workspaceId: notes.workspaceId,
      projectId: notes.projectId,
      type: notes.type,
      sourceType: notes.sourceType,
      sourceFileKey: notes.sourceFileKey,
      mimeType: notes.mimeType,
    })
    .from(notes)
    .where(and(eq(notes.id, noteId), isNull(notes.deletedAt)))
    .limit(1);
  return note ?? null;
}

function isPdfSourceNote(
  note: Awaited<ReturnType<typeof findReadableSourcePdfNote>>,
): note is NonNullable<Awaited<ReturnType<typeof findReadableSourcePdfNote>>> {
  return Boolean(
    note
      && note.type === "source"
      && note.sourceType === "pdf"
      && note.sourceFileKey
      && (!note.mimeType || note.mimeType === "application/pdf"),
  );
}

async function purgeExpiredTrash(workspaceId: string): Promise<void> {
  const cutoff = new Date(Date.now() - TRASH_RETENTION_MS).toISOString();
  const expired = await db
    .select({ id: notes.id })
    .from(notes)
    .where(
      and(
        eq(notes.workspaceId, workspaceId),
        isNotNull(notes.deletedAt),
        sql`${notes.deletedAt} < ${cutoff}::timestamptz`,
      ),
    );
  if (expired.length === 0) return;

  const expiredIds = expired.map((note) => note.id);
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      DELETE FROM project_tree_nodes
       WHERE target_table = 'notes'
         AND target_id IN (${sql.join(
           expiredIds.map((id) => sql`${id}::uuid`),
           sql`, `,
         )})
    `);
    await tx.execute(sql`
      DELETE FROM notes
       WHERE id IN (${sql.join(
         expiredIds.map((id) => sql`${id}::uuid`),
         sql`, `,
       )})
    `);
  });
}

export const noteRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)

  .get("/by-project/:projectId", async (c) => {
    const user = c.get("user");
    const projectId = c.req.param("projectId");
    if (!isUuid(projectId)) return c.json({ error: "Bad Request" }, 400);
    if (!(await canRead(user.id, { type: "project", id: projectId })))
      return c.json({ error: "Forbidden" }, 403);
    const rows = await db
      .select()
      .from(notes)
      .where(and(eq(notes.projectId, projectId), isNull(notes.deletedAt)))
      .orderBy(desc(notes.updatedAt));

    // Filter notes with inheritParent=false: per-user pagePermission required
    const maybePrivate = rows.filter((n) => n.inheritParent === false);
    if (maybePrivate.length === 0) return c.json(rows);

    const privateChecks = await Promise.all(
      maybePrivate.map(async (n) => ({
        id: n.id,
        ok: await canRead(user.id, { type: "note", id: n.id }),
      })),
    );
    const blockedIds = new Set(
      privateChecks.filter((x) => !x.ok).map((x) => x.id),
    );
    return c.json(rows.filter((n) => !blockedIds.has(n.id)));
  })

  .get("/search", async (c) => {
    const user = c.get("user");
    const q = c.req.query("q")?.trim() ?? "";
    const projectId = c.req.query("projectId") ?? "";
    if (q.length < 1 || !isUuid(projectId))
      return c.json({ error: "Bad Request" }, 400);
    if (!(await canRead(user.id, { type: "project", id: projectId })))
      return c.json({ error: "Forbidden" }, 403);
    const rows = await db
      .select({ id: notes.id, title: notes.title, updatedAt: notes.updatedAt })
      .from(notes)
      .where(
        and(
          eq(notes.projectId, projectId),
          isNull(notes.deletedAt),
          // ilike for case-insensitive substring
          sql`${notes.title} ILIKE ${"%" + q + "%"}`,
        ),
      )
      .orderBy(desc(notes.updatedAt))
      .limit(10);
    return c.json(rows);
  })

  .get("/trash", async (c) => {
    const user = c.get("user");
    const workspaceId = c.req.query("workspaceId") ?? "";
    if (!isUuid(workspaceId)) return c.json({ error: "Bad Request" }, 400);
    if (!(await canWrite(user.id, { type: "workspace", id: workspaceId }))) {
      return c.json({ error: "Forbidden" }, 403);
    }
    await purgeExpiredTrash(workspaceId);
    const rows = await db
      .select({
        id: notes.id,
        title: notes.title,
        projectId: notes.projectId,
        projectName: projects.name,
        deletedAt: notes.deletedAt,
        updatedAt: notes.updatedAt,
      })
      .from(notes)
      .innerJoin(projects, eq(projects.id, notes.projectId))
      .where(
        and(eq(notes.workspaceId, workspaceId), isNotNull(notes.deletedAt)),
      )
      .orderBy(desc(notes.deletedAt))
      .limit(100);
    return c.json({
      notes: rows.map((n) => ({
        id: n.id,
        title: n.title,
        projectId: n.projectId,
        projectName: n.projectName,
        deletedAt: n.deletedAt?.toISOString() ?? null,
        expiresAt: n.deletedAt
          ? trashExpiresAt(n.deletedAt).toISOString()
          : null,
        updatedAt: n.updatedAt.toISOString(),
      })),
    });
  })

  // Role lookup — server-rendered note page uses this to compute `readOnly`
  // before handing off to the Yjs-backed editor. Registered BEFORE the generic
  // `/:id` so Hono's router doesn't treat "role" as a UUID (which would 400).
  // Returns 403 for roles=none so UI can show "no access" without leaking
  // existence via the 200/404 split.
  .get("/:id/role", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
    const role = await resolveRole(user.id, { type: "note", id });
    if (role === "none") return c.json({ error: "Forbidden" }, 403);
    return c.json({ role });
  })

  .get("/:id/backlinks", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "bad-request" }, 400);
    if (!(await canRead(user.id, { type: "note", id }))) {
      return c.json({ error: "forbidden" }, 403);
    }

    // JOIN wiki_links → notes (source) → projects (for project name).
    // Exclude soft-deleted source notes.
    const rows = await db
      .select({
        id: notes.id,
        title: notes.title,
        projectId: notes.projectId,
        projectName: projects.name,
        updatedAt: notes.updatedAt,
        inheritParent: notes.inheritParent,
      })
      .from(wikiLinks)
      .innerJoin(notes, eq(notes.id, wikiLinks.sourceNoteId))
      .innerJoin(projects, eq(projects.id, notes.projectId))
      .where(and(eq(wikiLinks.targetNoteId, id), isNull(notes.deletedAt)))
      .orderBy(desc(notes.updatedAt));

    // Per-row canRead for private (inheritParent=false) source notes.
    // Mirrors the over-fetch + filter pattern used by mentions.ts.
    const visible: Array<{
      id: string;
      title: string;
      projectId: string;
      projectName: string;
      updatedAt: string;
    }> = [];
    for (const row of rows) {
      if (row.inheritParent === false) {
        if (!(await canRead(user.id, { type: "note", id: row.id }))) continue;
      } else {
        if (!(await canRead(user.id, { type: "project", id: row.projectId })))
          continue;
      }
      visible.push({
        id: row.id,
        title: row.title,
        projectId: row.projectId,
        projectName: row.projectName,
        updatedAt: row.updatedAt.toISOString(),
      });
    }

    return c.json({ data: visible, total: visible.length });
  })

  // Spec B (Content-Aware Enrichment) — read-side for the H4 panel. Single
  // row per note (unique index on note_id), so this is a point lookup.
  // Returns 404 when no artifact exists; the panel renders an empty state in
  // that case rather than hiding itself, so the toggle stays useful even on
  // notes ingested before the worker enrichment branch was on.
  .get("/:id/enrichment", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "bad-request" }, 400);
    if (!(await canRead(user.id, { type: "note", id }))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const [row] = await db
      .select()
      .from(noteEnrichments)
      .where(eq(noteEnrichments.noteId, id))
      .limit(1);
    if (!row) return c.json({ error: "no_enrichment" }, 404);
    return c.json({
      noteId: row.noteId,
      contentType: row.contentType,
      status: row.status,
      artifact: row.artifact,
      provider: row.provider,
      skipReasons: row.skipReasons ?? [],
      error: row.error,
      updatedAt: row.updatedAt.toISOString(),
    });
  })

  .get("/:id/pdf-annotations", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
    if (!(await canRead(user.id, { type: "note", id }))) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const note = await findReadableSourcePdfNote(id);
    if (!note) return c.json({ error: "Not found" }, 404);
    if (!isPdfSourceNote(note)) return c.json({ error: "not_pdf_source" }, 409);

    const [row] = await db
      .select({
        annotations: sourcePdfAnnotations.annotations,
        updatedAt: sourcePdfAnnotations.updatedAt,
      })
      .from(sourcePdfAnnotations)
      .where(eq(sourcePdfAnnotations.noteId, id))
      .limit(1);

    return c.json({
      noteId: id,
      annotations: row?.annotations ?? [],
      updatedAt: row?.updatedAt?.toISOString() ?? null,
    });
  })

  .put(
    "/:id/pdf-annotations",
    zValidator("json", pdfAnnotationsSchema),
    async (c) => {
      const user = c.get("user");
      const id = c.req.param("id");
      if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
      if (!(await canRead(user.id, { type: "note", id }))) {
        return c.json({ error: "Forbidden" }, 403);
      }
      const note = await findReadableSourcePdfNote(id);
      if (!note) return c.json({ error: "Not found" }, 404);
      if (!isPdfSourceNote(note)) return c.json({ error: "not_pdf_source" }, 409);
      if (!(await canWrite(user.id, { type: "note", id }))) {
        return c.json({ error: "Forbidden" }, 403);
      }

      const { annotations } = c.req.valid("json");
      const [row] = await db
        .insert(sourcePdfAnnotations)
        .values({
          noteId: id,
          workspaceId: note.workspaceId,
          projectId: note.projectId,
          annotations,
          updatedBy: user.id,
        })
        .onConflictDoUpdate({
          target: sourcePdfAnnotations.noteId,
          set: {
            workspaceId: note.workspaceId,
            projectId: note.projectId,
            annotations,
            updatedBy: user.id,
            updatedAt: new Date(),
          },
        })
        .returning({
          noteId: sourcePdfAnnotations.noteId,
          annotations: sourcePdfAnnotations.annotations,
          updatedAt: sourcePdfAnnotations.updatedAt,
        });

      return c.json({
        noteId: row.noteId,
        annotations: row.annotations,
        updatedAt: row.updatedAt.toISOString(),
      });
    },
  )

  .get("/:id", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
    if (!(await canRead(user.id, { type: "note", id })))
      return c.json({ error: "Forbidden" }, 403);
    const [note] = await db
      .select()
      .from(notes)
      .where(and(eq(notes.id, id), isNull(notes.deletedAt)));
    if (!note) return c.json({ error: "Not found" }, 404);
    return c.json(note);
  })

  .post("/", zValidator("json", createNoteSchema), async (c) => {
    const user = c.get("user");
    const body = c.req.valid("json");
    // write-access on project required
    if (!(await canWrite(user.id, { type: "project", id: body.projectId })))
      return c.json({ error: "Forbidden" }, 403);
    // derive workspaceId from project (notes.workspaceId is NOT NULL, denormalized for query speed)
    const [proj] = await db
      .select({ workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, body.projectId));
    if (!proj) return c.json({ error: "Project not found" }, 404);
    let treeParentId = body.parentTreeNodeId ?? null;
    let legacyFolderId = body.folderId ?? null;
    if (treeParentId) {
      const [parent] = await db
        .select({
          projectId: projectTreeNodes.projectId,
          targetTable: projectTreeNodes.targetTable,
          targetId: projectTreeNodes.targetId,
          deletedAt: projectTreeNodes.deletedAt,
        })
        .from(projectTreeNodes)
        .where(eq(projectTreeNodes.id, treeParentId));
      if (!parent || parent.deletedAt || parent.projectId !== body.projectId) {
        return c.json({ error: "parent tree node not found in project" }, 400);
      }
      legacyFolderId =
        parent.targetTable === "folders" ? parent.targetId : null;
    } else {
      treeParentId = legacyFolderId;
    }
    // For canvas notes, contentText holds raw source code (validated to ≤64KB by Zod).
    // For Plate-content notes, derive from the Plate value so FTS/embedding stays in sync.
    const contentText =
      body.contentText ?? (body.content ? plateValueToText(body.content) : "");
    const { parentTreeNodeId: _parentTreeNodeId, ...noteBody } = body;
    const note = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(notes)
        .values({
          ...noteBody,
          folderId: legacyFolderId,
          workspaceId: proj.workspaceId,
          contentText,
        })
        .returning();
      await createTreeNode(
        {
          id: created.id,
          workspaceId: proj.workspaceId,
          projectId: created.projectId,
          parentId: treeParentId,
          kind: "note",
          targetTable: "notes",
          targetId: created.id,
          label: created.title,
          icon: "file-text",
          position: 0,
          metadata: {
            sourceType: created.sourceType,
            noteType: created.type,
          },
        },
        tx,
      );
      return created;
    });
    await refreshNoteChunkIndexBestEffort(note);

    emitTreeEvent({
      kind: "tree.note_created",
      projectId: note.projectId,
      id: note.id,
      parentId: treeParentId,
      label: note.title,
      at: new Date().toISOString(),
    });

    return c.json(note, 201);
  })

  // Move endpoint. Registered BEFORE `/:id` so the literal `move` suffix
  // matches before Hono considers `/:id` a candidate. Uses moveNote which
  // enforces project scope; emits tree.note_moved after the write commits.
  .patch("/:id/move", zValidator("json", moveNoteSchema), async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
    if (!(await canWrite(user.id, { type: "note", id }))) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const [current] = await db
      .select({ projectId: notes.projectId, folderId: notes.folderId })
      .from(notes)
      .where(and(eq(notes.id, id), isNull(notes.deletedAt)));
    if (!current) return c.json({ error: "Not found" }, 404);

    const { folderId: newFolderId } = c.req.valid("json");
    try {
      await moveNote({
        projectId: current.projectId,
        noteId: id,
        newFolderId,
      });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }

    emitTreeEvent({
      kind: "tree.note_moved",
      projectId: current.projectId,
      id,
      parentId: newFolderId,
      at: new Date().toISOString(),
    });
    return c.json({ ok: true });
  })

  // Plan 7 Phase 1: dedicated canvas write surface. The shared `/:id` PATCH
  // strips `content` because Plan 2B made Yjs canonical for Plate notes —
  // canvas notes don't use Yjs (single-user, no collab), so they need a
  // separate route that writes `content_text` directly without touching
  // `yjs_documents`. Triage order is intentionally stricter than GET `/:id`:
  // canRead → exists → sourceType=='canvas' → canWrite. canRead-fail returns
  // 404 (hide existence) rather than 403, because writes are the only thing
  // this surface does — leaking existence buys nothing.
  .patch("/:id/canvas", zValidator("json", patchCanvasSchema), async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);

    if (!(await canRead(user.id, { type: "note", id }))) {
      return c.json({ error: "Not Found" }, 404);
    }

    const [note] = await db
      .select()
      .from(notes)
      .where(eq(notes.id, id))
      .limit(1);
    if (!note || note.deletedAt) return c.json({ error: "Not Found" }, 404);

    if (note.sourceType !== "canvas") {
      return c.json({ error: "notCanvas" }, 409);
    }

    if (!(await canWrite(user.id, { type: "note", id }))) {
      return c.json({ error: "Forbidden" }, 403);
    }

    const body = c.req.valid("json");
    const [updated] = await db
      .update(notes)
      .set({
        contentText: body.source,
        ...(body.language !== undefined
          ? { canvasLanguage: body.language }
          : {}),
      })
      .where(eq(notes.id, id))
      .returning({
        id: notes.id,
        contentText: notes.contentText,
        canvasLanguage: notes.canvasLanguage,
        updatedAt: notes.updatedAt,
      });

    await refreshNoteChunkIndexBestEffort({
      id,
      workspaceId: note.workspaceId,
      projectId: note.projectId,
      title: note.title,
      contentText: updated.contentText,
      deletedAt: note.deletedAt,
    });

    return c.json(updated, 200);
  })

  // Plan 2B: content/content_text are now Yjs-canonical — persisted only by
  // Hocuspocus `onStoreDocument`. PATCH accepts meta fields only; any
  // `content` key in the request body is stripped by the Zod schema (.omit)
  // so stale clients don't silently clobber the collaborative state.
  .patch("/:id", zValidator("json", patchNoteSchema), async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
    if (!(await canWrite(user.id, { type: "note", id })))
      return c.json({ error: "Forbidden" }, 403);
    const body = c.req.valid("json");
    // Capture prev title to detect rename deltas for SSE. folderId is
    // intentionally NOT fetched here — moves route through /:id/move.
    const [prev] = await db
      .select({ title: notes.title })
      .from(notes)
      .where(and(eq(notes.id, id), isNull(notes.deletedAt)));
    if (!prev) return c.json({ error: "Not found" }, 404);
    const [note] = await db.transaction(async (tx) => {
      const updatedRows = await tx
        .update(notes)
        .set(body)
        .where(and(eq(notes.id, id), isNull(notes.deletedAt)))
        .returning();
      const updated = updatedRows[0];
      if (updated && body.title !== undefined) {
        await tx
          .update(projectTreeNodes)
          .set({ label: body.title })
          .where(
            and(
              eq(projectTreeNodes.projectId, updated.projectId),
              eq(projectTreeNodes.targetTable, "notes"),
              eq(projectTreeNodes.targetId, updated.id),
              isNull(projectTreeNodes.deletedAt),
            ),
          );
      }
      return updatedRows;
    });
    if (!note) return c.json({ error: "Not found" }, 404);

    const renamed = body.title !== undefined && body.title !== prev.title;
    if (renamed) {
      emitTreeEvent({
        kind: "tree.note_renamed",
        projectId: note.projectId,
        id: note.id,
        parentId: note.folderId,
        label: note.title,
        at: new Date().toISOString(),
      });
    }
    if (renamed) {
      await refreshNoteChunkIndexBestEffort(note);
    }

    return c.json(note);
  })

  .delete("/:id", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
    if (!(await canWrite(user.id, { type: "note", id })))
      return c.json({ error: "Forbidden" }, 403);
    const [current] = await db
      .select({
        projectId: notes.projectId,
        workspaceId: notes.workspaceId,
        folderId: notes.folderId,
      })
      .from(notes)
      .where(and(eq(notes.id, id), isNull(notes.deletedAt)));
    if (!current) return c.json({ error: "Not found" }, 404);
    await purgeExpiredTrash(current.workspaceId);

    const [treeNode] = await db
      .select({ id: projectTreeNodes.id, parentId: projectTreeNodes.parentId })
      .from(projectTreeNodes)
      .where(
        and(
          eq(projectTreeNodes.projectId, current.projectId),
          eq(projectTreeNodes.targetTable, "notes"),
          eq(projectTreeNodes.targetId, id),
          isNull(projectTreeNodes.deletedAt),
        ),
      );
    if (treeNode) {
      await softDeleteTreeNode({
        projectId: current.projectId,
        nodeId: treeNode.id,
      });
    } else {
      await db
        .update(notes)
        .set({ deletedAt: new Date() })
        .where(and(eq(notes.id, id), isNull(notes.deletedAt)));
    }

    emitTreeEvent({
      kind: "tree.note_deleted",
      projectId: current.projectId,
      id: treeNode?.id ?? id,
      parentId: treeNode?.parentId ?? current.folderId,
      at: new Date().toISOString(),
    });

    return c.json({ success: true });
  })

  .post("/:id/restore", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
    const [current] = await db
      .select({ workspaceId: notes.workspaceId, projectId: notes.projectId })
      .from(notes)
      .where(and(eq(notes.id, id), isNotNull(notes.deletedAt)));
    if (!current) return c.json({ error: "Not found" }, 404);
    if (
      !(await canWrite(user.id, { type: "workspace", id: current.workspaceId }))
    ) {
      return c.json({ error: "Forbidden" }, 403);
    }
    await purgeExpiredTrash(current.workspaceId);
    const [note] = await db
      .update(notes)
      .set({ deletedAt: null })
      .where(eq(notes.id, id))
      .returning();
    const [treeNode] = await db
      .update(projectTreeNodes)
      .set({ deletedAt: null })
      .where(
        and(
          eq(projectTreeNodes.projectId, current.projectId),
          eq(projectTreeNodes.targetTable, "notes"),
          eq(projectTreeNodes.targetId, id),
        ),
      )
      .returning({
        id: projectTreeNodes.id,
        parentId: projectTreeNodes.parentId,
      });

    emitTreeEvent({
      kind: "tree.note_created",
      projectId: current.projectId,
      id: treeNode?.id ?? id,
      parentId: treeNode?.parentId ?? note!.folderId,
      label: note!.title,
      at: new Date().toISOString(),
    });
    return c.json(note);
  })

  .delete("/:id/permanent", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
    const [current] = await db
      .select({
        workspaceId: notes.workspaceId,
        projectId: notes.projectId,
        folderId: notes.folderId,
      })
      .from(notes)
      .where(and(eq(notes.id, id), isNotNull(notes.deletedAt)));
    if (!current) return c.json({ error: "Not found" }, 404);
    if (
      !(await canWrite(user.id, { type: "workspace", id: current.workspaceId }))
    ) {
      return c.json({ error: "Forbidden" }, 403);
    }
    await db.transaction(async (tx) => {
      await tx
        .delete(projectTreeNodes)
        .where(
          and(
            eq(projectTreeNodes.projectId, current.projectId),
            eq(projectTreeNodes.targetTable, "notes"),
            eq(projectTreeNodes.targetId, id),
          ),
        );
      await tx.delete(notes).where(eq(notes.id, id));
    });
    emitTreeEvent({
      kind: "tree.note_deleted",
      projectId: current.projectId,
      id,
      parentId: current.folderId,
      at: new Date().toISOString(),
    });
    return c.body(null, 204);
  });
