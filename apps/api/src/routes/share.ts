import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  db,
  shareLinks,
  notes,
  user,
  yjsDocuments,
  eq,
  and,
  isNull,
  desc,
} from "@opencairn/db";
import { requireAuth } from "../middleware/auth";
import { requireWorkspaceRole } from "../middleware/require-role";
import { canRead, canWrite } from "../lib/permissions";
import { isUuid } from "../lib/validators";
import { checkRateLimit } from "../lib/rate-limit";
import {
  generateShareToken,
  isValidShareTokenFormat,
} from "../lib/share-token";
import { yjsStateToPlateValue, fallbackPlateValue } from "../lib/yjs-to-plate";
import type { AppEnv } from "../lib/types";

// Plan 2C — public share-link routes. Notion model: token = secret, no expiry,
// no password. Soft-revoke via revokedAt (idempotent DELETE).
//
// File hosts BOTH a no-auth public read (`GET /public/share/:token`) AND a set
// of admin/author-facing routes that require auth. The public route is
// registered BEFORE `shareRouter.use("*", requireAuth)` so the wildcard guard
// only attaches downstream. Same idiom as `routes/invites.ts`.

const PUBLIC_SHARE_RATE_MAX = 30;
const PUBLIC_SHARE_RATE_WINDOW_MS = 60_000;

const createShareSchema = z.object({
  role: z.enum(["viewer", "commenter"]),
});

export const shareRouter = new Hono<AppEnv>();

// ============================================================================
// PUBLIC routes (no auth) — registered before requireAuth wildcard.
// ============================================================================

shareRouter.get("/public/share/:token", async (c) => {
  const token = c.req.param("token");
  if (!isValidShareTokenFormat(token)) {
    return c.json({ error: "not_found" }, 404);
  }

  // Per-IP rate limit. Use the first hop in X-Forwarded-For if present.
  const ip =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    c.req.header("x-real-ip") ??
    "unknown";
  const rl = checkRateLimit(
    `share:public:${ip}`,
    PUBLIC_SHARE_RATE_MAX,
    PUBLIC_SHARE_RATE_WINDOW_MS,
  );
  if (!rl.allowed) {
    c.header("Retry-After", String(rl.retryAfterSec));
    return c.json({ error: "rate_limited" }, 429);
  }

  const [link] = await db
    .select({
      id: shareLinks.id,
      noteId: shareLinks.noteId,
      role: shareLinks.role,
    })
    .from(shareLinks)
    .where(and(eq(shareLinks.token, token), isNull(shareLinks.revokedAt)))
    .limit(1);
  if (!link) return c.json({ error: "not_found" }, 404);

  const [note] = await db
    .select({
      id: notes.id,
      title: notes.title,
      content: notes.content,
      yjsStateLoadedAt: notes.yjsStateLoadedAt,
      updatedAt: notes.updatedAt,
      deletedAt: notes.deletedAt,
    })
    .from(notes)
    .where(eq(notes.id, link.noteId))
    .limit(1);
  if (!note || note.deletedAt) return c.json({ error: "not_found" }, 404);

  // Resolve content: Yjs canonical when seeded, else fall back to legacy
  // notes.content. Either way the payload is a Plate value array.
  // yjs_documents is keyed by `name` (format: `page:<uuid>`), not by noteId.
  let plateValue;
  if (note.yjsStateLoadedAt) {
    const docName = `page:${note.id}`;
    const [yjsRow] = await db
      .select({ state: yjsDocuments.state })
      .from(yjsDocuments)
      .where(eq(yjsDocuments.name, docName))
      .limit(1);
    plateValue = yjsRow?.state
      ? yjsStateToPlateValue(yjsRow.state)
      : fallbackPlateValue(note.content);
  } else {
    plateValue = fallbackPlateValue(note.content);
  }

  // Sensitive fields (workspaceId, projectId, createdBy) intentionally
  // omitted from the response — public viewer must not learn the workspace
  // shape.
  return c.json({
    note: {
      id: note.id,
      title: note.title,
      role: link.role,
      plateValue,
      updatedAt: note.updatedAt.toISOString(),
    },
  });
});

// ============================================================================
// AUTH-required routes
// ============================================================================
// Apply requireAuth per-route rather than via `.use("*", ...)`. The wildcard
// form would fire on EVERY path that enters this sub-app — including paths
// only handled by other `/api` sub-apps mounted later (e.g. `/api/invites/...`,
// `/api/notes/...`). The middleware would 401 those before Hono falls through
// to the right handler. Per-route attachment keeps the auth scope tight.

