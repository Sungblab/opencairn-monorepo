import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { streamSSE } from "hono/streaming";
import {
  db,
  conversations,
  conversationMessages,
  pinnedAnswers,
  eq,
  and,
  desc,
  sql,
  type AttachedChip,
  type Citation,
} from "@opencairn/db";
import {
  CreateConversationBodySchema,
  PatchConversationBodySchema,
  AddChipBodySchema,
  PinBodySchema,
  SendMessageBodySchema,
} from "@opencairn/shared";
import { requireAuth } from "../middleware/auth";
import { canRead, canWrite } from "../lib/permissions";
import { validateScope, ScopeValidationError } from "../lib/chat-scope";
import { computePinDelta } from "../lib/pin-permissions";
import { tokensToKrw } from "../lib/cost";
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
  // Anchor the type extraction on the closed enum of chip types instead
  // of inferring from `lastIndexOf(":")`. The latter quietly corrupted
  // memory chip ids that themselves contain a colon (Plan 11B promised
  // broader id formats and `lastIndexOf` would have happily mis-parsed
  // `memory:l3:user:bob@example.com:l3-pin` → type=`memory:l3:user:...`).
  const KNOWN_TYPES = [
    "page",
    "project",
    "workspace",
    "memory:l3",
    "memory:l4",
    "memory:l2",
  ] as const;
  const matchedType = KNOWN_TYPES.find(
    (p) => chipKey === p || chipKey.startsWith(`${p}:`),
  );
  if (!matchedType || chipKey.length <= matchedType.length + 1) {
    return c.json({ error: "invalid chip key" }, 400);
  }
  const type = matchedType;
  const chipId = chipKey.slice(matchedType.length + 1);

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

// ── Pin (Plan 11A Task 5) ────────────────────────────────────────────────
//
// /pin runs the citation-visibility check; if any citation is hidden from
// a target-page reader, returns 409 with the delta payload so the client
// can show the warning modal. /pin/confirm is the explicit "I understand
// the leak" path — same write, different `reason` tag for audit.

async function doPin(opts: {
  userId: string;
  messageId: string;
  noteId: string;
  blockId: string;
  reason: string;
}): Promise<void> {
  await db.insert(pinnedAnswers).values({
    messageId: opts.messageId,
    noteId: opts.noteId,
    blockId: opts.blockId,
    pinnedBy: opts.userId,
    // The audit story relies on `reason` being either a fixed tag
    // ("no_permission_delta") or a JSON snapshot of the delta when the
    // user confirmed despite a warning. Future audit reads parse the
    // JSON when the value starts with "{".
    reason: opts.reason,
  });
}

async function loadPinContext(
  userId: string,
  messageId: string,
  noteId: string,
): Promise<
  | { ok: true; citations: Citation[] }
  | { ok: false; status: 403 | 404; error: string }
> {
  const [msg] = await db
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.id, messageId));
  if (!msg) return { ok: false, status: 404, error: "message not found" };

  const [convo] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, msg.conversationId));
  if (!convo) return { ok: false, status: 404, error: "conversation not found" };
  if (convo.ownerUserId !== userId) {
    return { ok: false, status: 403, error: "forbidden" };
  }

  if (!(await canWrite(userId, { type: "note", id: noteId }))) {
    return { ok: false, status: 403, error: "no write permission on target page" };
  }

  return { ok: true, citations: msg.citations as Citation[] };
}

chatRoutes.post(
  "/messages/:id/pin",
  zValidator("json", PinBodySchema),
  async (c) => {
    const userId = c.get("userId");
    const messageId = c.req.param("id");
    const { noteId, blockId } = c.req.valid("json");

    const ctx = await loadPinContext(userId, messageId, noteId);
    if (!ctx.ok) return c.json({ error: ctx.error }, ctx.status);

    let delta;
    try {
      delta = await computePinDelta(ctx.citations, noteId);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 404 || status === 413) {
        return c.json({ error: (e as Error).message }, status);
      }
      throw e;
    }

    if (delta.hiddenSources.length > 0) {
      // 409 Conflict — the request is well-formed but cannot proceed
      // without explicit confirmation that the visibility delta is
      // acceptable.
      return c.json({ requireConfirm: true, warning: delta }, 409);
    }
    await doPin({
      userId,
      messageId,
      noteId,
      blockId,
      reason: "no_permission_delta",
    });
    return c.json({ pinned: true });
  },
);

