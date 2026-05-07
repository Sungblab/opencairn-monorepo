import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db, siteAdminReports } from "@opencairn/db";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../lib/types";

const createReportSchema = z
  .object({
    type: z.enum(["bug", "feedback", "billing", "security", "other"]).default("bug"),
    priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
    title: z.string().trim().min(3).max(160),
    description: z.string().trim().max(4000).default(""),
    pageUrl: z.string().trim().max(1000).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const siteReportRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .post("/", zValidator("json", createReportSchema), async (c) => {
    const body = c.req.valid("json");
    const [created] = await db
      .insert(siteAdminReports)
      .values({
        reporterUserId: c.get("userId"),
        type: body.type,
        priority: body.priority,
        title: body.title,
        description: body.description,
        pageUrl: body.pageUrl || null,
        metadata: body.metadata ?? {},
      })
      .returning({
        id: siteAdminReports.id,
        status: siteAdminReports.status,
        createdAt: siteAdminReports.createdAt,
      });

    return c.json(
      {
        report: {
          ...created,
          createdAt: created.createdAt.toISOString(),
        },
      },
      201,
    );
  });
