import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import {
  db,
  chatThreads,
  chatMessages,
  eq,
  and,
  desc,
  asc,
  isNull,
  notes,
} from "@opencairn/db";
import { requireAuth } from "../middleware/auth";
import { canRead } from "../lib/permissions";
import { isUuid } from "../lib/validators";
import type { AppEnv } from "../lib/types";
import { createAgentFile } from "../lib/agent-files";
import { emitTreeEvent } from "../lib/tree-events";
import {
  runAgent as defaultRunAgent,
  createStreamingAgentMessage,
  finalizeAgentMessage,
  type AgentChunk,
  type ChatMode,
} from "../lib/agent-pipeline";

const listQuery = z.object({ workspace_id: z.string().uuid() });
const createBody = z.object({
  workspace_id: z.string().uuid(),
  title: z.string().max(200).optional(),
});
const patchBody = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  archived: z.boolean().optional(),
});

// 8000 chars (~8 KB ASCII, more for multibyte) — keeps malformed clients
// from forcing the SSE path to enqueue an unbounded body.
const postMessageBody = z.object({
  content: z.string().trim().min(1).max(8000),
  scope: z.unknown().optional(),
  mode: z
    .enum(["auto", "fast", "balanced", "accurate", "research"])
    .default("auto"),
});

// Test seam — vitest swaps this via `__setRunAgentForTest` to inject failure
// paths without monkey-patching the module graph. Defaults to the real
// chat-llm pipeline from agent-pipeline.ts.
type RunAgentFn = (opts: {
  threadId: string;
  userMessage: { content: string; scope?: unknown };
  mode: ChatMode;
  signal?: AbortSignal;
  excludeMessageIds?: string[];
}) => AsyncGenerator<AgentChunk>;

let runAgentImpl: RunAgentFn = defaultRunAgent;

export function __setRunAgentForTest(impl: RunAgentFn | null): void {
  // Defensive guard: the symbol is unlikely to be exploited but the runtime
  // check documents intent and prevents production callers from swapping
  // the pipeline. Vitest sets VITEST=true by default.
  if (process.env.NODE_ENV !== "test" && process.env.VITEST !== "true") {
    throw new Error(
      "__setRunAgentForTest may only be called in test environments",
    );
  }
  runAgentImpl = impl ?? defaultRunAgent;
}

