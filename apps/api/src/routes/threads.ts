import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import {
  db,
  chatThreads,
  chatMessages,
  chatRuns,
  projects,
  eq,
  and,
  desc,
  asc,
  isNull,
  inArray,
} from "@opencairn/db";
import { requireAuth } from "../middleware/auth";
import { canRead } from "../lib/permissions";
import { isUuid } from "../lib/validators";
import type { AppEnv } from "../lib/types";
import {
  createDurableChatRun,
  setRunAgentForTest,
  startChatRun,
  streamChatRunEvents,
  type RunAgentFn,
} from "../lib/chat-runs";
import { billingPlanConfigs } from "@opencairn/shared";
import { getCreditBalance } from "../lib/billing";

const listQuery = z.object({ workspace_id: z.string().uuid() });
const createBody = z.object({
  workspace_id: z.string().uuid(),
  project_id: z.string().uuid().optional(),
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

const scopedListQuery = listQuery.extend({
  project_id: z.string().uuid().optional(),
});

function messagePreviewFromContent(content: unknown): string | null {
  if (!content || typeof content !== "object") return null;
  const body = (content as { body?: unknown }).body;
  if (typeof body !== "string") return null;
  const preview = body.replace(/\s+/g, " ").trim();
  if (!preview) return null;
  return preview.length > 72 ? `${preview.slice(0, 69)}...` : preview;
}

async function requireProjectRead(
  userId: string,
  workspaceId: string,
  projectId: string | null,
) {
  if (!projectId) return null;
  const [project] = await db
    .select({ workspaceId: projects.workspaceId })
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project || project.workspaceId !== workspaceId) {
    return { error: "not_found" as const, status: 404 as const };
  }
  if (!(await canRead(userId, { type: "project", id: projectId }))) {
    return { error: "forbidden" as const, status: 403 as const };
  }
  return null;
}

async function requireManagedChatCredits(userId: string) {
  const balance = await getCreditBalance(userId);
  if (!billingPlanConfigs[balance.plan].managedLlm) return null;
  if (balance.balanceCredits > 0) return null;
  return {
    error: "insufficient_credits" as const,
    status: 402 as const,
    requiredCredits: 1,
    availableCredits: balance.balanceCredits,
  };
}

export function __setRunAgentForTest(impl: RunAgentFn | null): void {
  setRunAgentForTest(impl);
}

export const threadRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)

  .get("/", zValidator("query", scopedListQuery), async (c) => {
    const userId = c.get("userId");
    const { workspace_id, project_id } = c.req.valid("query");
    if (!(await canRead(userId, { type: "workspace", id: workspace_id }))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const projectReadError = await requireProjectRead(
      userId,
      workspace_id,
      project_id ?? null,
    );
    if (projectReadError) {
      return c.json({ error: projectReadError.error }, projectReadError.status);
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
          project_id
            ? eq(chatThreads.projectId, project_id)
            : isNull(chatThreads.projectId),
          isNull(chatThreads.archivedAt),
        ),
      )
      .orderBy(desc(chatThreads.updatedAt));
    const previewByThreadId = new Map<string, string>();
    const threadIds = rows.map((r) => r.id);
    if (threadIds.length > 0) {
      const latestMessages = await db
        .select({
          threadId: chatMessages.threadId,
          content: chatMessages.content,
        })
        .from(chatMessages)
        .where(inArray(chatMessages.threadId, threadIds))
        .orderBy(desc(chatMessages.createdAt));
      for (const message of latestMessages) {
        if (previewByThreadId.has(message.threadId)) continue;
        const preview = messagePreviewFromContent(message.content);
        if (preview) previewByThreadId.set(message.threadId, preview);
      }
    }

    return c.json({
      threads: rows.map((r) => ({
        id: r.id,
        title: r.title,
        last_message_preview: previewByThreadId.get(r.id) ?? null,
        updated_at: r.updatedAt.toISOString(),
        created_at: r.createdAt.toISOString(),
      })),
    });
  })

  .post("/", zValidator("json", createBody), async (c) => {
    const userId = c.get("userId");
    const { workspace_id, project_id, title } = c.req.valid("json");
    if (!(await canRead(userId, { type: "workspace", id: workspace_id }))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const projectReadError = await requireProjectRead(
      userId,
      workspace_id,
      project_id ?? null,
    );
    if (projectReadError) {
      return c.json({ error: projectReadError.error }, projectReadError.status);
    }
    const [row] = await db
      .insert(chatThreads)
      .values({
        workspaceId: workspace_id,
        projectId: project_id ?? null,
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
      .select({
        userId: chatThreads.userId,
        workspaceId: chatThreads.workspaceId,
        projectId: chatThreads.projectId,
      })
      .from(chatThreads)
      .where(eq(chatThreads.id, id));
    if (!thread) return c.json({ error: "not_found" }, 404);
    if (thread.userId !== userId) return c.json({ error: "forbidden" }, 403);
    if (
      !(await canRead(userId, { type: "workspace", id: thread.workspaceId }))
    ) {
      return c.json({ error: "forbidden" }, 403);
    }
    const projectReadError = await requireProjectRead(
      userId,
      thread.workspaceId,
      thread.projectId,
    );
    if (projectReadError) {
      return c.json({ error: projectReadError.error }, projectReadError.status);
    }

    const rows = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.threadId, id))
      .orderBy(asc(chatMessages.createdAt));
    const agentIds = rows.filter((r) => r.role === "agent").map((r) => r.id);
    const runs = agentIds.length
      ? await db
          .select({
            id: chatRuns.id,
            agentMessageId: chatRuns.agentMessageId,
            status: chatRuns.status,
          })
          .from(chatRuns)
          .where(inArray(chatRuns.agentMessageId, agentIds))
      : [];
    const runByMessage = new Map(runs.map((run) => [run.agentMessageId, run]));

    return c.json({
      messages: rows.map((r) => ({
        id: r.id,
        role: r.role,
        status: r.status,
        run_id: runByMessage.get(r.id)?.id ?? null,
        run_status: runByMessage.get(r.id)?.status ?? null,
        content: r.content,
        token_usage: r.tokenUsage,
        mode: r.mode,
        provider: r.provider,
        created_at: r.createdAt.toISOString(),
      })),
    });
  })

  // Durable streaming send. Persists user + agent placeholder rows, creates
  // a chat run, starts the Temporal-owned executor, then subscribes this
  // browser request to the persisted event log. Client disconnect only
  // detaches from the stream; explicit /api/chat-runs/:id/cancel owns cancel.
  .post(
    "/:id/messages",
    zValidator("json", postMessageBody),
    async (c) => {
      const userId = c.get("userId");
      const id = c.req.param("id");
      if (!isUuid(id)) return c.json({ error: "bad_request" }, 400);

      const [thread] = await db
        .select({
          userId: chatThreads.userId,
          workspaceId: chatThreads.workspaceId,
          projectId: chatThreads.projectId,
        })
        .from(chatThreads)
        .where(eq(chatThreads.id, id));
      if (!thread) return c.json({ error: "not_found" }, 404);
      if (thread.userId !== userId) return c.json({ error: "forbidden" }, 403);
      if (
        !(await canRead(userId, { type: "workspace", id: thread.workspaceId }))
      ) {
        return c.json({ error: "forbidden" }, 403);
      }
      const projectReadError = await requireProjectRead(
        userId,
        thread.workspaceId,
        thread.projectId,
      );
      if (projectReadError) {
        return c.json(
          { error: projectReadError.error },
          projectReadError.status,
        );
      }
      const creditError = await requireManagedChatCredits(userId);
      if (creditError) {
        return c.json(
          {
            error: creditError.error,
            requiredCredits: creditError.requiredCredits,
            availableCredits: creditError.availableCredits,
          },
          creditError.status,
        );
      }

      const { content, scope, mode } = c.req.valid("json");
      const { runId } = await createDurableChatRun({
        threadId: id,
        workspaceId: thread.workspaceId,
        userId,
        content,
        scope,
        mode,
      });
      await startChatRun(runId);
      const stream = streamChatRunEvents(runId, 0);

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
