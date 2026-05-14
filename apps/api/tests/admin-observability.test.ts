import { randomUUID } from "crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  agentActions,
  apiRequestLogs,
  db,
  eq,
  importJobs,
  jobs,
  llmUsageEvents,
  notes,
  projects,
  sql,
  user,
  workspaces,
} from "@opencairn/db";
import { createApp } from "../src/app.js";
import { recordLlmUsageEvent } from "../src/lib/llm-usage.js";
import {
  createUser,
  seedWorkspace,
  type CreatedUser,
  type SeedResult,
} from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

process.env.API_REQUEST_LOGGING_ENABLED = "true";

const app = createApp();
const createdUsers = new Set<string>();
const createdLlmEvents = new Set<string>();
const seededWorkspaces: SeedResult[] = [];

afterEach(async () => {
  await db.delete(importJobs).where(sql`${importJobs.errorSummary} = 'admin analytics test import failure'`);
  await db.delete(jobs).where(sql`${jobs.error} = 'admin analytics test job failure'`);
  for (const id of createdLlmEvents) {
    await db.delete(llmUsageEvents).where(eq(llmUsageEvents.id, id));
  }
  createdLlmEvents.clear();
  for (const seed of seededWorkspaces.splice(0)) {
    await seed.cleanup();
  }
  for (const id of createdUsers) {
    await db.delete(apiRequestLogs).where(eq(apiRequestLogs.userId, id));
    await db.delete(user).where(eq(user.id, id));
  }
  createdUsers.clear();
});

async function makeUser(): Promise<CreatedUser> {
  const created = await createUser();
  createdUsers.add(created.id);
  return created;
}

async function promoteSiteAdmin(userId: string): Promise<void> {
  await db.execute(sql`
    update "user"
    set is_site_admin = true
    where id = ${userId}
  `);
}

async function authedGet(path: string, userId: string): Promise<Response> {
  const cookie = await signSessionCookie(userId);
  return app.request(path, { headers: { cookie, "user-agent": "vitest" } });
}

