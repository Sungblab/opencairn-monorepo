import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  and,
  agentFiles,
  asc,
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
  publishSynthesisDocumentSchema,
  resynthesizeSchema,
  synthesisFormatValues,
  synthesisTemplateValues,
  type AgentFileSummary,
  type SynthesisStreamEvent,
} from "@opencairn/shared";
import type { AppEnv } from "../lib/types";
import { requireAuth } from "../middleware/auth";
import { canWrite } from "../lib/permissions";
import {
  createQueuedWorkflowAgentAction,
  markWorkflowAgentActionFailed,
} from "../lib/agent-actions";
import {
  registerExistingObjectAsAgentFile,
  toSummary,
  type AgentFileRecord,
} from "../lib/agent-files";
import { toProjectObjectSummary } from "../lib/project-object-actions";
import { getTemporalClient } from "../lib/temporal-client";
import { streamObject } from "../lib/s3-get";
import {
  signalSynthesisExportCancel,
  startSynthesisExportRun,
  workflowIdFor,
} from "../lib/synthesis-export-client";
import { emitTreeEvent } from "../lib/tree-events";

type SynthesisFormat = (typeof synthesisFormatValues)[number];
type SynthesisTemplate = (typeof synthesisTemplateValues)[number];

const listRunsQuerySchema = z.object({
  workspaceId: z.string().uuid(),
});

export const synthesisExportRouter = new Hono<AppEnv>();

function isFeatureEnabled(): boolean {
  return (
    (process.env.FEATURE_SYNTHESIS_EXPORT ?? "false").toLowerCase() === "true"
  );
}

async function createSynthesisWorkflowAction(args: {
  runId: string;
  workspaceId: string;
  projectId: string | null;
  userId: string;
  format: SynthesisFormat;
  template: SynthesisTemplate;
  userPrompt: string;
  workflowId: string;
}) {
  if (!args.projectId) return null;
  return createQueuedWorkflowAgentAction({
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    actorUserId: args.userId,
    requestId: args.runId,
    sourceRunId: args.runId,
    kind: "export.project",
    risk: "expensive",
    input: {
      source: "synthesis_export",
      format: args.format,
      template: args.template,
      userPrompt: args.userPrompt,
    },
    preview: {
      summary: "Synthesis export workflow queued through the unified action ledger.",
      workflowHint: "synthesis_export",
      runId: args.runId,
      workflowId: args.workflowId,
    },
    result: {
      runId: args.runId,
      workflowId: args.workflowId,
      workflowHint: "synthesis_export",
    },
  });
}

async function ensureSynthesisProjectWrite(args: {
  userId: string;
  projectId: string | null | undefined;
}): Promise<boolean> {
  if (!args.projectId) return true;
  return canWrite(args.userId, { type: "project", id: args.projectId });
}

