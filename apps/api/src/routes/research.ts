import { Hono, type Context } from "hono";
import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import {
  db,
  researchRuns,
  researchRunTurns,
  researchRunArtifacts,
  projects,
  eq,
  and,
  asc,
  desc,
  max,
  gt,
  type Tx,
  type ResearchRunTurnInsert,
} from "@opencairn/db";
import {
  createResearchRunSchema,
  listRunsQuerySchema,
  addTurnSchema,
  updatePlanSchema,
  approvePlanSchema,
  type ResearchRunDetail,
  type ResearchInvalidStateError,
  type ResearchCancelResponse,
  type ResearchApproveResponse,
  type ResearchConcurrentWriteError,
} from "@opencairn/shared";
import { requireAuth } from "../middleware/auth";
import { canWrite, canRead } from "../lib/permissions";
import { getTemporalClient, taskQueue } from "../lib/temporal-client";
import { isUuid } from "../lib/validators";
import {
  isDeepResearchEnabled,
  isManagedDeepResearchEnabled,
} from "../lib/feature-flags";
import type { AppEnv } from "../lib/types";

const researchRouter = new Hono<AppEnv>();

// Whole-router feature gate. If off, nothing under this router responds.
// Internal endpoints (under /api/internal) are NOT gated — those follow the
// shared-secret model and are used by the worker which already respects the
// python-side FEATURE_DEEP_RESEARCH check.
researchRouter.use("*", async (c, next) => {
  if (!isDeepResearchEnabled()) return c.json({ error: "not_found" }, 404);
  await next();
});

// POST /api/research/runs — create run + start workflow
researchRouter.post(
  "/runs",
  requireAuth,
  zValidator("json", createResearchRunSchema),
  async (c) => {
    const userId = c.get("userId");
    const body = c.req.valid("json");

    // managed path is gated at BOTH the API and the workflow. API gate gives
    // a better UX error; the workflow gate is defence-in-depth.
    if (body.billingPath === "managed" && !isManagedDeepResearchEnabled()) {
      return c.json({ error: "managed_disabled" }, 403);
    }

    // project must live in the declared workspace — prevents a writer on
    // one workspace from attributing a run to another. 404 on mismatch
    // (api-contract.md: hide existence when user has no access to both).
    const [proj] = await db
      .select({ workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, body.projectId));
    if (!proj || proj.workspaceId !== body.workspaceId) {
      return c.json({ error: "not_found" }, 404);
    }

    if (!(await canWrite(userId, { type: "project", id: body.projectId }))) {
      return c.json({ error: "forbidden" }, 403);
    }

    // Generate the id in the app layer so workflowId == id in a single insert
    // (the column is NOT NULL). Eliminates the redundant follow-up UPDATE and
    // the intermediate `workflowId: ""` half-state.
    const runId = randomUUID();
    await db.insert(researchRuns).values({
      id: runId,
      workspaceId: body.workspaceId,
      projectId: body.projectId,
      userId,
      topic: body.topic,
      model: body.model,
      billingPath: body.billingPath,
      status: "planning",
      workflowId: runId,
    });

    // Start Temporal workflow. Arg shape matches DeepResearchInput dataclass
    // in apps/worker/src/worker/workflows/deep_research_workflow.py.
    const client = await getTemporalClient();
    await client.workflow.start("DeepResearchWorkflow", {
      workflowId: runId,
      taskQueue: taskQueue(),
      args: [
        {
          run_id: runId,
          workspace_id: body.workspaceId,
          project_id: body.projectId,
          user_id: userId,
          topic: body.topic,
          model: body.model,
          billing_path: body.billingPath,
        },
      ],
    });

    return c.json({ runId }, 201);
  },
);

