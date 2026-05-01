import { Hono } from "hono";
import { z } from "zod";
import {
  EvidenceAccessDeniedError,
  getGraphEdgeEvidenceForUser,
} from "../lib/evidence-bundles";
import type { AppEnv } from "../lib/types";
import { requireAuth } from "../middleware/auth";

export const graphEvidenceRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get("/:projectId/graph/evidence", async (c) => {
    const projectId = c.req.param("projectId");
    const edgeId = c.req.query("edgeId");
    const uuid = z.string().uuid();
    if (!uuid.safeParse(projectId).success || !edgeId || !uuid.safeParse(edgeId).success) {
      return c.json({ error: "bad-request" }, 400);
    }

    const user = c.get("user");
    let response;
    try {
      response = await getGraphEdgeEvidenceForUser(user.id, projectId, edgeId);
    } catch (err) {
      if (err instanceof EvidenceAccessDeniedError) {
        return c.json({ error: "forbidden" }, 403);
      }
      throw err;
    }
    if (!response) return c.json({ error: "not-found" }, 404);
    return c.json(response);
  });
