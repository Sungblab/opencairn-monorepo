import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import {
  db,
  codeRuns,
  codeTurns,
  notes,
  eq,
  asc,
  gt,
  and,
} from "@opencairn/db";
import {
  codeAgentRunRequestSchema,
  codeAgentFeedbackSchema,
} from "@opencairn/shared";
import { requireAuth } from "../middleware/auth";
import { canWrite } from "../lib/permissions";
import { getTemporalClient } from "../lib/temporal-client";
import {
  startCodeRun,
  signalCodeFeedback,
} from "../lib/code-agent-client";
import type { AppEnv } from "../lib/types";

// Plan 7 Canvas Phase 2 — public Code Agent API.
//
// Mirror the research router: whole-router gate on FEATURE_CODE_AGENT, then
// per-route requireAuth + Zod validation. Internal worker callbacks live in
// `routes/internal.ts` under the shared-secret middleware (separate gate, so
// turning the public flag off does NOT lock out the worker mid-flight).

const codeRoutes = new Hono<AppEnv>();

function isFeatureEnabled(): boolean {
  return (process.env.FEATURE_CODE_AGENT ?? "false").toLowerCase() === "true";
}

// Whole-router feature gate. If off, every public endpoint 404s — same shape
// as researchRouter. Hides feature existence from anonymous probes.
codeRoutes.use("*", async (c, next) => {
  if (!isFeatureEnabled()) return c.json({ error: "notFound" }, 404);
  await next();
});

// Terminal statuses — used by feedback / SSE to short-circuit. Keep in sync
// with apps/worker/src/worker/workflows/code_agent_workflow.py terminal set.
const TERMINAL_STATUSES = [
  "completed",
  "max_turns",
  "cancelled",
  "abandoned",
  "failed",
] as const;
const TERMINAL_STATUS_SET: ReadonlySet<string> = new Set(TERMINAL_STATUSES);

// SSE polling cadence + caps. POLL_MS dictates how often we tick the DB; the
// `: keepalive\n\n` comment frame on every quiet iteration keeps proxies (nginx
// 60s, Cloudflare 100s) from culling the connection. MAX_MINUTES is a slight
// pad over the workflow's own 60min execution timeout so a borderline-slow
// workflow doesn't get its stream cut while it's still wrapping up.
const POLL_MS = 2_000;
const MAX_MINUTES = 65;
const MAX_TICKS = (MAX_MINUTES * 60 * 1000) / POLL_MS;

// POST /api/code/run — kick off a CodeAgent workflow for a canvas note.
//
// Auth model: write on the note. Cross-workspace / non-existent / non-canvas /
// language-mismatch all hide behind 404/409 so a probe can't enumerate notes.
// The runId is generated app-side and reused as workflowId via
// `workflowIdFor()` so a single insert covers both columns (no follow-up
// UPDATE half-state, same pattern Deep Research adopted in Phase A).
codeRoutes.post(
  "/run",
  requireAuth,
  zValidator("json", codeAgentRunRequestSchema),
  async (c) => {
    const userId = c.get("userId");
    const body = c.req.valid("json");

    const [note] = await db
      .select({
        id: notes.id,
        workspaceId: notes.workspaceId,
        projectId: notes.projectId,
        sourceType: notes.sourceType,
        canvasLanguage: notes.canvasLanguage,
      })
      .from(notes)
      .where(eq(notes.id, body.noteId));
    if (!note) return c.json({ error: "notFound" }, 404);

    // canWrite checks workspace membership + project/page perms. Cross-
    // workspace ids fall through here — same 404 as the missing-row path.
    if (!(await canWrite(userId, { type: "note", id: body.noteId }))) {
      return c.json({ error: "notFound" }, 404);
    }

    if (note.sourceType !== "canvas") {
      return c.json({ error: "notCanvas" }, 409);
    }
    if (note.canvasLanguage !== body.language) {
      return c.json({ error: "wrongLanguage" }, 409);
    }

    const runId = randomUUID();
    await db.insert(codeRuns).values({
      id: runId,
      noteId: body.noteId,
      workspaceId: note.workspaceId,
      userId,
      prompt: body.prompt,
      language: body.language,
      workflowId: runId,
    });

    // Hand off to the Task 8 wrapper so workflow naming + execution timeout
    // stay consistent with cancel/feedback callers. byokKeyHandle is null
    // until BYOK UI lands (Plan 7 follow-up); the workflow accepts null.
    const client = await getTemporalClient();
    await startCodeRun(client, {
      runId,
      noteId: body.noteId,
      workspaceId: note.workspaceId,
      userId,
      prompt: body.prompt,
      language: body.language,
      byokKeyHandle: null,
    });

    return c.json({ runId });
  },
);

