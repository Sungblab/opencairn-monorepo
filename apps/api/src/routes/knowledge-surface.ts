import { Hono } from "hono";
import { z } from "zod";
import { EvidenceAccessDeniedError } from "../lib/evidence-bundles";
import {
  getKnowledgeSurfaceForUser,
  type KnowledgeSurfaceView,
} from "../lib/knowledge-surface-evidence";
import type { AppEnv } from "../lib/types";
import { requireAuth } from "../middleware/auth";

const querySchema = z.object({
  view: z.enum(["graph", "mindmap", "cards", "timeline", "board"]).default("graph"),
  query: z.string().min(1).max(200).optional(),
  root: z.string().uuid().optional(),
  includeEvidence: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

export const knowledgeSurfaceRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get("/:projectId/knowledge-surface", async (c) => {
    const projectId = c.req.param("projectId");
    if (!z.string().uuid().safeParse(projectId).success) {
      return c.json({ error: "bad-request" }, 400);
    }

    const parsed = querySchema.safeParse({
      view: c.req.query("view") ?? "graph",
      query: c.req.query("query") || undefined,
      root: c.req.query("root") || undefined,
      includeEvidence: c.req.query("includeEvidence") ?? "false",
    });
    if (!parsed.success) {
      return c.json({ error: "bad-request" }, 400);
    }

    try {
      const body = await getKnowledgeSurfaceForUser(c.get("user").id, projectId, {
        view: parsed.data.view as KnowledgeSurfaceView,
        query: parsed.data.query,
        root: parsed.data.root,
        includeEvidence: parsed.data.includeEvidence,
      });
      return c.json(body);
    } catch (err) {
      if (err instanceof EvidenceAccessDeniedError) {
        return c.json({ error: "forbidden" }, 403);
      }
      throw err;
    }
  });