// ── Message SSE (Plan 11A Task 6) ───────────────────────────────────────
//
// 11A ships a *placeholder* SSE pipeline: the user message is persisted
// synchronously, then a canned assistant reply streams back as `delta`
// events terminated by `cost` and `done`. The real LLM-backed retrieval
// + generation lives in the Plan 4 worker; wiring that in is a 11B task.
// The contract emitted here is what the web ChatPanel parses today, so
// flipping the implementation later won't require client churn.
chatRoutes.post(
  "/message",
  zValidator("json", SendMessageBodySchema),
  async (c) => {
    const userId = c.get("userId");
    const { conversationId, content } = c.req.valid("json");

    const [convo] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    if (!convo) return c.json({ error: "not found" }, 404);
    if (convo.ownerUserId !== userId) {
      return c.json({ error: "forbidden" }, 403);
    }

    // Crude 4-chars-per-token estimate; replaced when the worker plumbs in
    // real provider usage records (Plan 11B / spec B AI Usage Visibility).
    const tokensInUser = Math.ceil(content.length / 4);
    const userCostKrw = tokensToKrw(tokensInUser, 0);
    await db.insert(conversationMessages).values({
      conversationId,
      role: "user",
      content,
      tokensIn: tokensInUser,
      tokensOut: 0,
      costKrw: String(userCostKrw),
    });

    return streamSSE(c, async (stream) => {
      const reply = "(11A placeholder reply)";
      for (const ch of reply) {
        await stream.writeSSE({
          event: "delta",
          data: JSON.stringify({ delta: ch }),
        });
        await stream.sleep(2);
      }
      const tokensOut = Math.ceil(reply.length / 4);
      const costKrw = tokensToKrw(0, tokensOut);
      const [assistant] = await db
        .insert(conversationMessages)
        .values({
          conversationId,
          role: "assistant",
          content: reply,
          citations: [],
          tokensIn: 0,
          tokensOut,
          costKrw: String(costKrw),
        })
        .returning();
      await db
        .update(conversations)
        .set({
          totalTokensIn: sql`${conversations.totalTokensIn} + ${tokensInUser}`,
          totalTokensOut: sql`${conversations.totalTokensOut} + ${tokensOut}`,
          totalCostKrw: sql`${conversations.totalCostKrw} + ${userCostKrw + costKrw}`,
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, conversationId));

      await stream.writeSSE({
        event: "cost",
        data: JSON.stringify({
          messageId: assistant.id,
          tokensIn: 0,
          tokensOut,
          costKrw,
        }),
      });
      await stream.writeSSE({ event: "done", data: "{}" });
    });
  },
);

chatRoutes.post(
  "/messages/:id/pin/confirm",
  zValidator("json", PinBodySchema),
  async (c) => {
    const userId = c.get("userId");
    const messageId = c.req.param("id");
    const { noteId, blockId } = c.req.valid("json");

    const ctx = await loadPinContext(userId, messageId, noteId);
    if (!ctx.ok) return c.json({ error: ctx.error }, ctx.status);

    // CRITICAL: recompute the delta on the confirm path so a scripted
    // client cannot bypass the modal by hitting /pin/confirm directly
    // — the original /pin response is just a hint. The recomputed
    // snapshot is what we audit. If the delta has shrunk to zero
    // between the two calls (e.g. an admin granted access in the
    // meantime), record that as `no_permission_delta`.
    let delta;
    try {
      delta = await computePinDelta(ctx.citations, noteId);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 404 || status === 413) {
        return c.json({ error: (e as Error).message }, status);
      }
      throw e;
    }

    const reason =
      delta.hiddenSources.length === 0
        ? "no_permission_delta"
        : JSON.stringify({
            tag: "user_confirmed_permission_warning",
            delta,
            confirmedAt: new Date().toISOString(),
          });

    await doPin({ userId, messageId, noteId, blockId, reason });
    return c.json({ pinned: true });
  },
);
