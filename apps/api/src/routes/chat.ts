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
  asc,
  sql,
  user,
  notes,
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
import { runChat } from "../lib/chat-llm";
import { getChatProvider } from "../lib/llm";
import {
  LLMNotConfiguredError,
  type ChatMsg,
  type Usage,
} from "../lib/llm/provider";
import type { RetrievalScope, RetrievalChip } from "../lib/chat-retrieval";
import type { AppEnv } from "../lib/types";
import { executeProjectObjectAction } from "../lib/project-object-actions";
import { emitTreeEvent } from "../lib/tree-events";

// /api/chat router. Each conversation is owned by exactly one
// user (`owner_user_id`). Workspace boundary is checked at every entry
// point: scopeId via validateScope, and the workspace itself via canRead.
// Chips and pin sub-routes are appended in their own route files.
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
      await validateScope(body.workspaceId, body.scopeType, body.scopeId, {
        userId,
      });
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

// ── Chip add/remove ─────────────────────────────────────────────────────
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
        const resolved = await validateScope(convo.workspaceId, type, chipId, {
          userId,
        });
        label = resolved.label;
      } catch (e) {
        if (e instanceof ScopeValidationError) {
          return c.json({ error: e.message }, e.status);
        }
        throw e;
      }
    }
    // Memory chips (memory:l3 / memory:l4 / memory:l2) accepted as-is in
    // Memory chips are accepted as-is here. No label
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
  // memory chip ids that themselves contain a colon. `lastIndexOf` would
  // have happily mis-parsed
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

