import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { userPlanValues } from "@opencairn/shared";
import { z } from "zod";
import {
  agentActions,
  adminAuditEvents,
  alias,
  apiRequestLogs,
  asc,
  chatRuns,
  connectorJobs,
  count,
  db,
  desc,
  eq,
  gte,
  importJobs,
  inArray,
  jobs,
  llmUsageEvents,
  notes,
  notifications,
  projects,
  siteAdminReports,
  sql,
  usageRecords,
  user,
  workspaces,
} from "@opencairn/db";
import { requireAuth } from "../middleware/auth";
import { requireSiteAdmin } from "../middleware/site-admin";
import type { AppEnv } from "../lib/types";
import { recordAdminAuditEvent } from "../lib/admin-audit";

const siteAdminSchema = z
  .object({
    isSiteAdmin: z.boolean(),
  })
  .strict();

const userPlanSchema = z
  .object({ plan: z.enum(userPlanValues) })
  .strict();
const bulkUserPlanSchema = z
  .object({
    userIds: z.array(z.string().uuid()).min(1).max(200),
    plan: z.enum(userPlanValues),
  })
  .strict();
const bulkSiteAdminSchema = z
  .object({
    userIds: z.array(z.string().uuid()).min(1).max(200),
    isSiteAdmin: z.boolean(),
  })
  .strict();
const workspacePlanSchema = z
  .object({ planType: z.enum(["free", "pro", "enterprise"]) })
  .strict();
const bulkWorkspacePlanSchema = z
  .object({
    workspaceIds: z.array(z.string().uuid()).min(1).max(200),
    planType: z.enum(["free", "pro", "enterprise"]),
  })
  .strict();
const reportStatusSchema = z
  .object({ status: z.enum(["open", "triaged", "resolved", "closed"]) })
  .strict();
const bulkReportStatusSchema = z
  .object({
    reportIds: z.array(z.string().uuid()).min(1).max(200),
    status: z.enum(["open", "triaged", "resolved", "closed"]),
  })
  .strict();
const auditEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const actorUser = alias(user, "admin_audit_actor_user");
const targetUser = alias(user, "admin_audit_target_user");

const startOfDay = (date: Date) =>
  new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );

function iso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function boolEnv(name: string) {
  return process.env[name] === "1" || process.env[name] === "true";
}

function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function runLimited<const T extends readonly (() => Promise<unknown>)[]>(
  tasks: T,
  limit = 4,
): Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  const results: unknown[] = new Array(tasks.length);
  let cursor = 0;

  async function worker() {
    while (cursor < tasks.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await tasks[index]!();
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, () => worker()),
  );

  return results as { [K in keyof T]: Awaited<ReturnType<T[K]>> };
}