// GET /api/research/runs?workspaceId=...
researchRouter.get(
  "/runs",
  requireAuth,
  zValidator("query", listRunsQuerySchema),
  async (c) => {
    const userId = c.get("userId");
    const { workspaceId, limit } = c.req.valid("query");

    if (!(await canRead(userId, { type: "workspace", id: workspaceId }))) {
      return c.json({ error: "forbidden" }, 403);
    }

    const rows = await db
      .select({
        id: researchRuns.id,
        topic: researchRuns.topic,
        model: researchRuns.model,
        status: researchRuns.status,
        billingPath: researchRuns.billingPath,
        createdAt: researchRuns.createdAt,
        updatedAt: researchRuns.updatedAt,
        completedAt: researchRuns.completedAt,
        totalCostUsdCents: researchRuns.totalCostUsdCents,
        noteId: researchRuns.noteId,
      })
      .from(researchRuns)
      .where(eq(researchRuns.workspaceId, workspaceId))
      .orderBy(desc(researchRuns.createdAt))
      .limit(limit);

    return c.json({
      runs: rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        completedAt: r.completedAt?.toISOString() ?? null,
      })),
    });
  },
);

// GET /api/research/runs/:id
researchRouter.get("/runs/:id", requireAuth, async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const run = await loadRunForUser(id, userId);
  if (!run) return c.json({ error: "not_found" }, 404);

  // Parallelise the two independent reads. The detail endpoint is on the
  // Phase D hot path (initial hydration before SSE takes over), so saving
  // one round-trip matters.
  // Use run.id rather than the raw param — the run reference is the only one
  // TS knows is a non-undefined string here, since c.req.param() returns
  // string | undefined and the loadRunForUser narrowing doesn't propagate
  // back to the original variable.
  const [turns, artifacts] = await Promise.all([
    db
      .select()
      .from(researchRunTurns)
      .where(eq(researchRunTurns.runId, run.id))
      .orderBy(asc(researchRunTurns.seq)),
    db
      .select()
      .from(researchRunArtifacts)
      .where(eq(researchRunArtifacts.runId, run.id))
      .orderBy(asc(researchRunArtifacts.seq)),
  ]);

  // `satisfies` (rather than a cast) so missing or misnamed fields trip a
  // compile error against the shared contract, while still letting TS infer
  // narrow literal types for the response body.
  const detail = {
    id: run.id,
    workspaceId: run.workspaceId,
    projectId: run.projectId,
    topic: run.topic,
    model: run.model,
    status: run.status,
    billingPath: run.billingPath,
    currentInteractionId: run.currentInteractionId,
    approvedPlanText: run.approvedPlanText,
    error: run.error,
    totalCostUsdCents: run.totalCostUsdCents,
    noteId: run.noteId,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    turns: turns.map((t) => ({
      id: t.id,
      seq: t.seq,
      role: t.role,
      kind: t.kind,
      interactionId: t.interactionId,
      content: t.content,
      createdAt: t.createdAt.toISOString(),
    })),
    artifacts: artifacts.map((a) => ({
      id: a.id,
      seq: a.seq,
      kind: a.kind,
      payload: a.payload,
      createdAt: a.createdAt.toISOString(),
    })),
  } satisfies ResearchRunDetail;
  return c.json(detail);
});

// Utility: load run with auth check. Returns null on not-found / cross-ws
// (same 404 shape) or the hydrated run.
//
// Regex: RFC 4122 (+ RFC 9562) strict. Enforces hyphen positions, allows
// versions 1-8 in the version nibble, and 8/9/a/b in the variant nibble. The
// previous `[0-9a-f-]{36}` accepted any 36-char hex+hyphen soup (e.g.
// "----------------------------" or all-zeros) and pushed the rejection down
// to the DB query. Reject at the boundary so we don't waste a round-trip and
// don't have a malformed string flowing through canRead either.
// Strict regex lives in lib/validators.ts.

// Postgres SQLSTATE 23505 = unique_violation. The normal turn-writing paths
// now hold the run row FOR UPDATE before max(seq)+1 allocation, but keep this
// mapper as defence-in-depth for any stale writer or unexpected constraint
// race so the client sees retryable 409 rather than a generic 500.
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  if ("code" in err && (err as { code: unknown }).code === "23505") {
    return true;
  }
  if ("cause" in err) {
    const cause = (err as { cause?: unknown }).cause;
    return cause !== err && isUniqueViolation(cause);
  }
  return false;
}

const concurrentWriteResponse = {
  error: "concurrent_write",
  retryable: true,
} as const satisfies ResearchConcurrentWriteError;

function isNegotiableStatus(status: string): boolean {
  return status === "planning" || status === "awaiting_approval";
}

async function lockRunForMutation(tx: Tx, runId: string) {
  const [run] = await tx
    .select()
    .from(researchRuns)
    .where(eq(researchRuns.id, runId))
    .for("update");
  return run ?? null;
}

