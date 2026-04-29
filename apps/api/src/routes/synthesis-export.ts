import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  and,
  db,
  desc,
  eq,
  sql,
  synthesisDocuments,
  synthesisRuns,
  synthesisSources,
} from "@opencairn/db";
import {
  createSynthesisRunSchema,
  resynthesizeSchema,
  synthesisFormatValues,
  synthesisTemplateValues,
  type SynthesisStreamEvent,
} from "@opencairn/shared";
import type { AppEnv } from "../lib/types";
import { requireAuth } from "../middleware/auth";
import { canWrite } from "../lib/permissions";
import { getTemporalClient } from "../lib/temporal-client";
import { streamObject } from "../lib/s3-get";
import {
  signalSynthesisExportCancel,
  startSynthesisExportRun,
  workflowIdFor,
} from "../lib/synthesis-export-client";

type SynthesisFormat = (typeof synthesisFormatValues)[number];
type SynthesisTemplate = (typeof synthesisTemplateValues)[number];

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

    // Generate the run id up front so we can persist the deterministic
    // workflowId at INSERT time. This avoids an "orphan workflow" window
    // where the workflow has been fired but the row UPDATE hasn't landed.
    const runId = crypto.randomUUID();

    const [run] = await db
      .insert(synthesisRuns)
      .values({
        id: runId,
        workspaceId: body.workspaceId,
        projectId: body.projectId ?? null,
        userId,
        format: body.format,
        template: body.template,
        userPrompt: body.userPrompt,
        autoSearch: body.autoSearch,
        status: "pending",
        workflowId: workflowIdFor(runId),
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
      c.req.raw.signal?.addEventListener(
        "abort",
        () => {
          aborted = true;
        },
        { once: true },
      );

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
            // Count only included sources — the synthesizer's filter pushed
            // others to included=false. Avoids hauling the full row set just
            // to length-filter in JS.
            const [{ count }] = await db
              .select({ count: sql<number>`count(*)::int` })
              .from(synthesisSources)
              .where(
                and(
                  eq(synthesisSources.runId, id),
                  eq(synthesisSources.included, true),
                ),
              );
            send({
              kind: "done",
              docUrl: `/api/synthesis-export/runs/${id}/document?format=${latest.format}`,
              format: latest.format as SynthesisFormat,
              sourceCount: count,
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

synthesisExportRouter.get("/runs", requireAuth, async (c) => {
  const userId = c.get("userId")!;
  const workspaceId = c.req.query("workspaceId");
  if (!workspaceId) return c.json({ error: "workspaceId required" }, 400);
  if (!(await canWrite(userId, { type: "workspace", id: workspaceId }))) {
    return c.json({ error: "forbidden" }, 403);
  }
  const rows = await db
    .select()
    .from(synthesisRuns)
    .where(eq(synthesisRuns.workspaceId, workspaceId))
    .orderBy(desc(synthesisRuns.createdAt))
    .limit(50);
  return c.json({
    runs: rows.map((r) => ({
      id: r.id,
      format: r.format,
      template: r.template,
      status: r.status,
      userPrompt: r.userPrompt,
      tokensUsed: r.tokensUsed,
      createdAt: r.createdAt.toISOString(),
    })),
  });
});

synthesisExportRouter.get("/runs/:id", requireAuth, async (c) => {
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
  const sources = await db
    .select()
    .from(synthesisSources)
    .where(eq(synthesisSources.runId, id));
  const documents = await db
    .select()
    .from(synthesisDocuments)
    .where(eq(synthesisDocuments.runId, id));
  return c.json({
    id: run.id,
    workspaceId: run.workspaceId,
    projectId: run.projectId,
    format: run.format,
    template: run.template,
    status: run.status,
    userPrompt: run.userPrompt,
    autoSearch: run.autoSearch,
    tokensUsed: run.tokensUsed,
    createdAt: run.createdAt.toISOString(),
    sources: sources.map((s) => ({
      id: s.id,
      sourceType: s.sourceType,
      sourceId: s.sourceId,
      title: s.title,
      tokenCount: s.tokenCount,
      included: s.included,
    })),
    documents: documents.map((d) => ({
      id: d.id,
      format: d.format,
      s3Key: d.s3Key,
      bytes: d.bytes,
      createdAt: d.createdAt.toISOString(),
    })),
  });
});

synthesisExportRouter.get("/runs/:id/document", requireAuth, async (c) => {
  const id = c.req.param("id");
  if (!id) return c.json({ error: "not_found" }, 404);
  const fmt = c.req.query("format");
  const userId = c.get("userId")!;

  const [run] = await db
    .select()
    .from(synthesisRuns)
    .where(eq(synthesisRuns.id, id));
  if (!run) return c.json({ error: "not_found" }, 404);
  if (!(await canWrite(userId, { type: "workspace", id: run.workspaceId }))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const docs = await db
    .select()
    .from(synthesisDocuments)
    .where(eq(synthesisDocuments.runId, id))
    .orderBy(desc(synthesisDocuments.createdAt));
  const target = fmt ? docs.find((d) => d.format === fmt) : docs[0];
  if (!target?.s3Key) return c.json({ error: "no_document" }, 404);

  const obj = await streamObject(target.s3Key);
  const filename = `synthesis-${id}.${target.format}`;
  return c.body(obj.stream, 200, {
    "Content-Type": obj.contentType,
    "Content-Length": String(obj.contentLength),
    "Content-Disposition": `attachment; filename="${filename}"`,
  });
});

synthesisExportRouter.post(
  "/runs/:id/resynthesize",
  requireAuth,
  zValidator("json", resynthesizeSchema),
  async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "not_found" }, 404);
    const userId = c.get("userId")!;
    const body = c.req.valid("json");

    const [prev] = await db
      .select()
      .from(synthesisRuns)
      .where(eq(synthesisRuns.id, id));
    if (!prev) return c.json({ error: "not_found" }, 404);
    if (!(await canWrite(userId, { type: "workspace", id: prev.workspaceId }))) {
      return c.json({ error: "forbidden" }, 403);
    }

    // Mirror POST /run: pre-generate id and persist workflowId on INSERT
    // to close the orphan-workflow window if the workflow start fails or
    // a write race occurs.
    const nextRunId = crypto.randomUUID();
    const [next] = await db
      .insert(synthesisRuns)
      .values({
        id: nextRunId,
        workspaceId: prev.workspaceId,
        projectId: prev.projectId,
        userId,
        format: prev.format,
        template: prev.template,
        userPrompt: body.userPrompt,
        autoSearch: prev.autoSearch,
        status: "pending",
        workflowId: workflowIdFor(nextRunId),
      })
      .returning();

    const client = await getTemporalClient();
    await startSynthesisExportRun(client, {
      runId: next!.id,
      workspaceId: prev.workspaceId,
      projectId: prev.projectId,
      userId,
      format: prev.format as SynthesisFormat,
      template: prev.template as SynthesisTemplate,
      userPrompt: body.userPrompt,
      explicitSourceIds: [],
      noteIds: [],
      autoSearch: prev.autoSearch,
      byokKeyHandle: null,
    });

    return c.json({ runId: next!.id });
  },
);

synthesisExportRouter.delete("/runs/:id", requireAuth, async (c) => {
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

  try {
    const client = await getTemporalClient();
    await signalSynthesisExportCancel(client, id);
  } catch {
    // Workflow may already be terminal (completed/failed/cancelled). The
    // signal failure should not block deletion; the row is the source of
    // truth for "this run no longer exists from the user's POV."
  }
  await db.delete(synthesisRuns).where(eq(synthesisRuns.id, id));
  return c.body(null, 204);
});