describe("site admin observability routes", () => {
  it("exposes a detailed analytics command center for site admins", async () => {
    const caller = await makeUser();
    await promoteSiteAdmin(caller.id);
    const seed = await seedWorkspace({ role: "owner" });
    seededWorkspaces.push(seed);

    await db
      .update(user)
      .set({ plan: "max" })
      .where(eq(user.id, seed.userId));
    await db
      .update(workspaces)
      .set({ planType: "pro" })
      .where(eq(workspaces.id, seed.workspaceId));
    await db.insert(notes).values({
      projectId: seed.projectId,
      workspaceId: seed.workspaceId,
      title: "admin analytics extra note",
      inheritParent: true,
    });
    await db.insert(projects).values({
      workspaceId: seed.workspaceId,
      name: "admin analytics extra project",
      createdBy: seed.userId,
      defaultRole: "editor",
    });
    await db.insert(agentActions).values([
      {
        requestId: randomUUID(),
        workspaceId: seed.workspaceId,
        projectId: seed.projectId,
        actorUserId: seed.userId,
        kind: "note.update",
        status: "approval_required",
        risk: "write",
      },
      {
        requestId: randomUUID(),
        workspaceId: seed.workspaceId,
        projectId: seed.projectId,
        actorUserId: seed.userId,
        kind: "file.generate",
        status: "failed",
        risk: "expensive",
        errorCode: "provider_timeout",
      },
    ]);
    await db.insert(jobs).values({
      userId: seed.userId,
      projectId: seed.projectId,
      type: "ingest",
      status: "failed",
      error: "admin analytics test job failure",
    });
    await db.insert(importJobs).values({
      userId: seed.userId,
      workspaceId: seed.workspaceId,
      targetProjectId: seed.projectId,
      workflowId: `admin-analytics-test-${randomUUID()}`,
      source: "markdown_zip",
      status: "failed",
      sourceMetadata: {},
      errorSummary: "admin analytics test import failure",
    });
    await db.insert(apiRequestLogs).values([
      {
        requestId: randomUUID(),
        method: "GET",
        path: "/api/admin/analytics-test",
        statusCode: 200,
        durationMs: 40,
        userId: seed.userId,
      },
      {
        requestId: randomUUID(),
        method: "POST",
        path: "/api/admin/analytics-test",
        statusCode: 503,
        durationMs: 800,
        userId: seed.userId,
      },
    ]);
    const event = await recordLlmUsageEvent({
      userId: seed.userId,
      workspaceId: seed.workspaceId,
      provider: "gemini",
      model: "gemini-3-flash-preview",
      operation: "document.generate",
      tokensIn: 250_000,
      tokensOut: 125_000,
      sourceType: "admin_analytics_test",
      sourceId: seed.projectId,
    });
    createdLlmEvents.add(event.id);

    const res = await authedGet("/api/admin/analytics", caller.id);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      overview: {
        users: { total: number; new30d: number };
        content: { workspaces: number; projects: number; notes: number };
        api: { calls30d: number; failureRate30d: number; p95DurationMs30d: number };
        llm: { tokens30d: number; costKrw30d: number };
      };
      breakdowns: {
        userPlans: Array<{ label: string; value: number; percent: number }>;
        workspacePlans: Array<{ label: string; value: number; percent: number }>;
        agentActionStatuses: Array<{ label: string; value: number; percent: number }>;
        usageActions: Array<{ label: string; value: number; percent: number }>;
      };
      operations: {
        health: {
          failedJobs: number;
          failedImports: number;
          failedAgentActions: number;
          approvalRequired: number;
        };
        riskQueue: Array<{ source: string; label: string; status: string }>;
      };
      trends: {
        apiCallsDaily: Array<{ date: string; total: number; failures: number }>;
        llmCostDaily: Array<{ date: string; costKrw: number; tokens: number }>;
      };
    };
    expect(body.overview.users.total).toBeGreaterThanOrEqual(2);
    expect(body.overview.content.workspaces).toBeGreaterThanOrEqual(1);
    expect(body.overview.content.projects).toBeGreaterThanOrEqual(2);
    expect(body.overview.content.notes).toBeGreaterThanOrEqual(2);
    expect(body.overview.api.calls30d).toBeGreaterThanOrEqual(2);
    expect(body.overview.api.failureRate30d).toBeGreaterThan(0);
    expect(body.overview.api.p95DurationMs30d).toBeGreaterThanOrEqual(40);
    expect(body.overview.llm.tokens30d).toBeGreaterThanOrEqual(375_000);
    expect(body.overview.llm.costKrw30d).toBeGreaterThan(0);
    expect(body.breakdowns.userPlans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "max", value: expect.any(Number) }),
      ]),
    );
    expect(body.breakdowns.workspacePlans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "pro", value: expect.any(Number) }),
      ]),
    );
    expect(body.breakdowns.agentActionStatuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "failed", value: expect.any(Number) }),
        expect.objectContaining({
          label: "approval_required",
          value: expect.any(Number),
        }),
      ]),
    );
    expect(body.operations.health).toMatchObject({
      failedJobs: expect.any(Number),
      failedImports: expect.any(Number),
      failedAgentActions: expect.any(Number),
      approvalRequired: expect.any(Number),
    });
    expect(body.operations.riskQueue).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "agent_action", status: "failed" }),
        expect.objectContaining({ source: "job", status: "failed" }),
        expect.objectContaining({ source: "import", status: "failed" }),
      ]),
    );
    expect(body.trends.apiCallsDaily.length).toBeGreaterThan(0);
    expect(body.trends.llmCostDaily.length).toBeGreaterThan(0);
  });

  it("exposes hosted readiness signals in the admin overview", async () => {
    const caller = await makeUser();
    await promoteSiteAdmin(caller.id);
    const originalEnv = {
      RESEND_API_KEY: process.env.RESEND_API_KEY,
      S3_ENDPOINT: process.env.S3_ENDPOINT,
      S3_BUCKET: process.env.S3_BUCKET,
      S3_ACCESS_KEY: process.env.S3_ACCESS_KEY,
      S3_SECRET_KEY: process.env.S3_SECRET_KEY,
      SENTRY_DSN: process.env.SENTRY_DSN,
      NEXT_PUBLIC_GOOGLE_ANALYTICS_ID:
        process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID,
      NEXT_PUBLIC_META_PIXEL_ID: process.env.NEXT_PUBLIC_META_PIXEL_ID,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      GEMINI_MONTHLY_SPEND_CAP_KRW: process.env.GEMINI_MONTHLY_SPEND_CAP_KRW,
      R2_BACKUP_BUCKET: process.env.R2_BACKUP_BUCKET,
      R2_BACKUP_ENDPOINT: process.env.R2_BACKUP_ENDPOINT,
      R2_BACKUP_ACCESS_KEY: process.env.R2_BACKUP_ACCESS_KEY,
      R2_BACKUP_SECRET_KEY: process.env.R2_BACKUP_SECRET_KEY,
    };

    try {
      process.env.RESEND_API_KEY = "test-resend";
      process.env.S3_ENDPOINT = "https://r2.example";
      process.env.S3_BUCKET = "opencairn-test";
      process.env.S3_ACCESS_KEY = "test-access";
      process.env.S3_SECRET_KEY = "test-secret";
      process.env.SENTRY_DSN = "https://example@sentry.example/1";
      process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID = "G-TEST";
      process.env.NEXT_PUBLIC_META_PIXEL_ID = "123456";
      process.env.GEMINI_API_KEY = "test-gemini";
      process.env.GEMINI_MONTHLY_SPEND_CAP_KRW = "250000";
      process.env.R2_BACKUP_BUCKET = "opencairn-db-backups";
      process.env.R2_BACKUP_ENDPOINT = "https://r2.example";
      process.env.R2_BACKUP_ACCESS_KEY = "test-backup-access";
      process.env.R2_BACKUP_SECRET_KEY = "test-backup-secret";

      const res = await authedGet("/api/admin/overview", caller.id);

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        system: {
          readiness: {
            email: boolean;
            objectStorage: boolean;
            sentry: boolean;
            googleAnalytics: boolean;
            metaPixel: boolean;
            geminiApi: boolean;
            geminiSpendCap: boolean;
            databaseBackups: boolean;
          };
        };
      };
      expect(body.system.readiness).toEqual({
        email: true,
        objectStorage: true,
        sentry: true,
        googleAnalytics: true,
        metaPixel: true,
        geminiApi: true,
        geminiSpendCap: true,
        databaseBackups: true,
      });
    } finally {
      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  it("records API requests and exposes them to site admins", async () => {
    const caller = await makeUser();
    await promoteSiteAdmin(caller.id);

    const usersRes = await authedGet("/api/admin/users", caller.id);
    expect(usersRes.status).toBe(200);

    const logsRes = await authedGet("/api/admin/api-logs", caller.id);
    expect(logsRes.status).toBe(200);
    const body = (await logsRes.json()) as {
      logs: Array<{
        method: string;
        path: string;
        statusCode: number;
        userId: string | null;
        durationMs: number;
      }>;
    };

    expect(body.logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "GET",
          path: "/api/admin/users",
          statusCode: 200,
          userId: caller.id,
        }),
      ]),
    );
    expect(body.logs[0]?.durationMs).toEqual(expect.any(Number));

    const overviewRes = await authedGet("/api/admin/overview", caller.id);
    expect(overviewRes.status).toBe(200);
    const overview = (await overviewRes.json()) as {
      stats: { mau30d: number; apiCalls30d: number };
    };
    expect(overview.stats.mau30d).toBeGreaterThanOrEqual(1);
    expect(overview.stats.apiCalls30d).toBeGreaterThanOrEqual(1);
  });

  it("aggregates recorded LLM token cost for site admins", async () => {
    const caller = await makeUser();
    await promoteSiteAdmin(caller.id);

    const event = await recordLlmUsageEvent({
      userId: caller.id,
      workspaceId: null,
      provider: "gemini",
      model: "gemini-3-flash-preview",
      operation: "chat.stream",
      tokensIn: 1_000_000,
      tokensOut: 1_000_000,
      sourceType: "test",
      sourceId: caller.id,
    });
    createdLlmEvents.add(event.id);

    const res = await authedGet("/api/admin/llm-usage", caller.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      totals: {
        tokensIn: number;
        tokensOut: number;
        costUsd: number;
        costKrw: number;
      };
      byModel: Array<{ provider: string; model: string; costUsd: number }>;
      recentEvents: Array<{ id: string; operation: string; costUsd: number }>;
    };

    expect(body.totals).toMatchObject({
      tokensIn: expect.any(Number),
      tokensOut: expect.any(Number),
      costUsd: expect.any(Number),
      costKrw: expect.any(Number),
    });
    expect(body.totals.costUsd).toBeGreaterThanOrEqual(0.375);
    expect(body.totals.costKrw).toBeGreaterThanOrEqual(618.75);
    expect(body.byModel).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "gemini",
          model: "gemini-3-flash-preview",
        }),
      ]),
    );
    expect(body.recentEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: event.id, operation: "chat.stream" }),
      ]),
    );
  });
});
