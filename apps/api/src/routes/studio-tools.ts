import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { creditBalances, db, eq, user } from "@opencairn/db";
import { requireAuth } from "../middleware/auth";
import { canRead } from "../lib/permissions";
import {
  estimateStudioToolPreflight,
  studioToolProfileSchema,
} from "../lib/studio-tool-preflight";
import type { AppEnv } from "../lib/types";

const DEFAULT_STUDIO_PROVIDER = "gemini";
const DEFAULT_STUDIO_MODEL = "gemini-3-flash-preview";

const projectParamSchema = z.object({
  projectId: z.string().uuid(),
});

const studioToolPreflightSchema = z
  .object({
    tool: studioToolProfileSchema,
    sourceTokenEstimate: z.number().int().nonnegative().max(2_000_000),
    cachedTokenEstimate: z.number().int().nonnegative().max(2_000_000).optional(),
    provider: z.string().trim().min(1).max(80).optional(),
    model: z.string().trim().min(1).max(160).optional(),
  })
  .strict();

export const studioToolRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .post(
    "/:projectId/studio-tools/preflight",
    zValidator("param", projectParamSchema),
    zValidator("json", studioToolPreflightSchema),
    async (c) => {
      const userId = c.get("userId");
      const { projectId } = c.req.valid("param");
      if (!(await canRead(userId, { type: "project", id: projectId }))) {
        return c.json({ error: "forbidden" }, 403);
      }

      const [row] = await db
        .select({ plan: user.plan })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1);
      if (!row) return c.json({ error: "not_found" }, 404);

      const body = c.req.valid("json");
      const provider =
        body.provider ?? process.env.LLM_PROVIDER ?? DEFAULT_STUDIO_PROVIDER;
      const model =
        body.model ??
        (provider === "gemini"
          ? process.env.GEMINI_CHAT_MODEL ?? DEFAULT_STUDIO_MODEL
          : process.env.OPENAI_COMPAT_CHAT_MODEL ?? DEFAULT_STUDIO_MODEL);
      const estimate = estimateStudioToolPreflight({
        tool: body.tool,
        plan: row.plan,
        provider,
        model,
        sourceTokenEstimate: body.sourceTokenEstimate,
        cachedTokenEstimate: body.cachedTokenEstimate,
      });
      const [balance] = await db
        .select({ balanceCredits: creditBalances.balanceCredits })
        .from(creditBalances)
        .where(eq(creditBalances.userId, userId))
        .limit(1);
      const requiredCredits = estimate.cost.billableCredits;
      const blocked =
        estimate.chargeRequired &&
        (balance?.balanceCredits ?? 0) < requiredCredits;

      return c.json({
        preflight: {
          ...estimate,
          provider,
          model,
          projectId,
          sourceTokenEstimate: body.sourceTokenEstimate,
          cachedTokenEstimate: body.cachedTokenEstimate ?? 0,
          balance: {
            availableCredits: balance?.balanceCredits ?? 0,
            plan: row.plan,
          },
          canStart: !blocked,
          blockedReason: blocked ? "credits_insufficient" : null,
        },
      });
    },
  );
