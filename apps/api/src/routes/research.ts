import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  db,
  researchRuns,
  projects,
  eq,
} from "@opencairn/db";
import {
  createResearchRunSchema,
} from "@opencairn/shared";
import { requireAuth } from "../middleware/auth";
import { canWrite } from "../lib/permissions";
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

export { researchRouter };