async function failSynthesisWorkflowStart(args: {
  runId: string;
  actionId?: string | null;
  errorCode: string;
}) {
  await db
    .update(synthesisRuns)
    .set({ status: "failed", updatedAt: new Date() })
    .where(eq(synthesisRuns.id, args.runId));
  await markWorkflowAgentActionFailed(args.actionId, args.errorCode, {
    ok: false,
    runId: args.runId,
    errorCode: args.errorCode,
    retryable: true,
  });
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
    if (!(await ensureSynthesisProjectWrite({ userId, projectId: body.projectId }))) {
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

    const workflowId = workflowIdFor(run!.id);
    let action: Awaited<ReturnType<typeof createSynthesisWorkflowAction>> = null;
    try {
      action = await createSynthesisWorkflowAction({
        runId: run!.id,
        workspaceId: body.workspaceId,
        projectId: body.projectId ?? null,
        userId,
        format: body.format,
        template: body.template,
        userPrompt: body.userPrompt,
        workflowId,
      });
    } catch (err) {
      await failSynthesisWorkflowStart({
        runId: run!.id,
        errorCode: "synthesis_export_action_start_failed",
      });
      throw err;
    }

    try {
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
    } catch (err) {
      await failSynthesisWorkflowStart({
        runId: run!.id,
        actionId: action?.action.id,
        errorCode: "synthesis_export_start_failed",
      });
      throw err;
    }

    return c.json({ runId: run!.id, action: action?.action ?? null });
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
  const parsed = listRunsQuerySchema.safeParse({
    workspaceId: c.req.query("workspaceId"),
  });
  if (!parsed.success)
    return c.json({ error: "workspaceId required (uuid)" }, 400);
  const { workspaceId } = parsed.data;
  if (!(await canWrite(userId, { type: "workspace", id: workspaceId }))) {
    return c.json({ error: "forbidden" }, 403);
  }
  // Workspace-scoped visibility: any editor sees all runs in the workspace.
  // Matches the deep-research model — synthesis runs are collaborative
  // artefacts, not per-user inboxes. Filter by userId in a future "My runs"
  // view if needed.
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
    .where(eq(synthesisSources.runId, id))
    .orderBy(asc(synthesisSources.id));
  const documents = await db
    .select()
    .from(synthesisDocuments)
    .where(eq(synthesisDocuments.runId, id))
    .orderBy(desc(synthesisDocuments.createdAt));
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
  "/runs/:id/project-object",
  requireAuth,
  zValidator("json", publishSynthesisDocumentSchema),
  async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "not_found" }, 404);
    const userId = c.get("userId")!;
    const body = c.req.valid("json");

    const [run] = await db
      .select()
      .from(synthesisRuns)
      .where(eq(synthesisRuns.id, id));
    if (!run) return c.json({ error: "not_found" }, 404);
    if (!(await canWrite(userId, { type: "workspace", id: run.workspaceId }))) {
      return c.json({ error: "forbidden" }, 403);
    }
    if (!run.projectId) return c.json({ error: "missing_project" }, 409);
    if (!(await canWrite(userId, { type: "project", id: run.projectId }))) {
      return c.json({ error: "forbidden" }, 403);
    }
    if (run.status !== "completed") {
      return c.json({ error: "run_not_completed" }, 409);
    }

    const docs = await db
      .select()
      .from(synthesisDocuments)
      .where(eq(synthesisDocuments.runId, id))
      .orderBy(desc(synthesisDocuments.createdAt));
    const target = body.format
      ? docs.find((d) => d.format === body.format)
      : docs[0];
    if (!target?.s3Key) return c.json({ error: "no_document" }, 404);

    const existing = await findPublishedAgentFile(target.s3Key);
    let file: AgentFileSummary;
    let shouldEmitCreated = false;

    if (existing) {
      if (existing.workspaceId !== run.workspaceId || existing.projectId !== run.projectId) {
        return c.json({ error: "project_object_context_mismatch" }, 409);
      }
      if (existing.deletedAt) {
        const [restored] = await db
          .update(agentFiles)
          .set({ deletedAt: null })
          .where(eq(agentFiles.id, existing.id))
          .returning();
        if (!restored) return c.json({ error: "not_found" }, 404);
        file = toSummary(restored as AgentFileRecord);
        shouldEmitCreated = true;
      } else {
        file = toSummary(existing);
      }
    } else {
      file = await registerExistingObjectAsAgentFile({
        userId,
        workspaceId: run.workspaceId,
        projectId: run.projectId,
        filename: filenameForSynthesisDocument(id, target.format),
        title: titleForSynthesisDocument(run.userPrompt, target.format),
        objectKey: target.s3Key,
        bytes: target.bytes ?? 0,
        source: "synthesis_export",
      });
      shouldEmitCreated = true;
    }

    if (file.workspaceId !== run.workspaceId || file.projectId !== run.projectId) {
      return c.json({ error: "project_object_context_mismatch" }, 409);
    }

    if (shouldEmitCreated) {
      emitTreeEvent({
        kind: "tree.agent_file_created",
        projectId: file.projectId,
        id: file.id,
        parentId: file.folderId,
        label: file.title,
        at: new Date().toISOString(),
      });
    }

    const projectObject = toProjectObjectSummary(file);
    return c.json(
      {
        event: { type: "project_object_created", object: projectObject },
        compatibilityEvent: { type: "agent_file_created", file },
        file,
      },
      shouldEmitCreated ? 201 : 200,
    );
  },
);

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
    if (!(await ensureSynthesisProjectWrite({ userId, projectId: prev.projectId }))) {
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

    const format = prev.format as SynthesisFormat;
    const template = prev.template as SynthesisTemplate;
    const workflowId = workflowIdFor(next!.id);
    let action: Awaited<ReturnType<typeof createSynthesisWorkflowAction>> = null;
    try {
      action = await createSynthesisWorkflowAction({
        runId: next!.id,
        workspaceId: prev.workspaceId,
        projectId: prev.projectId,
        userId,
        format,
        template,
        userPrompt: body.userPrompt,
        workflowId,
      });
    } catch (err) {
      await failSynthesisWorkflowStart({
        runId: next!.id,
        errorCode: "synthesis_export_action_start_failed",
      });
      throw err;
    }

    try {
      const client = await getTemporalClient();
      await startSynthesisExportRun(client, {
        runId: next!.id,
        workspaceId: prev.workspaceId,
        projectId: prev.projectId,
        userId,
        format,
        template,
        userPrompt: body.userPrompt,
        explicitSourceIds: [],
        noteIds: [],
        autoSearch: prev.autoSearch,
        byokKeyHandle: null,
      });
    } catch (err) {
      await failSynthesisWorkflowStart({
        runId: next!.id,
        actionId: action?.action.id,
        errorCode: "synthesis_export_start_failed",
      });
      throw err;
    }

    return c.json({ runId: next!.id, action: action?.action ?? null });
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
  } catch (err) {
    // Workflow may already be terminal (completed/failed/cancelled). The
    // signal failure should not block deletion; the row is the source of
    // truth for "this run no longer exists from the user's POV." Log so
    // a Temporal outage doesn't silently disappear.
    console.warn(
      `[synthesis-export] cancel signal failed for run ${id}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  await db.delete(synthesisRuns).where(eq(synthesisRuns.id, id));
  return c.body(null, 204);
});

async function findPublishedAgentFile(
  objectKey: string,
): Promise<AgentFileRecord | null> {
  const [row] = await db
    .select()
    .from(agentFiles)
    .where(eq(agentFiles.objectKey, objectKey))
    .limit(1);
  return (row as AgentFileRecord | undefined) ?? null;
}

function filenameForSynthesisDocument(runId: string, format: string): string {
  const extension =
    format === "latex" ? "tex"
    : format === "bibtex" ? "bib"
    : format;
  return `synthesis-${runId}.${extension}`;
}

function titleForSynthesisDocument(prompt: string, format: string): string {
  const title = prompt.trim().replace(/\s+/g, " ").slice(0, 96);
  return title ? `${title} (${format})` : filenameForSynthesisDocument("document", format);
}