export const threadRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)

  .get("/", zValidator("query", listQuery), async (c) => {
    const userId = c.get("userId");
    const { workspace_id } = c.req.valid("query");
    if (!(await canRead(userId, { type: "workspace", id: workspace_id }))) {
      return c.json({ error: "forbidden" }, 403);
    }
    // Archived rows are hidden from the agent-panel sidebar. Soft delete keeps
    // the message history intact for billing/audit reads against the rows
    // directly.
    const rows = await db
      .select({
        id: chatThreads.id,
        title: chatThreads.title,
        updatedAt: chatThreads.updatedAt,
        createdAt: chatThreads.createdAt,
      })
      .from(chatThreads)
      .where(
        and(
          eq(chatThreads.workspaceId, workspace_id),
          eq(chatThreads.userId, userId),
          isNull(chatThreads.archivedAt),
        ),
      )
      .orderBy(desc(chatThreads.updatedAt));
    return c.json({
      threads: rows.map((r) => ({
        id: r.id,
        title: r.title,
        updated_at: r.updatedAt.toISOString(),
        created_at: r.createdAt.toISOString(),
      })),
    });
  })

  .post("/", zValidator("json", createBody), async (c) => {
    const userId = c.get("userId");
    const { workspace_id, title } = c.req.valid("json");
    if (!(await canRead(userId, { type: "workspace", id: workspace_id }))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const [row] = await db
      .insert(chatThreads)
      .values({
        workspaceId: workspace_id,
        userId,
        title: title ?? "",
      })
      .returning({ id: chatThreads.id, title: chatThreads.title });
    return c.json({ id: row.id, title: row.title }, 201);
  })

  .patch("/:id", zValidator("json", patchBody), async (c) => {
    const userId = c.get("userId");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "bad_request" }, 400);
    const { title, archived } = c.req.valid("json");
    // No-op when the body carries no recognized fields — avoids reordering the
    // sidebar by bumping updatedAt on an empty PATCH.
    if (title === undefined && archived === undefined) {
      return c.json({ ok: true });
    }
    const [row] = await db
      .select({ userId: chatThreads.userId })
      .from(chatThreads)
      .where(eq(chatThreads.id, id));
    if (!row) return c.json({ error: "not_found" }, 404);
    if (row.userId !== userId) return c.json({ error: "forbidden" }, 403);
    const now = new Date();
    await db
      .update(chatThreads)
      .set({
        updatedAt: now,
        ...(title !== undefined ? { title } : {}),
        ...(archived === true ? { archivedAt: now } : {}),
        ...(archived === false ? { archivedAt: null } : {}),
      })
      .where(eq(chatThreads.id, id));
    return c.json({ ok: true });
  })

  .delete("/:id", async (c) => {
    const userId = c.get("userId");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "bad_request" }, 400);
    const [row] = await db
      .select({ userId: chatThreads.userId })
      .from(chatThreads)
      .where(eq(chatThreads.id, id));
    if (!row) return c.json({ error: "not_found" }, 404);
    if (row.userId !== userId) return c.json({ error: "forbidden" }, 403);
    const now = new Date();
    await db
      .update(chatThreads)
      .set({ archivedAt: now, updatedAt: now })
      .where(eq(chatThreads.id, id));
    return c.json({ ok: true });
  })

  // Thread playback. Owner-only — same shape as PATCH/DELETE since chat
  // history is private to the user who started the thread (no team-chat
  // sharing in Phase 4).
  .get("/:id/messages", async (c) => {
    const userId = c.get("userId");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "bad_request" }, 400);

    const [thread] = await db
      .select({ userId: chatThreads.userId })
      .from(chatThreads)
      .where(eq(chatThreads.id, id));
    if (!thread) return c.json({ error: "not_found" }, 404);
    if (thread.userId !== userId) return c.json({ error: "forbidden" }, 403);

    const rows = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.threadId, id))
      .orderBy(asc(chatMessages.createdAt));

    return c.json({
      messages: rows.map((r) => ({
        id: r.id,
        role: r.role,
        status: r.status,
        content: r.content,
        mode: r.mode,
        provider: r.provider,
        created_at: r.createdAt.toISOString(),
      })),
    });
  })

  // SSE streaming send. Persists the user row synchronously, inserts an
  // empty agent placeholder (status='streaming'), then drives the agent
  // pipeline as an async generator and forwards each chunk. A single
  // UPDATE in `finally` finalizes the agent row regardless of how the
  // stream ends (clean / pipeline error / client abort), so the row never
  // ends up stuck in 'streaming'.
  .post(
    "/:id/messages",
    zValidator("json", postMessageBody),
    async (c) => {
      const userId = c.get("userId");
      const id = c.req.param("id");
      if (!isUuid(id)) return c.json({ error: "bad_request" }, 400);

      const [thread] = await db
        .select({ userId: chatThreads.userId })
        .from(chatThreads)
        .where(eq(chatThreads.id, id));
      if (!thread) return c.json({ error: "not_found" }, 404);
      if (thread.userId !== userId) return c.json({ error: "forbidden" }, 403);

      const { content, scope, mode } = c.req.valid("json");

      // User row is written synchronously — even if the SSE stream is
      // aborted before the first chunk, the prompt is preserved.
      const [userRow] = await db
        .insert(chatMessages)
        .values({
          threadId: id,
          role: "user",
          status: "complete",
          content: { body: content, scope },
          mode,
        })
        .returning({ id: chatMessages.id });

      // Bump thread updatedAt as soon as the user message lands so the
      // sidebar reorders on send rather than waiting for the agent stream
      // to finish — a 30s research turn shouldn't pin the thread to its
      // pre-send slot for the entire stream window.
      await db
        .update(chatThreads)
        .set({ updatedAt: new Date() })
        .where(eq(chatThreads.id, id));

      const { id: agentId } = await createStreamingAgentMessage(id, mode);

      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          let closed = false;
          const send = (event: string, data: unknown) => {
            if (closed) return;
            try {
              controller.enqueue(
                encoder.encode(
                  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
                ),
              );
            } catch {
              closed = true;
            }
          };

          const cleanup = () => {
            if (closed) return;
            closed = true;
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          };

          c.req.raw.signal.addEventListener("abort", cleanup, { once: true });

          send("user_persisted", { id: userRow.id });
          send("agent_placeholder", { id: agentId });

          const buffer: string[] = [];
          const meta: Record<string, unknown> = {};
          let streamStatus: "complete" | "failed" = "complete";
          try {
            for await (const chunk of runAgentImpl({
              threadId: id,
              userMessage: { content, scope },
              mode,
              // Forward the underlying Request abort signal so a client
              // disconnect cancels the in-flight provider fetch instead of
              // waiting for the next yield boundary.
              signal: c.req.raw.signal,
              // Skip the just-inserted user row + streaming agent placeholder
              // when reconstructing prior history — otherwise the current
              // turn would appear in its own context window (audit S2-026).
              excludeMessageIds: [userRow.id, agentId],
            })) {
              // Break early on client abort — async generators handle this
              // naturally on `break` (the generator's `return()` is invoked
              // implicitly), and `finally` below still runs to finalize the
              // row. Without this, we'd keep pulling chunks while every
              // `send` no-ops.
              if (closed) break;
              if (chunk.type === "done") {
                // chat-llm.runChat emits a sentinel `done` in its `finally`
                // block; the route emits its own canonical `done` after
                // persistence (with the agent message id + final status), so
                // suppress this one to avoid two `event: done` frames.
                // `done` is always the last chunk per runChat's contract, so
                // breaking is safe and skips the trailing iteration overhead.
                break;
              } else if (chunk.type === "text") {
                const p = chunk.payload as { delta: string };
                buffer.push(p.delta);
              } else if (chunk.type === "status") {
                meta.status = chunk.payload;
              } else if (chunk.type === "thought") {
                meta.thought = chunk.payload;
              } else if (chunk.type === "citation") {
                meta.citations = [
                  ...((meta.citations as unknown[]) ?? []),
                  chunk.payload,
                ];
              } else if (chunk.type === "save_suggestion") {
                meta.save_suggestion = chunk.payload;
              } else if (chunk.type === "agent_file") {
                const projectId = await projectIdFromScope(scope);
                if (!projectId) {
                  streamStatus = "failed";
                  meta.error = {
                    code: "agent_file_project_required",
                    message: "A project scope is required to create files.",
                  };
                  send("error", meta.error);
                  continue;
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
                const created = [];
                for (const file of payload.files) {
                  const summary = await createAgentFile({
                    userId,
                    projectId,
                    source: "agent_chat",
                    chatThreadId: id,
                    chatMessageId: agentId,
                    file,
                  });
                  emitTreeEvent({
                    kind: "tree.agent_file_created",
                    projectId: summary.projectId,
                    id: summary.id,
                    parentId: summary.folderId,
                    label: summary.title,
                    at: new Date().toISOString(),
                  });
                  created.push(summary);
                  send("agent_file_created", { file: summary });
                }
                meta.agent_files = [
                  ...((meta.agent_files as unknown[]) ?? []),
                  ...created,
                ];
              } else if (chunk.type === "usage") {
                // Lifted out of `content` and into `chat_messages.token_usage`
                // by finalizeAgentMessage — kept here only as a sidecar so
                // the route doesn't have to know the column shape.
                meta.usage = chunk.payload;
              } else if (chunk.type === "error") {
                // chat-llm yields a single `error` chunk before its terminal
                // `done`. Mark the persistence status as failed and record
                // the error context in meta; the SSE frame is forwarded
                // below via the regular `send`, so the client renderer sees
                // the failure without an extra branch.
                streamStatus = "failed";
                meta.error = chunk.payload;
              }
              send(chunk.type, chunk.payload);
            }
          } catch (err) {
            streamStatus = "failed";
            send("error", {
              message:
                err instanceof Error ? err.message : "agent_failed",
            });
          } finally {
            // Thread `updated_at` was bumped right after the user row was
            // persisted (above), so the sidebar already reordered when the
            // user hit send — finally only finalizes the agent row.
            await finalizeAgentMessage(
              agentId,
              { body: buffer.join(""), ...meta },
              streamStatus,
            );
          }

          send("done", { id: agentId, status: streamStatus });
          cleanup();
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    },
  );

async function projectIdFromScope(scope: unknown): Promise<string | null> {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) return null;
  const obj = scope as Record<string, unknown>;
  if (typeof obj.projectId === "string") return obj.projectId;
  if (typeof obj.id === "string" && obj.type === "project") return obj.id;
  const noteId =
    typeof obj.noteId === "string"
      ? obj.noteId
      : typeof obj.id === "string" && obj.type === "page"
        ? obj.id
        : null;
  if (noteId) {
    const [note] = await db
      .select({ projectId: notes.projectId })
      .from(notes)
      .where(and(eq(notes.id, noteId), isNull(notes.deletedAt)))
      .limit(1);
    return note?.projectId ?? null;
  }
  const chips = Array.isArray(obj.chips) ? obj.chips : [];
  for (const chip of chips) {
    if (
      chip &&
      typeof chip === "object" &&
      !Array.isArray(chip) &&
      (chip as Record<string, unknown>).type === "project" &&
      typeof (chip as Record<string, unknown>).id === "string"
    ) {
      return (chip as Record<string, string>).id;
    }
    if (
      chip &&
      typeof chip === "object" &&
      !Array.isArray(chip) &&
      (chip as Record<string, unknown>).type === "page" &&
      typeof (chip as Record<string, unknown>).id === "string"
    ) {
      const [note] = await db
        .select({ projectId: notes.projectId })
        .from(notes)
        .where(and(eq(notes.id, (chip as Record<string, string>).id), isNull(notes.deletedAt)))
        .limit(1);
      if (note?.projectId) return note.projectId;
    }
  }
  return null;
}