shareRouter.post(
  "/notes/:id/share",
  requireAuth,
  zValidator("json", createShareSchema),
  async (c) => {
    const userId = c.get("userId");
    const noteId = c.req.param("id");
    if (!isUuid(noteId)) return c.json({ error: "Bad Request" }, 400);
    if (!(await canWrite(userId, { type: "note", id: noteId }))) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const { role } = c.req.valid("json");

    // Resolve workspaceId from the note (denormalized for SharedLinksTab).
    const [note] = await db
      .select({ workspaceId: notes.workspaceId })
      .from(notes)
      .where(and(eq(notes.id, noteId), isNull(notes.deletedAt)));
    if (!note) return c.json({ error: "Not found" }, 404);

    // Idempotent: same (noteId, role) active link → reuse existing token.
    const [existing] = await db
      .select()
      .from(shareLinks)
      .where(
        and(
          eq(shareLinks.noteId, noteId),
          eq(shareLinks.role, role),
          isNull(shareLinks.revokedAt),
        ),
      )
      .limit(1);
    if (existing) {
      return c.json(
        {
          id: existing.id,
          token: existing.token,
          role: existing.role,
          createdAt: existing.createdAt.toISOString(),
        },
        200,
      );
    }

    const token = generateShareToken();
    const [created] = await db
      .insert(shareLinks)
      .values({
        noteId,
        workspaceId: note.workspaceId,
        token,
        role,
        createdBy: userId,
      })
      .returning();

    return c.json(
      {
        id: created.id,
        token: created.token,
        role: created.role,
        createdAt: created.createdAt.toISOString(),
      },
      201,
    );
  },
);

shareRouter.get("/notes/:id/share", requireAuth, async (c) => {
  const userId = c.get("userId");
  const noteId = c.req.param("id");
  if (!isUuid(noteId)) return c.json({ error: "Bad Request" }, 400);
  if (!(await canRead(userId, { type: "note", id: noteId }))) {
    return c.json({ error: "Forbidden" }, 403);
  }
  const rows = await db
    .select({
      id: shareLinks.id,
      token: shareLinks.token,
      role: shareLinks.role,
      createdAt: shareLinks.createdAt,
      createdById: shareLinks.createdBy,
      createdByName: user.name,
    })
    .from(shareLinks)
    .leftJoin(user, eq(user.id, shareLinks.createdBy))
    .where(and(eq(shareLinks.noteId, noteId), isNull(shareLinks.revokedAt)))
    .orderBy(desc(shareLinks.createdAt));
  return c.json({
    links: rows.map((r) => ({
      id: r.id,
      token: r.token,
      role: r.role,
      createdAt: r.createdAt.toISOString(),
      createdBy: { id: r.createdById, name: r.createdByName ?? "" },
    })),
  });
});

shareRouter.delete("/share/:shareId", requireAuth, async (c) => {
  const userId = c.get("userId");
  const shareId = c.req.param("shareId");
  if (!isUuid(shareId)) return c.json({ error: "Bad Request" }, 400);

  const [link] = await db
    .select({
      id: shareLinks.id,
      noteId: shareLinks.noteId,
      createdBy: shareLinks.createdBy,
      revokedAt: shareLinks.revokedAt,
    })
    .from(shareLinks)
    .where(eq(shareLinks.id, shareId));
  // Already gone — idempotent. Treat as success so the UI can DELETE without
  // first querying GET.
  if (!link) return c.body(null, 204);

  // Authorization: creator OR canWrite on the note.
  if (link.createdBy !== userId) {
    if (!(await canWrite(userId, { type: "note", id: link.noteId }))) {
      return c.json({ error: "Forbidden" }, 403);
    }
  }

  // Idempotent: only set revokedAt on the first call. Second call is a no-op
  // but still returns 204 so callers can retry safely.
  if (!link.revokedAt) {
    await db
      .update(shareLinks)
      .set({ revokedAt: new Date() })
      .where(eq(shareLinks.id, shareId));
  }
  return c.body(null, 204);
});

shareRouter.get(
  "/workspaces/:workspaceId/share",
  requireAuth,
  requireWorkspaceRole("admin"),
  async (c) => {
    const wsId = c.req.param("workspaceId");
    if (!isUuid(wsId)) return c.json({ error: "Bad Request" }, 400);
    const rows = await db
      .select({
        id: shareLinks.id,
        token: shareLinks.token,
        role: shareLinks.role,
        noteId: shareLinks.noteId,
        noteTitle: notes.title,
        createdAt: shareLinks.createdAt,
        createdById: shareLinks.createdBy,
        createdByName: user.name,
      })
      .from(shareLinks)
      .innerJoin(notes, eq(notes.id, shareLinks.noteId))
      .leftJoin(user, eq(user.id, shareLinks.createdBy))
      .where(
        and(
          eq(shareLinks.workspaceId, wsId),
          isNull(shareLinks.revokedAt),
          isNull(notes.deletedAt),
        ),
      )
      .orderBy(desc(shareLinks.createdAt));
    return c.json({
      links: rows.map((r) => ({
        id: r.id,
        token: r.token,
        role: r.role,
        noteId: r.noteId,
        noteTitle: r.noteTitle,
        createdAt: r.createdAt.toISOString(),
        createdBy: { id: r.createdById, name: r.createdByName ?? "" },
      })),
    });
  },
);
