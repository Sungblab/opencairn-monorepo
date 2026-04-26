// Plan 5 KG Phase 2 · Task 11 · POST /api/visualize SSE entrypoint
//
// Public surface for the natural-language visualization path:
//   - Auth (better-auth session) → canRead on the project → per-user
//     concurrency lock → start `VisualizeWorkflow` on Temporal → wrap the
//     workflow handle as an SSE stream via `streamBuildView`.
//
// The deterministic path (`GET /api/projects/:id/graph?view=`) lives in
// `routes/graph.ts`; this route owns the LLM-cost path and is therefore
// gated by both per-user concurrency and zod's 500-char prompt cap.
//
// Lock model: an in-memory `Set<userId>` (see `lib/visualize-lock.ts`).
// Plan §5.6 specifies Redis SET-NX, but apps/api has no Redis client today
// (rate-limit.ts uses an identical in-memory store with the same single-
// instance caveat). Multi-instance prod deployment must swap this for a
// shared store before flag flip.

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { ViewType } from "@opencairn/shared";
import { db, projects, eq } from "@opencairn/db";
import { requireAuth } from "../middleware/auth";
import { canRead } from "../lib/permissions";
import { streamBuildView } from "../lib/temporal-visualize";
import { getTemporalClient, taskQueue } from "../lib/temporal-client";
import {
  tryAcquireVisualizeLock,
  releaseVisualizeLock,
} from "../lib/visualize-lock";
import type { AppEnv } from "../lib/types";

const visualizeBodySchema = z.object({
  projectId: z.string().uuid(),
  prompt: z.string().min(1).max(500),
  // Optional hint — when present the agent biases toward this view type.
  viewType: ViewType.optional(),
});

export const visualizeRouter = new Hono<AppEnv>().post(
  "/",
  requireAuth,
  zValidator("json", visualizeBodySchema),
  async (c) => {
    const userId = c.get("userId");
    const { projectId, prompt, viewType } = c.req.valid("json");

    // Auth on the project. canRead returns false for both not-found and
    // not-a-member to avoid leaking project existence — the spec treats
    // both as 403 because the prompt could otherwise probe project ids.
    if (!(await canRead(userId, { type: "project", id: projectId }))) {
      return c.json({ error: "forbidden" }, 403);
    }

    // Look up workspaceId from the project — the auth session doesn't
    // carry workspace context (plan-1 originally assumed it did, but the
    // session is workspace-agnostic). The Vis Agent activity needs it for
    // workspaceId-scoped tool calls (e.g. expand_concept_graph).
    const [proj] = await db
      .select({ workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, projectId));
    if (!proj) {
      // canRead already filtered this — defensive fallback in case a row
      // disappears between the canRead check and this lookup.
      return c.json({ error: "forbidden" }, 403);
    }

    // Per-user concurrency lock. Two parallel POSTs from the same user
    // race for the lock; only one acquires it. The other gets 429 with
    // a stable messageKey for the i18n-bound toast on the web side.
    if (!tryAcquireVisualizeLock(userId)) {
      return c.json(
        {
          error: "concurrent-visualize",
          messageKey: "graph.errors.concurrentVisualize",
        },
        429,
      );
    }

    let lockReleased = false;
    const release = () => {
      if (lockReleased) return;
      lockReleased = true;
      releaseVisualizeLock(userId);
    };

    try {
      const client = await getTemporalClient();
      const handle = await client.workflow.start("VisualizeWorkflow", {
        // The 1-activity worker workflow forwards `req` to `build_view`
        // verbatim — keep keys camelCase to match what the activity reads
        // (apps/worker/src/worker/activities/visualize_activity.py).
        args: [
          {
            projectId,
            workspaceId: proj.workspaceId,
            userId,
            prompt,
            viewType,
          },
        ],
        taskQueue: taskQueue(),
        // Unique per submission so two consecutive runs (after one
        // finishes) don't collide on workflowId. Date.now() is fine —
        // the per-user lock prevents within-millisecond duplicates.
        workflowId: `visualize-${userId}-${Date.now()}`,
      });

      const inner = streamBuildView(handle);

      // Wrap the inner stream so we always release the lock when the
      // response stream is done — covers both natural end-of-stream and
      // client cancellation. `flush` runs after the last chunk on a clean
      // close; `cancel` runs when the consumer aborts (browser disconnect,
      // tab close, fetch abort). Both are part of the WHATWG Streams
      // standard and supported on every runtime we ship to (Node 18+,
      // modern browsers); without `cancel` the lock would otherwise wait
      // for visualize-lock.ts's TTL (≈2 minutes) before releasing.
      const wrapped = inner.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            controller.enqueue(chunk);
          },
          flush() {
            release();
          },
          cancel() {
            release();
          },
        }),
      );

      return new Response(wrapped, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          // nginx + similar buffer SSE by default; this opts out so events
          // reach the browser as soon as the worker emits them.
          "X-Accel-Buffering": "no",
        },
      });
    } catch (e) {
      // workflow.start() blew up before we ever returned the stream — the
      // lock would otherwise leak until TTL. Release synchronously and
      // bubble the error to the global handler.
      release();
      throw e;
    }
  },
);