async function appendResearchTurn(
  tx: Tx,
  values: Omit<ResearchRunTurnInsert, "id" | "seq" | "createdAt">,
): Promise<string> {
  const [{ nextSeq }] = await tx
    .select({ nextSeq: max(researchRunTurns.seq) })
    .from(researchRunTurns)
    .where(eq(researchRunTurns.runId, values.runId));
  const [turn] = await tx
    .insert(researchRunTurns)
    .values({
      ...values,
      seq: (nextSeq ?? -1) + 1,
    })
    .returning({ id: researchRunTurns.id });
  return turn.id;
}

type ResearchRunStatus = (typeof researchRuns.$inferSelect)["status"];
type CommonMutationError =
  | { type: "not_found" }
  | { type: "invalid_state"; status: ResearchRunStatus };

function respondCommonMutationError(
  c: Context<AppEnv>,
  result: CommonMutationError,
): Response {
  if (result.type === "not_found") return c.json({ error: "not_found" }, 404);

  return c.json(
    {
      error: "invalid_state",
      status: result.status,
    } satisfies ResearchInvalidStateError,
    409,
  );
}

async function loadRunForUser(runId: string | undefined, userId: string) {
  if (!isUuid(runId)) return null;
  const [run] = await db
    .select()
    .from(researchRuns)
    .where(eq(researchRuns.id, runId));
  if (!run) return null;
  if (!(await canRead(userId, { type: "workspace", id: run.workspaceId }))) {
    return null;
  }
  return run;
}

