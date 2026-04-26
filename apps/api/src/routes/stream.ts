// SSE streams under /api/stream. Phase 2 introduces the project tree
// stream; Phase 5 adds notifications. Follows the same native
// ReadableStream + Response pattern as apps/api/src/routes/import.ts.

import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { canRead } from "../lib/permissions";
import { isUuid } from "../lib/validators";
import { subscribeTreeEvents, type TreeEvent } from "../lib/tree-events";
import {
  subscribeNotifications,
  type NotificationEvent,
} from "../lib/notification-events";
import type { AppEnv } from "../lib/types";

const PING_INTERVAL_MS = 30_000;

export const streamRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get("/projects/:projectId/tree", async (c) => {
    const user = c.get("user");
    const projectId = c.req.param("projectId");
    if (!isUuid(projectId)) return c.json({ error: "Bad Request" }, 400);
    if (!(await canRead(user.id, { type: "project", id: projectId }))) {
      return c.json({ error: "Forbidden" }, 403);
    }

    const encoder = new TextEncoder();
    const signal = c.req.raw.signal;

    const stream = new ReadableStream({
      start(controller) {
        let closed = false;
        const send = (event: string, data: unknown) => {
          if (closed) return;
          try {
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
            );
          } catch {
            // Controller already closed (client aborted between send calls).
            closed = true;
          }
        };

        const unsubscribe = subscribeTreeEvents(projectId, (e: TreeEvent) => {
          send(e.kind, e);
        });

        // Periodic ping keeps intermediaries (nginx, Cloudflare) from
        // buffering / cutting the stream, and lets the client detect
        // broken connections.
        const pingTimer = setInterval(() => {
          send("ping", { at: new Date().toISOString() });
        }, PING_INTERVAL_MS);

        // Immediate "ready" so clients can assert the stream is open
        // before running assertions in tests or showing a "connected"
        // state in the UI.
        send("ready", { projectId });

        const cleanup = () => {
          if (closed) return;
          closed = true;
          clearInterval(pingTimer);
          unsubscribe();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        };

        signal.addEventListener("abort", cleanup, { once: true });
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
  })

  // App Shell Phase 5 Task 9 — per-user notifications SSE channel. Each
  // event uses the notification kind as the SSE event name so the client
  // can register kind-specific handlers (mention, comment_reply, ...).
  .get("/notifications", async (c) => {
    const user = c.get("user");
    const encoder = new TextEncoder();
    const signal = c.req.raw.signal;

    const stream = new ReadableStream({
      start(controller) {
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

        const unsubscribe = subscribeNotifications(
          user.id,
          (n: NotificationEvent) => send(n.kind, n),
        );

        const pingTimer = setInterval(() => {
          send("ping", { at: new Date().toISOString() });
        }, PING_INTERVAL_MS);

        send("ready", { at: new Date().toISOString() });

        const cleanup = () => {
          if (closed) return;
          closed = true;
          clearInterval(pingTimer);
          unsubscribe();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        };
        signal.addEventListener("abort", cleanup, { once: true });
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
  });
