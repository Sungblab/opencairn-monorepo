import { Hono } from "hono";
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
} from "@opencairn/db";
import {
  createResearchRunSchema,
  listRunsQuerySchema,
  addTurnSchema,
  updatePlanSchema,
  approvePlanSchema,
} from "@opencairn/shared";
import { requireAuth } from "../middleware/auth";
import { canWrite, canRead } from "../lib/permissions";
import { getTemporalClient } from "../lib/temporal-client";
import type { AppEnv } from "../lib/types";

const researchRouter = new Hono<AppEnv>();

function taskQueue(): string {
  return process.env.TEMPORAL_TASK_QUEUE ?? "ingest";
}

function isFeatureEnabled(): boolean {
  return (process.env.FEATURE_DEEP_RESEARCH ?? "false").toLowerCase() === "true";
}

function isManagedEnabled(): boolean {
  return (
    (process.env.FEATURE_MANAGED_DEEP_RESEARCH ?? "false").toLowerCase() ===
    "true"
  );
}

// Whole-router feature gate. If off, nothing under this router responds.
// Internal endpoints (under /api/internal) are NOT gated — those follow the
// shared-secret model and are used by the worker which already respects the
// python-side FEATURE_DEEP_RESEARCH check.
researchRouter.use("*", async (c, next) => {
  if (!isFeatureEnabled()) return c.json({ error: "not_found" }, 404);
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
    if (body.billingPath === "managed" && !isManagedEnabled()) {
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

    // Insert DB row first. workflowId = id = runId (1:1, idempotent).
    const [inserted] = await db
      .insert(researchRuns)
      .values({
        workspaceId: body.workspaceId,
        projectId: body.projectId,
        userId,
        topic: body.topic,
        model: body.model,
        billingPath: body.billingPath,
        status: "planning",
        workflowId: "", // filled below
      })
      .returning({ id: researchRuns.id });
    const runId = inserted.id;
    await db
      .update(researchRuns)
      .set({ workflowId: runId, updatedAt: new Date() })
      .where(eq(researchRuns.id, runId));

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
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return c.json({ error: "not_found" }, 404);
  }

  const [run] = await db
    .select()
    .from(researchRuns)
    .where(eq(researchRuns.id, id));
  if (!run) return c.json({ error: "not_found" }, 404);

  if (!(await canRead(userId, { type: "workspace", id: run.workspaceId }))) {
    // Hide existence on cross-workspace access — 404, not 403.
    return c.json({ error: "not_found" }, 404);
  }

  const turns = await db
    .select()
    .from(researchRunTurns)
    .where(eq(researchRunTurns.runId, id))
    .orderBy(asc(researchRunTurns.seq));

  const artifacts = await db
    .select()
    .from(researchRunArtifacts)
    .where(eq(researchRunArtifacts.runId, id))
    .orderBy(asc(researchRunArtifacts.seq));

  return c.json({
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
  });
});

// Utility: load run with auth check. Returns null on not-found / cross-ws
// (same 404 shape) or the hydrated run.
async function loadRunForUser(runId: string, userId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(runId)) return null;
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

    // Plan feedback only valid while the plan is still being negotiated.
    if (
      run.status !== "planning" &&
      run.status !== "awaiting_approval"
    ) {
      return c.json({ error: "invalid_state", status: run.status }, 409);
    }

    const [{ nextSeq }] = await db
      .select({ nextSeq: max(researchRunTurns.seq) })
      .from(researchRunTurns)
      .where(eq(researchRunTurns.runId, runId));

    const [turn] = await db
      .insert(researchRunTurns)
      .values({
        runId,
        seq: (nextSeq ?? -1) + 1,
        role: "user",
        kind: "user_feedback",
        content: feedback,
      })
      .returning({ id: researchRunTurns.id });

    const client = await getTemporalClient();
    const handle = client.workflow.getHandle(run.workflowId);
    await handle.signal("user_feedback", feedback, turn.id);

    return c.json({ turnId: turn.id }, 202);
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
    if (
      run.status !== "planning" &&
      run.status !== "awaiting_approval"
    ) {
      return c.json({ error: "invalid_state", status: run.status }, 409);
    }

    const [{ nextSeq }] = await db
      .select({ nextSeq: max(researchRunTurns.seq) })
      .from(researchRunTurns)
      .where(eq(researchRunTurns.runId, runId));

    const [turn] = await db
      .insert(researchRunTurns)
      .values({
        runId,
        seq: (nextSeq ?? -1) + 1,
        role: "user",
        kind: "user_edit",
        content: editedText,
      })
      .returning({ id: researchRunTurns.id });

    return c.json({ turnId: turn.id }, 200);
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
    if (
      run.status !== "planning" &&
      run.status !== "awaiting_approval"
    ) {
      return c.json({ error: "invalid_state", status: run.status }, 409);
    }

    // Resolve the plan text to approve.
    let approved = finalPlanText;
    if (!approved) {
      const [latestEdit] = await db
        .select({ content: researchRunTurns.content })
        .from(researchRunTurns)
        .where(
          and(
            eq(researchRunTurns.runId, runId),
            eq(researchRunTurns.kind, "user_edit"),
          ),
        )
        .orderBy(desc(researchRunTurns.seq))
        .limit(1);
      if (latestEdit) {
        approved = latestEdit.content;
      } else {
        const [latestProp] = await db
          .select({ content: researchRunTurns.content })
          .from(researchRunTurns)
          .where(
            and(
              eq(researchRunTurns.runId, runId),
              eq(researchRunTurns.kind, "plan_proposal"),
            ),
          )
          .orderBy(desc(researchRunTurns.seq))
          .limit(1);
        approved = latestProp?.content;
      }
    }
    if (!approved) {
      return c.json({ error: "no_plan_yet" }, 409);
    }

    const [{ nextSeq }] = await db
      .select({ nextSeq: max(researchRunTurns.seq) })
      .from(researchRunTurns)
      .where(eq(researchRunTurns.runId, runId));
    await db.insert(researchRunTurns).values({
      runId,
      seq: (nextSeq ?? -1) + 1,
      role: "user",
      kind: "approval",
      content: approved,
    });

    await db
      .update(researchRuns)
      .set({ approvedPlanText: approved, updatedAt: new Date() })
      .where(eq(researchRuns.id, runId));

    const client = await getTemporalClient();
    const handle = client.workflow.getHandle(run.workflowId);
    await handle.signal("approve_plan", approved);

    return c.json({ approved: true }, 202);
  },
);

export { researchRouter };
