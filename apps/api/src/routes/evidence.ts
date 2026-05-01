import { Hono } from "hono";
import { z } from "zod";
import {
  EvidenceAccessDeniedError,
  getEvidenceBundleForUser,
} from "../lib/evidence-bundles";
import type { AppEnv } from "../lib/types";
import { requireAuth } from "../middleware/auth";

export const evidenceRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get("/bundles/:bundleId", async (c) => {
    const bundleId = c.req.param("bundleId");
    if (!z.string().uuid().safeParse(bundleId).success) {
      return c.json({ error: "bad-request" }, 400);
    }

    const user = c.get("user");
    let bundle;
    try {
      bundle = await getEvidenceBundleForUser(user.id, bundleId);
    } catch (err) {
      if (err instanceof EvidenceAccessDeniedError) {
        return c.json({ error: "forbidden" }, 403);
      }
      throw err;
    }
    if (!bundle) return c.json({ error: "not-found" }, 404);
    return c.json(bundle);
  });
