import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import {
  db,
  chatMessages,
  chatThreads,
  messageFeedback,
  eq,
  and,
} from "@opencairn/db";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../lib/types";

// reason is optional and bounded — UI surfaces it as a free-text input next
// to the thumbs, so the cap is a soft DOS guard rather than a domain rule.
const postBody = z.object({
  message_id: z.string().uuid(),
  sentiment: z.enum(["positive", "negative"]),
  reason: z.string().trim().min(1).max(500).optional(),
});

const getQuery = z.object({ message_id: z.string().uuid() });

export const messageFeedbackRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)

  .post("/", zValidator("json", postBody), async (c) => {
    const userId = c.get("userId");
    const { message_id, sentiment, reason } = c.req.valid("json");

    const [msg] = await db
      .select({ threadId: chatMessages.threadId })
      .from(chatMessages)
      .where(eq(chatMessages.id, message_id));
    if (!msg) return c.json({ error: "not_found" }, 404);

    const [thread] = await db
      .select({ userId: chatThreads.userId })
      .from(chatThreads)
      .where(eq(chatThreads.id, msg.threadId));
    // Only the thread owner can rate messages in their conversation. Other
    // workspace members never see these messages, so 403 (not 404) is fine —
    // we don't leak existence beyond what the caller could discover anyway.
    if (!thread || thread.userId !== userId) {
      return c.json({ error: "forbidden" }, 403);
    }

    // Single feedback row per (message,user) — flipping thumbs replaces the
    // prior vote rather than stacking. createdAt is bumped on flip so the
    // row reflects the latest user action; the unique index makes the upsert
    // a deterministic no-conflict path.
    await db
      .insert(messageFeedback)
      .values({
        messageId: message_id,
        userId,
        sentiment,
        // reason is optional; explicit null clears a prior reason on flip.
        reason: reason ?? null,
      })
      .onConflictDoUpdate({
        target: [messageFeedback.messageId, messageFeedback.userId],
        set: {
          sentiment,
          reason: reason ?? null,
          createdAt: new Date(),
        },
      });

    return c.json({ ok: true }, 201);
  })

  .get("/", zValidator("query", getQuery), async (c) => {
    const userId = c.get("userId");
    const { message_id } = c.req.valid("query");

    // No permission check on the read — the unique index already restricts
    // hits to (message, caller); a non-owner querying someone else's message
    // simply returns null because no row exists for them.
    const [row] = await db
      .select({
        sentiment: messageFeedback.sentiment,
        reason: messageFeedback.reason,
      })
      .from(messageFeedback)
      .where(
        and(
          eq(messageFeedback.messageId, message_id),
          eq(messageFeedback.userId, userId),
        ),
      );

    if (!row) return c.json(null);
    return c.json({ sentiment: row.sentiment, reason: row.reason });
  });
