import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  db,
  conversations,
  eq,
  and,
  desc,
  type AttachedChip,
} from "@opencairn/db";
import {
  CreateConversationBodySchema,
  PatchConversationBodySchema,
  AddChipBodySchema,
} from "@opencairn/shared";
import { requireAuth } from "../middleware/auth";
import { canRead } from "../lib/permissions";
import { validateScope, ScopeValidationError } from "../lib/chat-scope";
import type { AppEnv } from "../lib/types";

// Plan 11A — /api/chat router. Each conversation is owned by exactly one
// user (`owner_user_id`). Workspace boundary is checked at every entry
// point: scopeId via validateScope, and the workspace itself via canRead.
// Chips and pin sub-routes are appended in their own route files (Plan 11A
// Tasks 4–6).
export const chatRoutes = new Hono<AppEnv>().use("*", requireAuth);

chatRoutes.post(
  "/conversations",
  zValidator("json", CreateConversationBodySchema),
  async (c) => {
    const userId = c.get("userId");
    const body = c.req.valid("json");

    if (!(await canRead(userId, { type: "workspace", id: body.workspaceId }))) {
      return c.json({ error: "forbidden" }, 403);
    }

    try {
      await validateScope(body.workspaceId, body.scopeType, body.scopeId);
    } catch (e) {
      if (e instanceof ScopeValidationError) {
        return c.json({ error: e.message }, e.status);
      }
      throw e;
    }

    const [row] = await db
      .insert(conversations)
      .values({
        workspaceId: body.workspaceId,
        ownerUserId: userId,
        title: body.title,
        scopeType: body.scopeType,
        scopeId: body.scopeId,
        attachedChips: body.attachedChips as AttachedChip[],
        ragMode: body.ragMode,
        memoryFlags: body.memoryFlags,
      })
      .returning();
    return c.json(row, 201);
  },
);

chatRoutes.patch(
  "/conversations/:id",
  zValidator("json", PatchConversationBodySchema),
  async (c) => {
    const userId = c.get("userId");
    const id = c.req.param("id");
    const [existing] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, id));
    if (!existing) return c.json({ error: "not found" }, 404);
    if (existing.ownerUserId !== userId) {
      return c.json({ error: "forbidden" }, 403);
    }

    const body = c.req.valid("json");
    const [row] = await db
      .update(conversations)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(conversations.id, id))
      .returning();
    return c.json(row);
  },
);

chatRoutes.get("/conversations/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const [row] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, id));
  if (!row) return c.json({ error: "not found" }, 404);
  if (row.ownerUserId !== userId) return c.json({ error: "forbidden" }, 403);
  return c.json(row);
});

chatRoutes.get("/conversations", async (c) => {
  const userId = c.get("userId");
  const workspaceId = c.req.query("workspaceId");
  if (!workspaceId) return c.json({ error: "workspaceId required" }, 400);
  if (!(await canRead(userId, { type: "workspace", id: workspaceId }))) {
    return c.json({ error: "forbidden" }, 403);
  }
  // Workspace+owner+updatedAt index keeps this list query index-only.
  const rows = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.workspaceId, workspaceId),
        eq(conversations.ownerUserId, userId),
      ),
    )
    .orderBy(desc(conversations.updatedAt));
  return c.json(rows);
});

// ── Chip add/remove (Plan 11A Task 4) ───────────────────────────────────
//
// Composite key for delete = `<type>:<id>`. The chipKey path param URL-
// encodes the colon, but Hono's parser hands us the decoded form. The
// dedupe pass keeps duplicate (type,id) rows from accumulating when a
// client racing two add requests with the same target both win.

function dedupeChips(arr: AttachedChip[]): AttachedChip[] {
  const seen = new Set<string>();
  return arr.filter((c) => {
    const k = `${c.type}:${c.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

chatRoutes.post(
  "/conversations/:id/chips",
  zValidator("json", AddChipBodySchema),
  async (c) => {
    const userId = c.get("userId");
    const id = c.req.param("id");
    const [convo] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, id));
    if (!convo) return c.json({ error: "not found" }, 404);
    if (convo.ownerUserId !== userId) {
      return c.json({ error: "forbidden" }, 403);
    }

    const { type, id: chipId } = c.req.valid("json");

    let label: string | undefined;
    if (type === "page" || type === "project" || type === "workspace") {
      // Workspace-scoped chip → resolve label and enforce boundary.
      try {
        const resolved = await validateScope(convo.workspaceId, type, chipId);
        label = resolved.label;
      } catch (e) {
        if (e instanceof ScopeValidationError) {
          return c.json({ error: e.message }, e.status);
        }
        throw e;
      }
    }
    // Memory chips (memory:l3 / memory:l4 / memory:l2) accepted as-is in
    // 11A — Plan 11B owns the workspace+user-scoped lookup. No label
    // because the UI does not render them yet.

    const next = dedupeChips([
      ...(convo.attachedChips as AttachedChip[]),
      { type, id: chipId, label, manual: true },
    ]);
    const [row] = await db
      .update(conversations)
      .set({ attachedChips: next, updatedAt: new Date() })
      .where(eq(conversations.id, id))
      .returning();
    return c.json(row);
  },
);

chatRoutes.delete("/conversations/:id/chips/:chipKey", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const chipKey = c.req.param("chipKey");
  // Memory chip types are themselves colon-delimited (`memory:l3`), and
  // chip ids in 11A never contain a colon (uuids for scope chips,
  // alphanumeric+underscore identifiers for memory chips). So the LAST
  // colon is always the type/id separator.
  const sep = chipKey.lastIndexOf(":");
  if (sep <= 0) return c.json({ error: "invalid chip key" }, 400);
  const type = chipKey.slice(0, sep);
  const chipId = chipKey.slice(sep + 1);

  const [convo] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, id));
  if (!convo) return c.json({ error: "not found" }, 404);
  if (convo.ownerUserId !== userId) {
    return c.json({ error: "forbidden" }, 403);
  }

  const next = (convo.attachedChips as AttachedChip[]).filter(
    (c) => !(c.type === type && c.id === chipId),
  );
  const [row] = await db
    .update(conversations)
    .set({ attachedChips: next, updatedAt: new Date() })
    .where(eq(conversations.id, id))
    .returning();
  return c.json(row);
});