// ── Pin ─────────────────────────────────────────────────────────────────
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
  if (!convo)
    return { ok: false, status: 404, error: "conversation not found" };
  if (convo.ownerUserId !== userId) {
    return { ok: false, status: 403, error: "forbidden" };
  }

  if (!(await canWrite(userId, { type: "note", id: noteId }))) {
    return {
      ok: false,
      status: 403,
      error: "no write permission on target page",
    };
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

// ── Message SSE ─────────────────────────────────────────────────────────
//
// Streams real Gemini responses via runChat(): retrieval reads
// attachedChips + ragMode, the provider streams text deltas, and token
// accounting comes from the provider-reported usageMetadata.
// LLMNotConfiguredError is mapped to an SSE `event: error` with code
// `llm_not_configured` so misconfigured operators get a visible signal
// rather than a silent failure.
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
    const [profile] = await db
      .select({ locale: user.locale, timezone: user.timezone })
      .from(user)
      .where(eq(user.id, userId));

    // Map conversation scope to retrieval scope.
    const scope: RetrievalScope =
      convo.scopeType === "page"
        ? {
            type: "page",
            workspaceId: convo.workspaceId,
            noteId: convo.scopeId,
          }
        : convo.scopeType === "project"
          ? {
              type: "project",
              workspaceId: convo.workspaceId,
              projectId: convo.scopeId,
            }
          : { type: "workspace", workspaceId: convo.workspaceId };

    // Filter chips: retrieval ignores memory:* in v1.
    const chips: RetrievalChip[] = (convo.attachedChips as AttachedChip[])
      .filter(
        (c) =>
          c.type === "page" || c.type === "project" || c.type === "workspace",
      )
      .map((c) => ({ type: c.type, id: c.id }) as RetrievalChip);

    // Replay last N turns of history (oldest-first). Tool rows fold to
    // assistant per spec §4.2 (renderer concats them visually).
    const histRows = await db
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, conversationId))
      .orderBy(asc(conversationMessages.createdAt));
    const history: ChatMsg[] = histRows.map((r) => ({
      role:
        r.role === "user"
          ? "user"
          : r.role === "assistant" || r.role === "tool"
            ? "assistant"
            : "system",
      content: r.content,
    }));

    // Persist the user row synchronously. We do NOT yet know the prompt
    // token count — fill it in below once Gemini reports usage. Leaving
    // tokensIn null means a mid-stream crash leaves an unbilled but
    // recoverable row for later usage backfill.
    const [userRow] = await db
      .insert(conversationMessages)
      .values({
        conversationId,
        role: "user",
        content,
        tokensIn: null,
        tokensOut: 0,
      })
      .returning();

    return streamSSE(c, async (stream) => {
      let provider;
      try {
        provider = getChatProvider();
      } catch (err) {
        const code =
          err instanceof LLMNotConfiguredError
            ? "llm_not_configured"
            : "llm_failed";
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({
            code,
            message: err instanceof Error ? err.message : "unknown",
          }),
        });
        await stream.writeSSE({ event: "done", data: "{}" });
        return;
      }

      const buffer: string[] = [];
      const citations: Citation[] = [];
      let usage: Usage | null = null;
      let saveSuggestion: { title: string; body_markdown: string } | null =
        null;

      try {
        for await (const chunk of runChat({
          workspaceId: convo.workspaceId,
          scope,
          ragMode: convo.ragMode,
          chips,
          history,
          userMessage: content,
          provider,
          mode: "auto",
          locale: profile?.locale ?? "ko",
          timezone: profile?.timezone ?? "Asia/Seoul",
          // Forward request abort signal so client cancels stop the
          // in-flight provider fetch instead of waiting for the next
          // yield boundary (matches Task 7's threads.ts pattern).
          signal: c.req.raw.signal,
        })) {
          if (chunk.type === "text") {
            const p = chunk.payload as { delta: string };
            buffer.push(p.delta);
            await stream.writeSSE({
              event: "delta",
              data: JSON.stringify({ delta: p.delta }),
            });
          } else if (chunk.type === "citation") {
            citations.push(chunk.payload as Citation);
          } else if (chunk.type === "usage") {
            usage = chunk.payload as Usage;
          } else if (chunk.type === "save_suggestion") {
            saveSuggestion = chunk.payload as {
              title: string;
              body_markdown: string;
            };
          } else if (chunk.type === "agent_file") {
            const projectId = await projectIdForConversationScope({
              scopeType: convo.scopeType,
              scopeId: convo.scopeId,
            });
            if (!projectId) {
              await stream.writeSSE({
                event: "error",
                data: JSON.stringify({
                  code: "agent_file_project_required",
                  message: "A project scope is required to create files.",
                }),
              });
              await stream.writeSSE({ event: "done", data: "{}" });
              return;
            }
            const payload = chunk.payload as {
              files: Array<{
                filename: string;
                title?: string;
                kind?: import("@opencairn/shared").AgentFileKind;
                mimeType?: string;
                content?: string;
                base64?: string;
                folderId?: string | null;
                startIngest?: boolean;
              }>;
            };
            for (const file of payload.files) {
              const result = await executeProjectObjectAction(
                { type: "create_project_object", object: file },
                {
                  context: {
                    userId,
                    workspaceId: convo.workspaceId,
                    projectId,
                  },
                },
              );
              if (!result.file || !result.compatibilityEvent) continue;
              const summary = result.file;
              emitTreeEvent({
                kind: "tree.agent_file_created",
                projectId: summary.projectId,
                id: summary.id,
                parentId: summary.folderId,
                label: summary.title,
                at: new Date().toISOString(),
              });
              await stream.writeSSE({
                event: result.event.type,
                data: JSON.stringify(result.event),
              });
              await stream.writeSSE({
                event: result.compatibilityEvent.type,
                data: JSON.stringify(result.compatibilityEvent),
              });
            }
          } else if (chunk.type === "verification") {
            await stream.writeSSE({
              event: "verification",
              data: JSON.stringify(chunk.payload),
            });
          } else if (chunk.type === "error") {
            const e = chunk.payload as {
              message: string;
              code?: string;
              messageKey?: string;
            };
            await stream.writeSSE({
              event: "error",
              data: JSON.stringify({
                code: e.code ?? "llm_failed",
                message: e.message,
                ...(e.messageKey ? { messageKey: e.messageKey } : {}),
              }),
            });
            await stream.writeSSE({ event: "done", data: "{}" });
            return;
          } else if (chunk.type === "done") {
            // runChat's finally yields a sentinel done; the route owns the
            // canonical outer done emitted post-persistence below.
            break;
          }
        }
      } catch (err) {
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({
            code: "llm_failed",
            message: err instanceof Error ? err.message : "unknown",
          }),
        });
        await stream.writeSSE({ event: "done", data: "{}" });
        return;
      }

      // Persist usage. Provider reports promptTokens (system+history+user)
      // and candidatesTokens (assistant). We split per spec §4.2: the
      // user's promptTokens go on the user row; the assistant's
      // candidatesTokens go on the assistant row.
      const tokensIn = usage?.tokensIn ?? 0;
      const tokensOut = usage?.tokensOut ?? 0;
      const userCostKrw = tokensToKrw(tokensIn, 0);
      const assistantCostKrw = tokensToKrw(0, tokensOut);

      await db
        .update(conversationMessages)
        .set({
          tokensIn,
          costKrw: String(userCostKrw),
        })
        .where(eq(conversationMessages.id, userRow.id));

      const reply = buffer.join("");
      const [assistant] = await db
        .insert(conversationMessages)
        .values({
          conversationId,
          role: "assistant",
          content: reply,
          citations,
          tokensIn: 0,
          tokensOut,
          costKrw: String(assistantCostKrw),
        })
        .returning();

      await db
        .update(conversations)
        .set({
          totalTokensIn: sql`${conversations.totalTokensIn} + ${tokensIn}`,
          totalTokensOut: sql`${conversations.totalTokensOut} + ${tokensOut}`,
          totalCostKrw: sql`${conversations.totalCostKrw} + ${userCostKrw + assistantCostKrw}`,
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, conversationId));

      if (saveSuggestion) {
        await stream.writeSSE({
          event: "save_suggestion",
          data: JSON.stringify(saveSuggestion),
        });
      }

      await stream.writeSSE({
        event: "cost",
        data: JSON.stringify({
          messageId: assistant.id,
          tokensIn: 0,
          tokensOut,
          costKrw: assistantCostKrw,
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

async function projectIdForConversationScope(input: {
  scopeType: string;
  scopeId: string;
}): Promise<string | null> {
  if (input.scopeType === "project") return input.scopeId;
  if (input.scopeType !== "page") return null;
  const [note] = await db
    .select({ projectId: notes.projectId })
    .from(notes)
    .where(eq(notes.id, input.scopeId))
    .limit(1);
  return note?.projectId ?? null;
}
