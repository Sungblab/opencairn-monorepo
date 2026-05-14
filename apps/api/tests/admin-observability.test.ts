import { afterEach, describe, expect, it } from "vitest";
import {
  apiRequestLogs,
  db,
  eq,
  llmUsageEvents,
  sql,
  user,
} from "@opencairn/db";
import { createApp } from "../src/app.js";
import { recordLlmUsageEvent } from "../src/lib/llm-usage.js";
import { createUser, type CreatedUser } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

process.env.API_REQUEST_LOGGING_ENABLED = "true";

const app = createApp();
const createdUsers = new Set<string>();
const createdLlmEvents = new Set<string>();

afterEach(async () => {
  for (const id of createdLlmEvents) {
    await db.delete(llmUsageEvents).where(eq(llmUsageEvents.id, id));
  }
  createdLlmEvents.clear();
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