export const adminRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .use("*", requireSiteAdmin)
  .get("/overview", async (c) => {
    const now = new Date();
    const since30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const today = startOfDay(now);

    const [
      userTotal,
      user30d,
      workspaceTotal,
      projectTotal,
      noteTotal,
      openReports,
      failedJobs,
      pendingEmails,
      userPlans,
      workspacePlans,
      actionStatuses,
      recentReports,
      recentActions,
      recentJobs,
      recentImports,
      recentConnectorJobs,
      recentChatRuns,
      usageToday,
      usageMonth,
      apiCallsToday,
      apiCallsMonth,
      llmUsageMonth,
    ] = await runLimited([
      () => db.select({ value: count() }).from(user),
      () => db
        .select({ value: count() })
        .from(user)
        .where(gte(user.createdAt, since30d)),
      () => db.select({ value: count() }).from(workspaces),
      () => db.select({ value: count() }).from(projects),
      () => db.select({ value: count() }).from(notes),
      () => db
        .select({ value: count() })
        .from(siteAdminReports)
        .where(sql`${siteAdminReports.status} IN ('open', 'triaged')`),
      () =>
        db.select({ value: count() }).from(jobs).where(eq(jobs.status, "failed")),
      () => db
        .select({ value: count() })
        .from(notifications)
        .where(
          sql`${notifications.emailedAt} IS NULL AND ${notifications.emailAttempts} < 3`,
        ),
      () => db
        .select({ plan: user.plan, value: sql<number>`count(*)::int` })
        .from(user)
        .groupBy(user.plan)
        .orderBy(user.plan),
      () => db
        .select({
          plan: workspaces.planType,
          value: sql<number>`count(*)::int`,
        })
        .from(workspaces)
        .groupBy(workspaces.planType)
        .orderBy(workspaces.planType),
      () => db
        .select({
          status: agentActions.status,
          value: sql<number>`count(*)::int`,
        })
        .from(agentActions)
        .groupBy(agentActions.status)
        .orderBy(agentActions.status),
      () => db
        .select({
          id: siteAdminReports.id,
          title: siteAdminReports.title,
          type: siteAdminReports.type,
          priority: siteAdminReports.priority,
          status: siteAdminReports.status,
          createdAt: siteAdminReports.createdAt,
        })
        .from(siteAdminReports)
        .orderBy(desc(siteAdminReports.createdAt))
        .limit(8),
      () => db
        .select({
          id: agentActions.id,
          kind: agentActions.kind,
          status: agentActions.status,
          risk: agentActions.risk,
          errorCode: agentActions.errorCode,
          createdAt: agentActions.createdAt,
          updatedAt: agentActions.updatedAt,
        })
        .from(agentActions)
        .orderBy(desc(agentActions.updatedAt))
        .limit(12),
      () => db
        .select({
          id: jobs.id,
          type: jobs.type,
          status: jobs.status,
          error: jobs.error,
          createdAt: jobs.createdAt,
          completedAt: jobs.completedAt,
        })
        .from(jobs)
        .orderBy(desc(jobs.createdAt))
        .limit(8),
      () => db
        .select({
          id: importJobs.id,
          source: importJobs.source,
          status: importJobs.status,
          completedItems: importJobs.completedItems,
          failedItems: importJobs.failedItems,
          totalItems: importJobs.totalItems,
          errorSummary: importJobs.errorSummary,
          createdAt: importJobs.createdAt,
          finishedAt: importJobs.finishedAt,
        })
        .from(importJobs)
        .orderBy(desc(importJobs.createdAt))
        .limit(8),
      () => db
        .select({
          id: connectorJobs.id,
          jobType: connectorJobs.jobType,
          status: connectorJobs.status,
          completedItems: connectorJobs.completedItems,
          failedItems: connectorJobs.failedItems,
          totalItems: connectorJobs.totalItems,
          errorSummary: connectorJobs.errorSummary,
          createdAt: connectorJobs.createdAt,
          finishedAt: connectorJobs.finishedAt,
        })
        .from(connectorJobs)
        .orderBy(desc(connectorJobs.createdAt))
        .limit(8),
      () => db
        .select({
          id: chatRuns.id,
          status: chatRuns.status,
          error: chatRuns.error,
          createdAt: chatRuns.createdAt,
          startedAt: chatRuns.startedAt,
          completedAt: chatRuns.completedAt,
        })
        .from(chatRuns)
        .orderBy(desc(chatRuns.createdAt))
        .limit(8),
      () => db
        .select({
          action: usageRecords.action,
          value: sql<number>`sum(${usageRecords.count})::int`,
        })
        .from(usageRecords)
        .where(eq(usageRecords.month, today.toISOString().slice(0, 7)))
        .groupBy(usageRecords.action)
        .orderBy(usageRecords.action),
      () => db
        .select({ value: sql<number>`sum(${usageRecords.count})::int` })
        .from(usageRecords)
        .where(eq(usageRecords.month, today.toISOString().slice(0, 7))),
      () => db
        .select({ value: count() })
        .from(apiRequestLogs)
        .where(gte(apiRequestLogs.createdAt, today)),
      () => db
        .select({ value: count() })
        .from(apiRequestLogs)
        .where(gte(apiRequestLogs.createdAt, since30d)),
      () => db
        .select({
          tokensIn: sql<number>`coalesce(sum(${llmUsageEvents.tokensIn}), 0)::int`,
          tokensOut: sql<number>`coalesce(sum(${llmUsageEvents.tokensOut}), 0)::int`,
          costUsd: sql<string>`coalesce(sum(${llmUsageEvents.costUsd}), 0)::text`,
          costKrw: sql<string>`coalesce(sum(${llmUsageEvents.costKrw}), 0)::text`,
        })
        .from(llmUsageEvents)
        .where(gte(llmUsageEvents.createdAt, since30d)),
    ]);

    return c.json({
      stats: {
        users: userTotal[0]?.value ?? 0,
        newUsers30d: user30d[0]?.value ?? 0,
        workspaces: workspaceTotal[0]?.value ?? 0,
        projects: projectTotal[0]?.value ?? 0,
        notes: noteTotal[0]?.value ?? 0,
        openReports: openReports[0]?.value ?? 0,
        failedJobs: failedJobs[0]?.value ?? 0,
        pendingEmails: pendingEmails[0]?.value ?? 0,
        usageThisMonth: usageMonth[0]?.value ?? 0,
        apiCallsToday: apiCallsToday[0]?.value ?? 0,
        apiCalls30d: apiCallsMonth[0]?.value ?? 0,
        llmTokensIn30d: llmUsageMonth[0]?.tokensIn ?? 0,
        llmTokensOut30d: llmUsageMonth[0]?.tokensOut ?? 0,
        llmCostUsd30d: num(llmUsageMonth[0]?.costUsd),
        llmCostKrw30d: num(llmUsageMonth[0]?.costKrw),
      },
      analytics: {
        userPlans,
        workspacePlans,
        actionStatuses,
        usageByAction: usageToday,
      },
      recentReports: recentReports.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      })),
      recentOperations: [
        ...recentActions.map((row) => ({
          id: row.id,
          source: "agent_action",
          label: row.kind,
          status: row.status,
          detail: row.errorCode ?? row.risk,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        })),
        ...recentJobs.map((row) => ({
          id: row.id,
          source: "job",
          label: row.type,
          status: row.status,
          detail: row.error,
          createdAt: row.createdAt.toISOString(),
          updatedAt: iso(row.completedAt) ?? row.createdAt.toISOString(),
        })),
        ...recentImports.map((row) => ({
          id: row.id,
          source: "import",
          label: row.source,
          status: row.status,
          detail: row.errorSummary ?? `${row.completedItems}/${row.totalItems}`,
          createdAt: row.createdAt.toISOString(),
          updatedAt: iso(row.finishedAt) ?? row.createdAt.toISOString(),
        })),
        ...recentConnectorJobs.map((row) => ({
          id: row.id,
          source: "connector",
          label: row.jobType,
          status: row.status,
          detail: row.errorSummary ?? `${row.completedItems}/${row.totalItems}`,
          createdAt: row.createdAt.toISOString(),
          updatedAt: iso(row.finishedAt) ?? row.createdAt.toISOString(),
        })),
        ...recentChatRuns.map((row) => ({
          id: row.id,
          source: "chat_run",
          label: "chat",
          status: row.status,
          detail: row.error ? JSON.stringify(row.error).slice(0, 120) : null,
          createdAt: row.createdAt.toISOString(),
          updatedAt: (
            row.completedAt ??
            row.startedAt ??
            row.createdAt
          ).toISOString(),
        })),
      ]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 20),
      system: {
        environment: process.env.NODE_ENV ?? "development",
        internalApiUrl: process.env.INTERNAL_API_URL ?? null,
        publicAppUrl: process.env.NEXT_PUBLIC_APP_URL ?? null,
        email: {
          resendConfigured: Boolean(process.env.RESEND_API_KEY),
          smtpConfigured: Boolean(process.env.SMTP_HOST),
        },
        storage: {
          s3Configured: Boolean(
            process.env.S3_ENDPOINT || process.env.S3_BUCKET,
          ),
        },
        featureFlags: {
          documentGeneration: boolEnv("FEATURE_DOCUMENT_GENERATION"),
          managedDeepResearch: boolEnv("FEATURE_MANAGED_DEEP_RESEARCH"),
          noteAnalysisDrain: boolEnv("FEATURE_NOTE_ANALYSIS_DRAIN"),
          codeWorkspaceRepair: boolEnv("FEATURE_CODE_WORKSPACE_REPAIR"),
        },
      },
    });
  })
  .get("/api-logs", async (c) => {
    const rows = await db
      .select({
        id: apiRequestLogs.id,
        requestId: apiRequestLogs.requestId,
        method: apiRequestLogs.method,
        path: apiRequestLogs.path,
        query: apiRequestLogs.query,
        statusCode: apiRequestLogs.statusCode,
        durationMs: apiRequestLogs.durationMs,
        userId: apiRequestLogs.userId,
        ip: apiRequestLogs.ip,
        userAgent: apiRequestLogs.userAgent,
        referer: apiRequestLogs.referer,
        createdAt: apiRequestLogs.createdAt,
      })
      .from(apiRequestLogs)
      .orderBy(desc(apiRequestLogs.createdAt))
      .limit(200);

    return c.json({
      logs: rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      })),
    });
  })
  .get("/llm-usage", async (c) => {
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [totals, byModel, recentEvents] = await Promise.all([
      db
        .select({
          tokensIn: sql<number>`coalesce(sum(${llmUsageEvents.tokensIn}), 0)::int`,
          tokensOut: sql<number>`coalesce(sum(${llmUsageEvents.tokensOut}), 0)::int`,
          cachedTokens: sql<number>`coalesce(sum(${llmUsageEvents.cachedTokens}), 0)::int`,
          costUsd: sql<string>`coalesce(sum(${llmUsageEvents.costUsd}), 0)::text`,
          costKrw: sql<string>`coalesce(sum(${llmUsageEvents.costKrw}), 0)::text`,
        })
        .from(llmUsageEvents)
        .where(gte(llmUsageEvents.createdAt, since30d)),
      db
        .select({
          provider: llmUsageEvents.provider,
          model: llmUsageEvents.model,
          tokensIn: sql<number>`coalesce(sum(${llmUsageEvents.tokensIn}), 0)::int`,
          tokensOut: sql<number>`coalesce(sum(${llmUsageEvents.tokensOut}), 0)::int`,
          costUsd: sql<string>`coalesce(sum(${llmUsageEvents.costUsd}), 0)::text`,
          costKrw: sql<string>`coalesce(sum(${llmUsageEvents.costKrw}), 0)::text`,
        })
        .from(llmUsageEvents)
        .where(gte(llmUsageEvents.createdAt, since30d))
        .groupBy(llmUsageEvents.provider, llmUsageEvents.model)
        .orderBy(sql`sum(${llmUsageEvents.costUsd}) desc`)
        .limit(20),
      db
        .select({
          id: llmUsageEvents.id,
          provider: llmUsageEvents.provider,
          model: llmUsageEvents.model,
          operation: llmUsageEvents.operation,
          tokensIn: llmUsageEvents.tokensIn,
          tokensOut: llmUsageEvents.tokensOut,
          cachedTokens: llmUsageEvents.cachedTokens,
          costUsd: llmUsageEvents.costUsd,
          costKrw: llmUsageEvents.costKrw,
          userId: llmUsageEvents.userId,
          workspaceId: llmUsageEvents.workspaceId,
          sourceType: llmUsageEvents.sourceType,
          sourceId: llmUsageEvents.sourceId,
          createdAt: llmUsageEvents.createdAt,
        })
        .from(llmUsageEvents)
        .orderBy(desc(llmUsageEvents.createdAt))
        .limit(100),
    ]);

    return c.json({
      totals: {
        tokensIn: totals[0]?.tokensIn ?? 0,
        tokensOut: totals[0]?.tokensOut ?? 0,
        cachedTokens: totals[0]?.cachedTokens ?? 0,
        costUsd: num(totals[0]?.costUsd),
        costKrw: num(totals[0]?.costKrw),
      },
      byModel: byModel.map((row) => ({
        ...row,
        costUsd: num(row.costUsd),
        costKrw: num(row.costKrw),
      })),
      recentEvents: recentEvents.map((row) => ({
        ...row,
        costUsd: num(row.costUsd),
        costKrw: num(row.costKrw),
        createdAt: row.createdAt.toISOString(),
      })),
    });
  })
  .get(
    "/audit-events",
    zValidator("query", auditEventsQuerySchema),
    async (c) => {
      const { limit, offset } = c.req.valid("query");
      const rows = await db
        .select({
          id: adminAuditEvents.id,
          actorUserId: adminAuditEvents.actorUserId,
          actorEmail: actorUser.email,
          actorName: actorUser.name,
          action: adminAuditEvents.action,
          targetType: adminAuditEvents.targetType,
          targetId: adminAuditEvents.targetId,
          targetUserId: adminAuditEvents.targetUserId,
          targetUserEmail: targetUser.email,
          targetUserName: targetUser.name,
          targetWorkspaceId: adminAuditEvents.targetWorkspaceId,
          targetWorkspaceSlug: workspaces.slug,
          targetWorkspaceName: workspaces.name,
          targetReportId: adminAuditEvents.targetReportId,
          targetReportTitle: siteAdminReports.title,
          before: adminAuditEvents.before,
          after: adminAuditEvents.after,
          metadata: adminAuditEvents.metadata,
          createdAt: adminAuditEvents.createdAt,
        })
        .from(adminAuditEvents)
        .leftJoin(actorUser, eq(actorUser.id, adminAuditEvents.actorUserId))
        .leftJoin(targetUser, eq(targetUser.id, adminAuditEvents.targetUserId))
        .leftJoin(
          workspaces,
          eq(workspaces.id, adminAuditEvents.targetWorkspaceId),
        )
        .leftJoin(
          siteAdminReports,
          eq(siteAdminReports.id, adminAuditEvents.targetReportId),
        )
        .orderBy(desc(adminAuditEvents.createdAt))
        .limit(limit)
        .offset(offset);

      return c.json({
        events: rows.map((row) => ({
          id: row.id,
          actorUserId: row.actorUserId,
          actor: row.actorUserId
            ? {
                id: row.actorUserId,
                email: row.actorEmail,
                name: row.actorName,
              }
            : null,
          action: row.action,
          targetType: row.targetType,
          targetId: row.targetId,
          targetUserId: row.targetUserId,
          targetWorkspaceId: row.targetWorkspaceId,
          targetReportId: row.targetReportId,
          target: {
            id: row.targetId,
            type: row.targetType,
            label:
              row.targetUserEmail ??
              row.targetWorkspaceSlug ??
              row.targetReportTitle ??
              row.targetId,
            name:
              row.targetUserName ??
              row.targetWorkspaceName ??
              row.targetReportTitle ??
              null,
          },
          before: row.before,
          after: row.after,
          metadata: row.metadata,
          createdAt: row.createdAt.toISOString(),
        })),
        pagination: {
          limit,
          offset,
          nextOffset: rows.length === limit ? offset + rows.length : null,
        },
      });
    },
  )
  .get("/users", async (c) => {
    const rows = await db
      .select({
        id: user.id,
        email: user.email,
        name: user.name,
        emailVerified: user.emailVerified,
        plan: user.plan,
        isSiteAdmin: user.isSiteAdmin,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      })
      .from(user)
      .orderBy(asc(user.email));

    return c.json({
      users: rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    });
  })
  .get("/subscriptions", async (c) => {
    const userRows = await db
      .select({
        id: user.id,
        email: user.email,
        name: user.name,
        plan: user.plan,
        createdAt: user.createdAt,
      })
      .from(user)
      .orderBy(asc(user.email));
    const workspaceRows = await db
      .select({
        id: workspaces.id,
        slug: workspaces.slug,
        name: workspaces.name,
        planType: workspaces.planType,
        ownerId: workspaces.ownerId,
        createdAt: workspaces.createdAt,
      })
      .from(workspaces)
      .orderBy(asc(workspaces.slug));

    return c.json({
      users: userRows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      })),
      workspaces: workspaceRows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      })),
    });
  })
  .get("/reports", async (c) => {
    const rows = await db
      .select({
        id: siteAdminReports.id,
        reporterUserId: siteAdminReports.reporterUserId,
        type: siteAdminReports.type,
        priority: siteAdminReports.priority,
        status: siteAdminReports.status,
        title: siteAdminReports.title,
        description: siteAdminReports.description,
        pageUrl: siteAdminReports.pageUrl,
        createdAt: siteAdminReports.createdAt,
        updatedAt: siteAdminReports.updatedAt,
        resolvedAt: siteAdminReports.resolvedAt,
      })
      .from(siteAdminReports)
      .orderBy(desc(siteAdminReports.createdAt))
      .limit(100);

    return c.json({
      reports: rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        resolvedAt: iso(row.resolvedAt),
      })),
    });
  })
  .patch(
    "/users/site-admin",
    zValidator("json", bulkSiteAdminSchema),
    async (c) => {
      const actorUserId = c.get("userId");
      const { userIds, isSiteAdmin } = c.req.valid("json");
      const uniqueUserIds = Array.from(new Set(userIds));

      const result = await db.transaction(async (tx) => {
        const beforeRows = await tx
          .select({
            id: user.id,
            email: user.email,
            isSiteAdmin: user.isSiteAdmin,
          })
          .from(user)
          .where(inArray(user.id, uniqueUserIds));

        const changingRows = beforeRows.filter(
          (row) => row.isSiteAdmin !== isSiteAdmin,
        );
        if (changingRows.length === 0) return { updated: 0 };

        if (!isSiteAdmin) {
          if (uniqueUserIds.includes(actorUserId)) {
            return {
              error: "cannot_remove_own_site_admin" as const,
              status: 400 as const,
            };
          }
          await tx.execute(
            sql`select ${user.id} from ${user} where ${user.isSiteAdmin} = true for update`,
          );
          const [adminCount] = await tx
            .select({ value: count() })
            .from(user)
            .where(eq(user.isSiteAdmin, true));
          const currentAdmins = adminCount?.value ?? 0;
          const revokedAdmins = changingRows.filter(
            (row) => row.isSiteAdmin,
          ).length;
          if (currentAdmins - revokedAdmins <= 0) {
            return {
              error: "cannot_remove_last_site_admin" as const,
              status: 400 as const,
            };
          }
        }

        const updatedRows = await tx
          .update(user)
          .set({ isSiteAdmin })
          .where(inArray(user.id, changingRows.map((row) => row.id)))
          .returning({
            id: user.id,
            email: user.email,
            isSiteAdmin: user.isSiteAdmin,
          });

        for (const updated of updatedRows) {
          const before = beforeRows.find((row) => row.id === updated.id);
          if (!before) continue;
          await recordAdminAuditEvent(
            {
              actorUserId,
              action: updated.isSiteAdmin
                ? "site_admin.grant"
                : "site_admin.revoke",
              target: {
                targetType: "user",
                targetId: updated.id,
                targetUserId: updated.id,
              },
              before: { isSiteAdmin: before.isSiteAdmin },
              after: { isSiteAdmin: updated.isSiteAdmin },
              metadata: { targetEmail: updated.email },
            },
            tx,
          );
        }

        return { updated: updatedRows.length };
      });

      if ("error" in result) return c.json({ error: result.error }, result.status);
      return c.json({ updated: result.updated });
    },
  )
  .patch(
    "/users/plan",
    zValidator("json", bulkUserPlanSchema),
    async (c) => {
      const actorUserId = c.get("userId");
      const { userIds, plan } = c.req.valid("json");
      const uniqueUserIds = Array.from(new Set(userIds));

      const result = await db.transaction(async (tx) => {
        const beforeRows = await tx
          .select({ id: user.id, email: user.email, plan: user.plan })
          .from(user)
          .where(inArray(user.id, uniqueUserIds));
        const changingRows = beforeRows.filter((row) => row.plan !== plan);
        if (changingRows.length === 0) return { updated: 0 };

        const updatedRows = await tx
          .update(user)
          .set({ plan })
          .where(inArray(user.id, changingRows.map((row) => row.id)))
          .returning({ id: user.id, email: user.email, plan: user.plan });

        for (const updated of updatedRows) {
          const before = beforeRows.find((row) => row.id === updated.id);
          if (!before) continue;
          await recordAdminAuditEvent(
            {
              actorUserId,
              action: "user.plan.update",
              target: {
                targetType: "user",
                targetId: updated.id,
                targetUserId: updated.id,
              },
              before: { plan: before.plan },
              after: { plan: updated.plan },
              metadata: { targetEmail: updated.email },
            },
            tx,
          );
        }

        return { updated: updatedRows.length };
      });

      return c.json({ updated: result.updated });
    },
  )
  .patch(
    "/users/:userId/site-admin",
    zValidator("json", siteAdminSchema),
    async (c) => {
      const actorUserId = c.get("userId");
      const targetUserId = c.req.param("userId");
      const { isSiteAdmin } = c.req.valid("json");

      const result = await db.transaction(async (tx) => {
        const [before] = await tx
          .select({
            id: user.id,
            email: user.email,
            name: user.name,
            isSiteAdmin: user.isSiteAdmin,
          })
          .from(user)
          .where(eq(user.id, targetUserId))
          .limit(1);

        if (!before)
          return { error: "user_not_found" as const, status: 404 as const };

        if (before.isSiteAdmin && !isSiteAdmin) {
          await tx.execute(
            sql`select ${user.id} from ${user} where ${user.isSiteAdmin} = true for update`,
          );
          const [adminCount] = await tx
            .select({ value: count() })
            .from(user)
            .where(eq(user.isSiteAdmin, true));
          if ((adminCount?.value ?? 0) <= 1) {
            return {
              error: "cannot_remove_last_site_admin" as const,
              status: 400 as const,
            };
          }
          if (targetUserId === actorUserId) {
            return {
              error: "cannot_remove_own_site_admin" as const,
              status: 400 as const,
            };
          }
        }

        const [updated] = await tx
          .update(user)
          .set({ isSiteAdmin })
          .where(eq(user.id, targetUserId))
          .returning({
            id: user.id,
            email: user.email,
            name: user.name,
            isSiteAdmin: user.isSiteAdmin,
          });

        if (!updated)
          return { error: "user_not_found" as const, status: 404 as const };
        if (before.isSiteAdmin !== updated.isSiteAdmin) {
          await recordAdminAuditEvent(
            {
              actorUserId,
              action: updated.isSiteAdmin
                ? "site_admin.grant"
                : "site_admin.revoke",
              target: {
                targetType: "user",
                targetId: targetUserId,
                targetUserId,
              },
              before: { isSiteAdmin: before.isSiteAdmin },
              after: { isSiteAdmin: updated.isSiteAdmin },
              metadata: {
                targetEmail: updated.email,
              },
            },
            tx,
          );
        }
        return { user: updated };
      });

      if ("error" in result) {
        return c.json({ error: result.error }, result.status);
      }
      return c.json({ user: result.user });
    },
  )
  .patch(
    "/users/:userId/plan",
    zValidator("json", userPlanSchema),
    async (c) => {
      const actorUserId = c.get("userId");
      const targetUserId = c.req.param("userId");
      const { plan } = c.req.valid("json");
      const result = await db.transaction(async (tx) => {
        const [before] = await tx
          .select({
            id: user.id,
            email: user.email,
            name: user.name,
            plan: user.plan,
          })
          .from(user)
          .where(eq(user.id, targetUserId))
          .limit(1);

        if (!before)
          return { error: "user_not_found" as const, status: 404 as const };

        const [updated] = await tx
          .update(user)
          .set({ plan })
          .where(eq(user.id, targetUserId))
          .returning({
            id: user.id,
            email: user.email,
            name: user.name,
            plan: user.plan,
          });

        if (!updated)
          return { error: "user_not_found" as const, status: 404 as const };
        if (before.plan !== updated.plan) {
          await recordAdminAuditEvent(
            {
              actorUserId,
              action: "user.plan.update",
              target: {
                targetType: "user",
                targetId: targetUserId,
                targetUserId,
              },
              before: { plan: before.plan },
              after: { plan: updated.plan },
              metadata: {
                targetEmail: updated.email,
              },
            },
            tx,
          );
        }
        return { user: updated };
      });

      if ("error" in result) {
        return c.json({ error: result.error }, result.status);
      }
      return c.json({ user: result.user });
    },
  )
  .patch(
    "/workspaces/plan",
    zValidator("json", bulkWorkspacePlanSchema),
    async (c) => {
      const actorUserId = c.get("userId");
      const { workspaceIds, planType } = c.req.valid("json");
      const uniqueWorkspaceIds = Array.from(new Set(workspaceIds));

      const result = await db.transaction(async (tx) => {
        const beforeRows = await tx
          .select({
            id: workspaces.id,
            slug: workspaces.slug,
            planType: workspaces.planType,
          })
          .from(workspaces)
          .where(inArray(workspaces.id, uniqueWorkspaceIds));
        const changingRows = beforeRows.filter(
          (row) => row.planType !== planType,
        );
        if (changingRows.length === 0) return { updated: 0 };

        const updatedRows = await tx
          .update(workspaces)
          .set({ planType })
          .where(inArray(workspaces.id, changingRows.map((row) => row.id)))
          .returning({
            id: workspaces.id,
            slug: workspaces.slug,
            planType: workspaces.planType,
          });

        for (const updated of updatedRows) {
          const before = beforeRows.find((row) => row.id === updated.id);
          if (!before) continue;
          await recordAdminAuditEvent(
            {
              actorUserId,
              action: "workspace.plan.update",
              target: {
                targetType: "workspace",
                targetId: updated.id,
                targetWorkspaceId: updated.id,
              },
              before: { planType: before.planType },
              after: { planType: updated.planType },
              metadata: { workspaceSlug: updated.slug },
            },
            tx,
          );
        }

        return { updated: updatedRows.length };
      });

      return c.json({ updated: result.updated });
    },
  )
  .patch(
    "/workspaces/:workspaceId/plan",
    zValidator("json", workspacePlanSchema),
    async (c) => {
      const actorUserId = c.get("userId");
      const workspaceId = c.req.param("workspaceId");
      const { planType } = c.req.valid("json");
      const result = await db.transaction(async (tx) => {
        const [before] = await tx
          .select({
            id: workspaces.id,
            slug: workspaces.slug,
            name: workspaces.name,
            planType: workspaces.planType,
          })
          .from(workspaces)
          .where(eq(workspaces.id, workspaceId))
          .limit(1);

        if (!before)
          return {
            error: "workspace_not_found" as const,
            status: 404 as const,
          };

        const [updated] = await tx
          .update(workspaces)
          .set({ planType })
          .where(eq(workspaces.id, workspaceId))
          .returning({
            id: workspaces.id,
            slug: workspaces.slug,
            name: workspaces.name,
            planType: workspaces.planType,
          });

        if (!updated)
          return {
            error: "workspace_not_found" as const,
            status: 404 as const,
          };
        if (before.planType !== updated.planType) {
          await recordAdminAuditEvent(
            {
              actorUserId,
              action: "workspace.plan.update",
              target: {
                targetType: "workspace",
                targetId: workspaceId,
                targetWorkspaceId: workspaceId,
              },
              before: { planType: before.planType },
              after: { planType: updated.planType },
              metadata: {
                workspaceSlug: updated.slug,
              },
            },
            tx,
          );
        }
        return { workspace: updated };
      });

      if ("error" in result) {
        return c.json({ error: result.error }, result.status);
      }
      return c.json({ workspace: result.workspace });
    },
  )
  .patch(
    "/reports/status",
    zValidator("json", bulkReportStatusSchema),
    async (c) => {
      const actorUserId = c.get("userId");
      const { reportIds, status } = c.req.valid("json");
      const uniqueReportIds = Array.from(new Set(reportIds));
      const terminal = status === "resolved" || status === "closed";

      const result = await db.transaction(async (tx) => {
        const beforeRows = await tx
          .select({
            id: siteAdminReports.id,
            status: siteAdminReports.status,
            title: siteAdminReports.title,
          })
          .from(siteAdminReports)
          .where(inArray(siteAdminReports.id, uniqueReportIds));
        const changingRows = beforeRows.filter((row) => row.status !== status);
        if (changingRows.length === 0) return { updated: 0 };

        const updatedRows = await tx
          .update(siteAdminReports)
          .set({
            status,
            resolvedByUserId: terminal ? actorUserId : null,
            resolvedAt: terminal ? new Date() : null,
          })
          .where(
            inArray(
              siteAdminReports.id,
              changingRows.map((row) => row.id),
            ),
          )
          .returning({
            id: siteAdminReports.id,
            status: siteAdminReports.status,
          });

        for (const updated of updatedRows) {
          const before = beforeRows.find((row) => row.id === updated.id);
          if (!before) continue;
          await recordAdminAuditEvent(
            {
              actorUserId,
              action: "report.status.update",
              target: {
                targetType: "report",
                targetId: updated.id,
                targetReportId: updated.id,
              },
              before: { status: before.status },
              after: { status: updated.status },
              metadata: { reportTitle: before.title },
            },
            tx,
          );
        }

        return { updated: updatedRows.length };
      });

      return c.json({ updated: result.updated });
    },
  )
  .patch(
    "/reports/:reportId/status",
    zValidator("json", reportStatusSchema),
    async (c) => {
      const actorUserId = c.get("userId");
      const reportId = c.req.param("reportId");
      const { status } = c.req.valid("json");
      const result = await db.transaction(async (tx) => {
        const [before] = await tx
          .select({
            id: siteAdminReports.id,
            status: siteAdminReports.status,
            title: siteAdminReports.title,
          })
          .from(siteAdminReports)
          .where(eq(siteAdminReports.id, reportId))
          .limit(1);

        if (!before)
          return { error: "report_not_found" as const, status: 404 as const };

        const terminal = status === "resolved" || status === "closed";
        const [updated] = await tx
          .update(siteAdminReports)
          .set({
            status,
            resolvedByUserId: terminal ? actorUserId : null,
            resolvedAt: terminal ? new Date() : null,
          })
          .where(eq(siteAdminReports.id, reportId))
          .returning({
            id: siteAdminReports.id,
            status: siteAdminReports.status,
            resolvedAt: siteAdminReports.resolvedAt,
          });

        if (!updated)
          return { error: "report_not_found" as const, status: 404 as const };
        if (before.status !== updated.status) {
          await recordAdminAuditEvent(
            {
              actorUserId,
              action: "report.status.update",
              target: {
                targetType: "report",
                targetId: reportId,
                targetReportId: reportId,
              },
              before: { status: before.status },
              after: { status: updated.status },
              metadata: {
                reportTitle: before.title,
              },
            },
            tx,
          );
        }
        return { report: updated };
      });

      if ("error" in result) {
        return c.json({ error: result.error }, result.status);
      }
      return c.json({
        report: {
          ...result.report,
          resolvedAt: iso(result.report.resolvedAt),
        },
      });
    },
  );
