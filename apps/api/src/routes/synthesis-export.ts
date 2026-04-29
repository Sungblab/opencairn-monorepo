import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  db,
  eq,
  synthesisRuns,
  synthesisSources,
} from "@opencairn/db";
import {
  createSynthesisRunSchema,
  synthesisFormatValues,
  type SynthesisStreamEvent,
} from "@opencairn/shared";
import type { AppEnv } from "../lib/types";
import { requireAuth } from "../middleware/auth";
import { canWrite } from "../lib/permissions";
import { getTemporalClient } from "../lib/temporal-client";
import {
  startSynthesisExportRun,
  workflowIdFor,
} from "../lib/synthesis-export-client";

type SynthesisFormat = (typeof synthesisFormatValues)[number];

export const synthesisExportRouter = new Hono<AppEnv>();

function isFeatureEnabled(): boolean {
  return (
    (process.env.FEATURE_SYNTHESIS_EXPORT ?? "false").toLowerCase() === "true"
  );
}

// Wildcard 404 when the flag is off — don't leak route shape.
synthesisExportRouter.use("*", async (c, next) => {
  if (!isFeatureEnabled()) return c.json({ error: "not_found" }, 404);
  await next();
});

synthesisExportRouter.post(
  "/run",
  requireAuth,
  zValidator("json", createSynthesisRunSchema),
  async (c) => {
    const userId = c.get("userId")!;
    const body = c.req.valid("json");

    if (
      !(await canWrite(userId, { type: "workspace", id: body.workspaceId }))
    ) {
      return c.json({ error: "forbidden" }, 403);
    }

    const [run] = await db
      .insert(synthesisRuns)
      .values({
        workspaceId: body.workspaceId,
        projectId: body.projectId ?? null,
        userId,
        format: body.format,
        template: body.template,
        userPrompt: body.userPrompt,
        autoSearch: body.autoSearch,
        status: "pending",
      })
      .returning();

    const client = await getTemporalClient();
    await startSynthesisExportRun(client, {
      runId: run!.id,
      workspaceId: body.workspaceId,
      projectId: body.projectId ?? null,
      userId,
      format: body.format,
      template: body.template,
      userPrompt: body.userPrompt,
      explicitSourceIds: body.explicitSourceIds,
      noteIds: body.noteIds,
      autoSearch: body.autoSearch,
      byokKeyHandle: null,
    });

    await db
      .update(synthesisRuns)
      .set({ workflowId: workflowIdFor(run!.id) })
      .where(eq(synthesisRuns.id, run!.id));

    return c.json({ runId: run!.id });
  },
);

const POLL_MS = 2000;
const MAX_TICKS = (15 * 60 * 1000) / POLL_MS; // 15-minute upper bound

synthesisExportRouter.get("/runs/:id/stream", requireAuth, async (c) => {
  const id = c.req.param("id");
  if (!id) return c.json({ error: "not_found" }, 404);
  const userId = c.get("userId")!;

  const [run] = await db
    .select()
    .from(synthesisRuns)
    .where(eq(synthesisRuns.id, id));
  if (!run) return c.json({ error: "not_found" }, 404);
  if (!(await canWrite(userId, { type: "workspace", id: run.workspaceId }))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (ev: SynthesisStreamEvent) => {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`));
      };
      const keepalive = () =>
        controller.enqueue(enc.encode(`: keepalive\n\n`));

      send({ kind: "queued", runId: id });

      let lastStatus = run.status;
      let aborted = false;
      c.req.raw.signal?.addEventListener("abort", () => {
        aborted = true;
      });

      try {
        for (let tick = 0; tick < MAX_TICKS; tick++) {
          if (aborted) break;
          await new Promise((r) => setTimeout(r, POLL_MS));
          if (aborted) break;
          const [latest] = await db
            .select()
            .from(synthesisRuns)
            .where(eq(synthesisRuns.id, id));
          if (!latest) break;

          if (latest.status !== lastStatus) {
            if (latest.status === "fetching") {
              const sources = await db
                .select()
                .from(synthesisSources)
                .where(eq(synthesisSources.runId, id));
              send({ kind: "fetching_sources", count: sources.length });
            } else if (latest.status === "synthesizing") {
              send({ kind: "synthesizing" });
            } else if (latest.status === "compiling") {
              send({
                kind: "compiling",
                format: latest.format as SynthesisFormat,
              });
            }
            lastStatus = latest.status;
          }

          if (latest.status === "completed") {
            const sources = await db
              .select()
              .from(synthesisSources)
              .where(eq(synthesisSources.runId, id));
            send({
              kind: "done",
              docUrl: `/api/synthesis-export/runs/${id}/document?format=${latest.format}`,
              format: latest.format as SynthesisFormat,
              sourceCount: sources.filter((s) => s.included).length,
              tokensUsed: latest.tokensUsed ?? 0,
            });
            break;
          }
          if (latest.status === "failed") {
            send({ kind: "error", code: "workflow_failed" });
            break;
          }
          if (latest.status === "cancelled") {
            send({ kind: "error", code: "cancelled" });
            break;
          }

          if (tick % 5 === 0) keepalive();
        }
      } finally {
        try {
          controller.close();
        } catch {
          // controller may already be closed if the client aborted mid-flight.
        }
      }
    },
  });

  return c.body(stream, 200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
  });
});
