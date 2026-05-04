import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../lib/types";
import { isUuid } from "../lib/validators";
import {
  cancelChatRun,
  getChatRunForUser,
  streamChatRunEvents,
} from "../lib/chat-runs";

const eventsQuery = z.object({
  after: z.coerce.number().int().min(0).default(0),
});

export const chatRunRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get("/:id/events", zValidator("query", eventsQuery), async (c) => {
    const userId = c.get("userId");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "bad_request" }, 400);
    const run = await getChatRunForUser(id, userId);
    if (!run) return c.json({ error: "not_found" }, 404);
    const { after } = c.req.valid("query");
    return new Response(streamChatRunEvents(id, after), {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  })
  .post("/:id/cancel", async (c) => {
    const userId = c.get("userId");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "bad_request" }, 400);
    const run = await cancelChatRun(id, userId);
    if (!run) return c.json({ error: "not_found" }, 404);
    return c.json({ id, status: run.status });
  });