// GET /api/code/runs/:runId/stream — SSE projection of run progress.
//
// Pure DB poll, no Temporal coupling on this endpoint so an API restart
// doesn't drop the stream (same model researchRouter.stream uses). Auth is
// "the user that started the run" — we deliberately don't fall back to
// canRead on the workspace because a single run is one user's interactive
// session, not shared state.
codeRoutes.get("/runs/:runId/stream", requireAuth, async (c) => {
  const userId = c.get("userId");
  const runId = c.req.param("runId");
  if (!runId) return c.json({ error: "runId required" }, 400);

  const [run] = await db.select().from(codeRuns).where(eq(codeRuns.id, runId));
  if (!run || run.userId !== userId) {
    return c.json({ error: "notFound" }, 404);
  }

  // Cancel callback flips this when the client disconnects so we don't keep
  // hammering the DB after the reader is gone.
  let aborted = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (data: unknown) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
        );
      };
      // Comment-frame heartbeat. SSE spec: any line starting with `:` is a
      // comment and clients ignore it. We use it to keep nginx/Cloudflare from
      // culling the connection during long quiet periods (awaiting_feedback can
      // sit idle for many minutes while the user inspects sandbox output).
      const sendKeepalive = () => {
        controller.enqueue(encoder.encode(`: keepalive\n\n`));
      };

      // Initial queued event so the client gets immediate confirmation the
      // SSE is live and the runId is acknowledged. Subsequent events follow
      // the codeAgentEventSchema discriminator from packages/shared.
      send({ kind: "queued", runId: run.id });

      let lastTurnSeq = -1;
      let tick = 0;
      try {
        while (tick < MAX_TICKS) {
          if (aborted) break;
          const [r] = await db
            .select({ status: codeRuns.status })
            .from(codeRuns)
            .where(eq(codeRuns.id, run.id));
          if (!r) break;

          // Track whether this iteration emitted any data event so we know
          // whether to send a keep-alive comment frame at the bottom.
          let emittedData = false;

          const newTurns = await db
            .select()
            .from(codeTurns)
            .where(
              and(
                eq(codeTurns.runId, run.id),
                gt(codeTurns.seq, lastTurnSeq),
              ),
            )
            .orderBy(asc(codeTurns.seq));
          for (const t of newTurns) {
            send({
              kind: "turn_complete",
              turn: {
                kind: t.kind,
                source: t.source,
                explanation: t.explanation ?? null,
                seq: t.seq,
              },
            });
            lastTurnSeq = t.seq;
            emittedData = true;
          }

          if (TERMINAL_STATUS_SET.has(r.status)) {
            if (r.status === "failed") {
              send({ kind: "error", code: "workflowFailed" });
            } else {
              // codeAgentEventSchema's `done` only allows the four non-failed
              // terminal statuses — failed is reported via the error event
              // above so the client can branch on the discriminator.
              send({ kind: "done", status: r.status });
            }
            break;
          }

          // Re-emit awaiting_feedback EVERY iteration the run is in that
          // state, not just on the transition. A client that reconnects mid-
          // wait would otherwise never learn it should show the feedback UI.
          // The browser dedupes via React's setState identity so this is safe.
          if (r.status === "awaiting_feedback") {
            send({ kind: "awaiting_feedback" });
            emittedData = true;
          }

          // No data event this iteration → emit a comment-frame heartbeat so
          // proxies see traffic at least every POLL_MS.
          if (!emittedData) {
            sendKeepalive();
          }

          await new Promise((rs) => setTimeout(rs, POLL_MS));
          tick += 1;
        }
      } finally {
        controller.close();
      }
    },
    cancel() {
      aborted = true;
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

// POST /api/code/feedback — relay browser sandbox stdout/error to the
// workflow's `client_feedback` signal so it can decide to fix or finalize.
codeRoutes.post(
  "/feedback",
  requireAuth,
  zValidator("json", codeAgentFeedbackSchema),
  async (c) => {
    const userId = c.get("userId");
    const fb = c.req.valid("json");

    const [run] = await db
      .select()
      .from(codeRuns)
      .where(eq(codeRuns.id, fb.runId));
    if (!run || run.userId !== userId) {
      return c.json({ error: "notFound" }, 404);
    }
    if (TERMINAL_STATUS_SET.has(run.status)) {
      return c.json({ error: "alreadyTerminal" }, 409);
    }

    // Forward the discriminated-union payload through the wrapper. We strip
    // `runId` from the signal payload because the workflow is already keyed
    // by workflow id (= workflowIdFor(runId)) — duplicating it inside would
    // just bloat the Temporal history.
    const client = await getTemporalClient();
    if (fb.kind === "ok") {
      await signalCodeFeedback(client, run.id, {
        kind: "ok",
        ...(fb.stdout ? { stdout: fb.stdout } : {}),
      });
    } else {
      await signalCodeFeedback(client, run.id, {
        kind: "error",
        error: fb.error,
        ...(fb.stdout ? { stdout: fb.stdout } : {}),
      });
    }

    return c.json({ ok: true });
  },
);

export { codeRoutes };