// POST /api/research/runs/:id/turns  — queue feedback for iterate_plan
researchRouter.post(
  "/runs/:id/turns",
  requireAuth,
  zValidator("json", addTurnSchema),
  async (c) => {
    const userId = c.get("userId");
    const runId = c.req.param("id");
    const { feedback } = c.req.valid("json");

    const run = await loadRunForUser(runId, userId);
    if (!run) return c.json({ error: "not_found" }, 404);
    if (!(await canWrite(userId, { type: "project", id: run.projectId }))) {
      return c.json({ error: "forbidden" }, 403);
    }

    let result:
      | { type: "ok"; turnId: string; workflowId: string }
      | { type: "not_found" }
      | { type: "invalid_state"; status: typeof run.status };
    try {
      result = await db.transaction(async (tx) => {
        const locked = await lockRunForMutation(tx, run.id);
        if (!locked) return { type: "not_found" as const };
        if (!isNegotiableStatus(locked.status)) {
          return { type: "invalid_state" as const, status: locked.status };
        }
        const turnId = await appendResearchTurn(tx, {
          runId: locked.id,
          role: "user",
          kind: "user_feedback",
          content: feedback,
        });
        return { type: "ok" as const, turnId, workflowId: locked.workflowId };
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        return c.json(concurrentWriteResponse, 409);
      }
      throw err;
    }

    if (result.type !== "ok") return respondCommonMutationError(c, result);

    const client = await getTemporalClient();
    const handle = client.workflow.getHandle(result.workflowId);
    await handle.signal("user_feedback", feedback, result.turnId);

    return c.json({ turnId: result.turnId }, 202);
  },
);

// PATCH /api/research/runs/:id/plan — local edit, no Google call, no signal
researchRouter.patch(
  "/runs/:id/plan",
  requireAuth,
  zValidator("json", updatePlanSchema),
  async (c) => {
    const userId = c.get("userId");
    const runId = c.req.param("id");
    const { editedText } = c.req.valid("json");

    const run = await loadRunForUser(runId, userId);
    if (!run) return c.json({ error: "not_found" }, 404);
    if (!(await canWrite(userId, { type: "project", id: run.projectId }))) {
      return c.json({ error: "forbidden" }, 403);
    }
    let result:
      | { type: "ok"; turnId: string }
      | { type: "not_found" }
      | { type: "invalid_state"; status: typeof run.status };
    try {
      result = await db.transaction(async (tx) => {
        const locked = await lockRunForMutation(tx, run.id);
        if (!locked) return { type: "not_found" as const };
        if (!isNegotiableStatus(locked.status)) {
          return { type: "invalid_state" as const, status: locked.status };
        }
        const turnId = await appendResearchTurn(tx, {
          runId: locked.id,
          role: "user",
          kind: "user_edit",
          content: editedText,
        });
        return { type: "ok" as const, turnId };
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        return c.json(concurrentWriteResponse, 409);
      }
      throw err;
    }

    if (result.type !== "ok") return respondCommonMutationError(c, result);
    return c.json({ turnId: result.turnId }, 200);
  },
);

// POST /api/research/runs/:id/approve
researchRouter.post(
  "/runs/:id/approve",
  requireAuth,
  zValidator("json", approvePlanSchema),
  async (c) => {
    const userId = c.get("userId");
    const runId = c.req.param("id");
    const { finalPlanText } = c.req.valid("json");

    const run = await loadRunForUser(runId, userId);
    if (!run) return c.json({ error: "not_found" }, 404);
    if (!(await canWrite(userId, { type: "project", id: run.projectId }))) {
      return c.json({ error: "forbidden" }, 403);
    }
    // Approval must land atomically and under the run-row lock: either the
    // approval turn AND approvedPlanText both commit, or neither does. The
    // lock also makes concurrent approves idempotent: the second request
    // observes approvedPlanText after the first commit and skips writes/signal.
    let result:
      | { type: "approved"; approved: string; workflowId: string }
      | { type: "already_approved" }
      | { type: "not_found" }
      | { type: "invalid_state"; status: typeof run.status }
      | { type: "no_plan_yet" };
    try {
      result = await db.transaction(async (tx) => {
        const locked = await lockRunForMutation(tx, run.id);
        if (!locked) return { type: "not_found" as const };
        if (locked.approvedPlanText !== null) {
          return { type: "already_approved" as const };
        }
        if (!isNegotiableStatus(locked.status)) {
          return { type: "invalid_state" as const, status: locked.status };
        }

        // Resolve the plan text to approve while holding the same lock that
        // protects turn sequence allocation.
        let approved = finalPlanText;
        if (!approved) {
          const [latestEdit] = await tx
            .select({ content: researchRunTurns.content })
            .from(researchRunTurns)
            .where(
              and(
                eq(researchRunTurns.runId, locked.id),
                eq(researchRunTurns.kind, "user_edit"),
              ),
            )
            .orderBy(desc(researchRunTurns.seq))
            .limit(1);
          if (latestEdit) {
            approved = latestEdit.content;
          } else {
            const [latestProp] = await tx
              .select({ content: researchRunTurns.content })
              .from(researchRunTurns)
              .where(
                and(
                  eq(researchRunTurns.runId, locked.id),
                  eq(researchRunTurns.kind, "plan_proposal"),
                ),
              )
              .orderBy(desc(researchRunTurns.seq))
              .limit(1);
            approved = latestProp?.content;
          }
        }
        if (!approved) return { type: "no_plan_yet" as const };

        await appendResearchTurn(tx, {
          runId: locked.id,
          role: "user",
          kind: "approval",
          content: approved,
        });
        await tx
          .update(researchRuns)
          .set({ approvedPlanText: approved })
          .where(eq(researchRuns.id, locked.id));
        return {
          type: "approved" as const,
          approved,
          workflowId: locked.workflowId,
        };
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        return c.json(concurrentWriteResponse, 409);
      }
      throw err;
    }

    if (result.type === "not_found" || result.type === "invalid_state") {
      return respondCommonMutationError(c, result);
    }
    if (result.type === "already_approved") {
      return c.json(
        {
          approved: true,
          alreadyApproved: true,
        } satisfies ResearchApproveResponse,
        202,
      );
    }
    if (result.type === "no_plan_yet") {
      return c.json({ error: "no_plan_yet" }, 409);
    }

    const client = await getTemporalClient();
    const handle = client.workflow.getHandle(result.workflowId);
    await handle.signal("approve_plan", result.approved);

    return c.json(
      { approved: true } satisfies ResearchApproveResponse,
      202,
    );
  },
);

// POST /api/research/runs/:id/cancel
researchRouter.post("/runs/:id/cancel", requireAuth, async (c) => {
  const userId = c.get("userId");
  const runId = c.req.param("id");

  const run = await loadRunForUser(runId, userId);
  if (!run) return c.json({ error: "not_found" }, 404);
  if (!(await canWrite(userId, { type: "project", id: run.projectId }))) {
    return c.json({ error: "forbidden" }, 403);
  }

  // Terminal states — nothing to do. Return 202 for idempotency (so UI can
  // retry spam-click without shaking the user with an error).
  if (
    run.status === "completed" ||
    run.status === "failed" ||
    run.status === "cancelled"
  ) {
    return c.json(
      {
        cancelled: true,
        alreadyTerminal: true,
      } satisfies ResearchCancelResponse,
      202,
    );
  }

  const client = await getTemporalClient();
  const handle = client.workflow.getHandle(run.workflowId);
  // Use the signal rather than handle.cancel() — the workflow's cancel
  // handler does the Google provider.cancel_interaction + DB transition.
  // handle.cancel() would trip CancelledError mid-activity and skip cleanup.
  await handle.signal("cancel");

  return c.json(
    { cancelled: true } satisfies ResearchCancelResponse,
    202,
  );
});

// GET /api/research/runs/:id/stream  — SSE progress stream
//
// Polling-based like /api/import/jobs/:id/events: every 2s, query the run
// row + any new turns + any new artifacts since last seq, emit events,
// close on terminal status. Pure projection — no Temporal coupling on this
// endpoint so an API restart doesn't take the stream down.
researchRouter.get("/runs/:id/stream", requireAuth, async (c) => {
  const userId = c.get("userId");
  const runId = c.req.param("id");

  const run = await loadRunForUser(runId, userId);
  if (!run) return c.json({ error: "not_found" }, 404);

  const POLL_MS = 2_000;
  const MAX_MINUTES = 70; // cover the 60min workflow cap + persistence slack
  const MAX_TICKS = (MAX_MINUTES * 60 * 1000) / POLL_MS;

  // Flag flipped by the stream's cancel callback when the client disconnects
  // (browser close, navigation, fetch abort). Checked at each loop boundary so
  // the 2s-poll + 70min-cap combo doesn't keep hammering the DB for a reader
  // that's already gone.
  let aborted = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      let lastStatus: string | null = null;
      let lastTurnSeq = -1;
      let lastArtifactSeq = -1;
      let tick = 0;

      try {
        while (tick < MAX_TICKS) {
          if (aborted) break;
          const [row] = await db
            .select({
              status: researchRuns.status,
              projectId: researchRuns.projectId,
              noteId: researchRuns.noteId,
              error: researchRuns.error,
            })
            .from(researchRuns)
            .where(eq(researchRuns.id, run.id));
          if (!row) break;

          if (row.status !== lastStatus) {
            send({ type: "status", status: row.status });
            lastStatus = row.status;
          }

          const newTurns = await db
            .select()
            .from(researchRunTurns)
            .where(
              and(
                eq(researchRunTurns.runId, run.id),
                gt(researchRunTurns.seq, lastTurnSeq),
              ),
            )
            .orderBy(asc(researchRunTurns.seq));
          for (const t of newTurns) {
            send({
              type: "turn",
              turn: {
                id: t.id,
                seq: t.seq,
                role: t.role,
                kind: t.kind,
                interactionId: t.interactionId,
                content: t.content,
                createdAt: t.createdAt.toISOString(),
              },
            });
            lastTurnSeq = t.seq;
          }

          const newArts = await db
            .select()
            .from(researchRunArtifacts)
            .where(
              and(
                eq(researchRunArtifacts.runId, run.id),
                gt(researchRunArtifacts.seq, lastArtifactSeq),
              ),
            )
            .orderBy(asc(researchRunArtifacts.seq));
          for (const a of newArts) {
            send({
              type: "artifact",
              artifact: {
                id: a.id,
                seq: a.seq,
                kind: a.kind,
                payload: a.payload,
                createdAt: a.createdAt.toISOString(),
              },
            });
            lastArtifactSeq = a.seq;
          }

          if (row.error) {
            send({
              type: "error",
              code: (row.error as { code: string }).code,
              message: (row.error as { message: string }).message,
            });
          }

          if (
            row.status === "completed" ||
            row.status === "failed" ||
            row.status === "cancelled"
          ) {
            send({
              type: "done",
              noteId: row.noteId,
              projectId: row.projectId,
            });
            break;
          }

          await new Promise((r) => setTimeout(r, POLL_MS));
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

export { researchRouter };
