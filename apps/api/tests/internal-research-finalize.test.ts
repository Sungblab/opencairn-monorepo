import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import {
  db,
  notifications,
  researchRuns,
  eq,
  and,
} from "@opencairn/db";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";

// Plan 2C Task 6 — `PATCH /api/internal/research/runs/:id/finalize` is the
// callback the Temporal worker hits when a Deep Research workflow reaches
// a terminal state. Idempotency is critical: Temporal's RetryPolicy
// (maximum_attempts=5) means the same finalize call can land multiple times,
// and the `research_complete` notification must only fire on the FIRST
// transition to "completed". Failed/cancelled never notify.

// Use the canonical secret value shared with other internal-* tests so a
// stray cross-file env trample lands on a value the request still recognises.
// The auth middleware reads process.env.INTERNAL_API_SECRET at request time,
// so any order of writes into the env converges on the right value as long
// as every test agrees on the same string.
const SECRET = "test-internal-secret-abc";
process.env.INTERNAL_API_SECRET = SECRET;

const app = createApp();

async function internalFetch(
  path: string,
  init: RequestInit,
): Promise<Response> {
  return app.request(path, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      "X-Internal-Secret": SECRET,
      "content-type": "application/json",
    },
  });
}

describe("PATCH /api/internal/research/runs/:id/finalize", () => {
  let ctx: SeedResult;
  let runId: string;

  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "owner" });
    runId = randomUUID();
    await db.insert(researchRuns).values({
      id: runId,
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      userId: ctx.userId,
      topic: "carbon capture survey",
      model: "deep-research-preview-04-2026",
      billingPath: "byok",
      status: "researching",
      workflowId: runId,
    });
  });

  afterEach(async () => {
    // researchRuns must be deleted before the workspace cleanup tries to
    // drop projects/users — note FK is set null but the run row itself
    // references workspace/project/user with cascade, so workspace cascade
    // will catch it. Belt-and-suspenders: explicit delete keeps the test
    // isolation tight even if the cascade rules change.
    await db.delete(researchRuns).where(eq(researchRuns.id, runId));
    await ctx.cleanup();
  });

  it("transitions to completed, stamps completedAt, fires research_complete notification", async () => {
    const res = await internalFetch(
      `/api/internal/research/runs/${runId}/finalize`,
      {
        method: "PATCH",
        body: JSON.stringify({
          status: "completed",
          noteId: ctx.noteId,
        }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      alreadyFinalized: boolean;
    };
    expect(body.ok).toBe(true);
    expect(body.alreadyFinalized).toBe(false);

    const [row] = await db
      .select()
      .from(researchRuns)
      .where(eq(researchRuns.id, runId));
    expect(row!.status).toBe("completed");
    expect(row!.completedAt).not.toBeNull();

    const notifs = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, ctx.userId),
          eq(notifications.kind, "research_complete"),
        ),
      );
    expect(notifs).toHaveLength(1);
    const payload = notifs[0]!.payload as Record<string, unknown>;
    expect(payload.runId).toBe(runId);
    expect(payload.noteId).toBe(ctx.noteId);
    expect(payload.projectId).toBe(ctx.projectId);
    expect(payload.topic).toBe("carbon capture survey");
    expect(typeof payload.summary).toBe("string");
    expect(payload.summary as string).toContain("carbon capture survey");
  });

  it("is idempotent — second completed call returns alreadyFinalized:true and does not double-notify", async () => {
    const first = await internalFetch(
      `/api/internal/research/runs/${runId}/finalize`,
      {
        method: "PATCH",
        body: JSON.stringify({ status: "completed", noteId: ctx.noteId }),
      },
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { alreadyFinalized: boolean };
    expect(firstBody.alreadyFinalized).toBe(false);

    const second = await internalFetch(
      `/api/internal/research/runs/${runId}/finalize`,
      {
        method: "PATCH",
        body: JSON.stringify({ status: "completed", noteId: ctx.noteId }),
      },
    );
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { alreadyFinalized: boolean };
    expect(secondBody.alreadyFinalized).toBe(true);

    const notifs = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, ctx.userId),
          eq(notifications.kind, "research_complete"),
        ),
      );
    expect(notifs).toHaveLength(1);
  });

  it("transitions to failed with error captured, no notification fired", async () => {
    const res = await internalFetch(
      `/api/internal/research/runs/${runId}/finalize`,
      {
        method: "PATCH",
        body: JSON.stringify({
          status: "failed",
          errorCode: "rate_limit",
          errorMessage: "429 quota exceeded",
        }),
      },
    );
    expect(res.status).toBe(200);

    const [row] = await db
      .select()
      .from(researchRuns)
      .where(eq(researchRuns.id, runId));
    expect(row!.status).toBe("failed");
    expect(row!.error).toEqual({
      code: "rate_limit",
      message: "429 quota exceeded",
      retryable: false,
    });
    // Failed must NOT stamp completedAt — otherwise a later transition into
    // "completed" (workflow replay / manual recovery) would skip the
    // research_complete notification because previouslyCompleted is sticky.
    expect(row!.completedAt).toBeNull();

    const notifs = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, ctx.userId),
          eq(notifications.kind, "research_complete"),
        ),
      );
    expect(notifs).toHaveLength(0);
  });

  it("failed → completed still fires research_complete (completedAt stays null on failed)", async () => {
    const failed = await internalFetch(
      `/api/internal/research/runs/${runId}/finalize`,
      {
        method: "PATCH",
        body: JSON.stringify({
          status: "failed",
          errorCode: "transient",
          errorMessage: "transient backend hiccup",
        }),
      },
    );
    expect(failed.status).toBe(200);

    // Recovery: same run id transitions to completed. Notification MUST fire.
    const completed = await internalFetch(
      `/api/internal/research/runs/${runId}/finalize`,
      {
        method: "PATCH",
        body: JSON.stringify({ status: "completed", noteId: ctx.noteId }),
      },
    );
    expect(completed.status).toBe(200);
    const completedBody = (await completed.json()) as {
      alreadyFinalized: boolean;
    };
    expect(completedBody.alreadyFinalized).toBe(false);

    const notifs = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, ctx.userId),
          eq(notifications.kind, "research_complete"),
        ),
      );
    expect(notifs).toHaveLength(1);
  });

  it("transitions to cancelled, no notification fired", async () => {
    const res = await internalFetch(
      `/api/internal/research/runs/${runId}/finalize`,
      {
        method: "PATCH",
        body: JSON.stringify({ status: "cancelled" }),
      },
    );
    expect(res.status).toBe(200);

    const [row] = await db
      .select()
      .from(researchRuns)
      .where(eq(researchRuns.id, runId));
    expect(row!.status).toBe("cancelled");

    const notifs = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, ctx.userId),
          eq(notifications.kind, "research_complete"),
        ),
      );
    expect(notifs).toHaveLength(0);
  });

  it("returns 404 for an unknown run id", async () => {
    const ghost = randomUUID();
    const res = await internalFetch(
      `/api/internal/research/runs/${ghost}/finalize`,
      {
        method: "PATCH",
        body: JSON.stringify({ status: "completed" }),
      },
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });
});
