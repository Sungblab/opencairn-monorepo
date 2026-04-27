import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { db, notifications, eq, user } from "@opencairn/db";
import { createApp } from "../src/app.js";
import { createUser } from "./helpers/seed.js";

// POST /api/internal/notifications — generic publish surface used by Temporal
// activities (currently finalize_import_job; future Super Admin Console).
// The route must validate the kind enum + non-empty payload.summary before
// landing a row, since worker callers swallow non-2xx responses (best-effort
// fire-and-forget) and a silently-rejected publish would never reach the
// drawer.

const SECRET = "test-internal-secret-abc";
process.env.INTERNAL_API_SECRET = SECRET;

const app = createApp();
const createdUserIds = new Set<string>();

afterEach(async () => {
  for (const id of createdUserIds) {
    await db.delete(user).where(eq(user.id, id));
  }
  createdUserIds.clear();
});

async function internalPost(body: unknown, headers: Record<string, string> = {}) {
  return app.request("/api/internal/notifications", {
    method: "POST",
    headers: {
      "X-Internal-Secret": SECRET,
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/internal/notifications", () => {
  it("persists a row and returns the id on a valid request", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const res = await internalPost({
      userId: u.id,
      kind: "system",
      payload: {
        summary: "import done",
        level: "info",
        refType: "import_job",
        refId: randomUUID(),
      },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    const [row] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, body.id));
    expect(row.userId).toBe(u.id);
    expect(row.kind).toBe("system");
    expect((row.payload as Record<string, unknown>).summary).toBe("import done");
  });

  it("401 without the shared secret", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const res = await app.request("/api/internal/notifications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userId: u.id,
        kind: "system",
        payload: { summary: "no secret" },
      }),
    });
    expect(res.status).toBe(401);
  });

  it("400 when kind is not in the enum", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const res = await internalPost({
      userId: u.id,
      kind: "import_done", // <- not in notification_kind enum
      payload: { summary: "x" },
    });
    expect(res.status).toBe(400);
  });

  it("400 when payload.summary is missing", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const res = await internalPost({
      userId: u.id,
      kind: "system",
      payload: { level: "info" }, // <- no summary
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error.toLowerCase()).toContain("summary");
  });

  it("400 when payload.summary is the empty string", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const res = await internalPost({
      userId: u.id,
      kind: "system",
      payload: { summary: "" },
    });
    expect(res.status).toBe(400);
  });

  it("400 when summary exceeds the 2000-char ceiling", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const res = await internalPost({
      userId: u.id,
      kind: "system",
      payload: { summary: "x".repeat(2001) },
    });
    expect(res.status).toBe(400);
  });

  it("400 when userId is not a uuid", async () => {
    const res = await internalPost({
      userId: "not-a-uuid",
      kind: "system",
      payload: { summary: "x" },
    });
    expect(res.status).toBe(400);
  });

  it("accepts every kind in the enum", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    for (const kind of [
      "mention",
      "comment_reply",
      "research_complete",
      "share_invite",
      "system",
    ] as const) {
      const res = await internalPost({
        userId: u.id,
        kind,
        payload: { summary: `${kind} test` },
      });
      expect(res.status, `kind=${kind} should be accepted`).toBe(201);
    }
  });
});
