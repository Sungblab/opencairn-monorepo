import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "../src/app.js";
import {
  db,
  pagePermissions,
  notifications,
  eq,
  and,
  desc,
} from "@opencairn/db";
import {
  seedMultiRoleWorkspace,
  seedWorkspace,
  type SeedMultiRoleResult,
  type SeedResult,
} from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

// Plan 2C Task 4 — per-note permissions routes + share_invite notifications.
// Real Postgres (no mocks). Each test seeds a fresh multi-role workspace and
// cleans it up. Outsiders are spawned via a separate seedWorkspace.

async function latestShareInvite(userId: string) {
  const [row] = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.kind, "share_invite"),
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(1);
  return row;
}

async function shareInviteCount(userId: string): Promise<number> {
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.kind, "share_invite"),
      ),
    );
  return rows.length;
}

describe("POST /api/notes/:id/permissions", () => {
  let seed: SeedMultiRoleResult;
  beforeEach(async () => {
    seed = await seedMultiRoleWorkspace();
  });
  afterEach(async () => {
    await seed.cleanup();
  });

  it("owner grants viewer to another workspace member, fires share_invite", async () => {
    const app = createApp();
    const cookie = await signSessionCookie(seed.ownerUserId);
    // Pick a workspace member who has no explicit page permission yet
    // — viewerUser has none on the shared note.
    const target = seed.viewerUserId;

    const res = await app.request(
      `/api/notes/${seed.noteId}/permissions`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ userId: target, role: "viewer" }),
      },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.permission.userId).toBe(target);
    expect(body.permission.role).toBe("viewer");

    const [row] = await db
      .select()
      .from(pagePermissions)
      .where(
        and(
          eq(pagePermissions.pageId, seed.noteId),
          eq(pagePermissions.userId, target),
        ),
      );
    expect(row).toBeDefined();
    expect(row.role).toBe("viewer");
    expect(row.grantedBy).toBe(seed.ownerUserId);

    const note = await latestShareInvite(target);
    expect(note).toBeDefined();
    expect(note.kind).toBe("share_invite");
    const payload = note.payload as Record<string, unknown>;
    expect(payload.noteId).toBe(seed.noteId);
    expect(payload.role).toBe("viewer");
    expect(payload.fromUserId).toBe(seed.ownerUserId);
    expect(typeof payload.summary).toBe("string");
    expect(typeof payload.noteTitle).toBe("string");
  });

  it("rejects when target is not a workspace member (400)", async () => {
    const outsider: SeedResult = await seedWorkspace({ role: "owner" });
    try {
      const app = createApp();
      const cookie = await signSessionCookie(seed.ownerUserId);
      const res = await app.request(
        `/api/notes/${seed.noteId}/permissions`,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({
            userId: outsider.userId,
            role: "viewer",
          }),
        },
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("not_workspace_member");
    } finally {
      await outsider.cleanup();
    }
  });

  it("self-grant skips notification fan-out", async () => {
    const app = createApp();
    const cookie = await signSessionCookie(seed.ownerUserId);
    const before = await shareInviteCount(seed.ownerUserId);
    const res = await app.request(
      `/api/notes/${seed.noteId}/permissions`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          userId: seed.ownerUserId,
          role: "editor",
        }),
      },
    );
    expect(res.status).toBe(201);
    const after = await shareInviteCount(seed.ownerUserId);
    expect(after).toBe(before);
  });

  it("rejects 403 when caller lacks canWrite (commenter)", async () => {
    const app = createApp();
    const cookie = await signSessionCookie(seed.commenterUserId);
    const res = await app.request(
      `/api/notes/${seed.noteId}/permissions`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          userId: seed.viewerUserId,
          role: "viewer",
        }),
      },
    );
    expect(res.status).toBe(403);
  });

  it("rejects role=none via Zod enum (400)", async () => {
    const app = createApp();
    const cookie = await signSessionCookie(seed.ownerUserId);
    const res = await app.request(
      `/api/notes/${seed.noteId}/permissions`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          userId: seed.viewerUserId,
          role: "none",
        }),
      },
    );
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/notes/:id/permissions/:userId", () => {
  let seed: SeedMultiRoleResult;
  beforeEach(async () => {
    seed = await seedMultiRoleWorkspace();
  });
  afterEach(async () => {
    await seed.cleanup();
  });

  it("role change (viewer → editor) fires a new share_invite", async () => {
    const app = createApp();
    const cookie = await signSessionCookie(seed.ownerUserId);
    const target = seed.viewerUserId;
    // Seed an initial viewer grant
    await app.request(`/api/notes/${seed.noteId}/permissions`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ userId: target, role: "viewer" }),
    });
    const before = await shareInviteCount(target);

    const res = await app.request(
      `/api/notes/${seed.noteId}/permissions/${target}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ role: "editor" }),
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.permission.role).toBe("editor");

    const after = await shareInviteCount(target);
    expect(after).toBe(before + 1);
    const latest = await latestShareInvite(target);
    expect((latest.payload as Record<string, unknown>).role).toBe("editor");
  });

  it("same-role no-op does not fire a new notification", async () => {
    const app = createApp();
    const cookie = await signSessionCookie(seed.ownerUserId);
    const target = seed.viewerUserId;
    await app.request(`/api/notes/${seed.noteId}/permissions`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ userId: target, role: "viewer" }),
    });
    const before = await shareInviteCount(target);

    const res = await app.request(
      `/api/notes/${seed.noteId}/permissions/${target}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ role: "viewer" }),
      },
    );
    expect(res.status).toBe(200);
    const after = await shareInviteCount(target);
    expect(after).toBe(before);
  });
});

describe("DELETE /api/notes/:id/permissions/:userId", () => {
  let seed: SeedMultiRoleResult;
  beforeEach(async () => {
    seed = await seedMultiRoleWorkspace();
  });
  afterEach(async () => {
    await seed.cleanup();
  });

  it("removes the row and returns 204", async () => {
    const app = createApp();
    const cookie = await signSessionCookie(seed.ownerUserId);
    const target = seed.viewerUserId;
    await app.request(`/api/notes/${seed.noteId}/permissions`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ userId: target, role: "viewer" }),
    });

    const res = await app.request(
      `/api/notes/${seed.noteId}/permissions/${target}`,
      { method: "DELETE", headers: { cookie } },
    );
    expect(res.status).toBe(204);

    const rows = await db
      .select()
      .from(pagePermissions)
      .where(
        and(
          eq(pagePermissions.pageId, seed.noteId),
          eq(pagePermissions.userId, target),
        ),
      );
    expect(rows.length).toBe(0);
  });
});

describe("GET /api/notes/:id/permissions", () => {
  let seed: SeedMultiRoleResult;
  beforeEach(async () => {
    seed = await seedMultiRoleWorkspace();
  });
  afterEach(async () => {
    await seed.cleanup();
  });

  it("lists permissions with user join fields", async () => {
    const app = createApp();
    const cookie = await signSessionCookie(seed.ownerUserId);
    await app.request(`/api/notes/${seed.noteId}/permissions`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ userId: seed.viewerUserId, role: "viewer" }),
    });

    const res = await app.request(
      `/api/notes/${seed.noteId}/permissions`,
      { headers: { cookie } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.permissions)).toBe(true);
    const match = body.permissions.find(
      (p: { userId: string }) => p.userId === seed.viewerUserId,
    );
    expect(match).toBeDefined();
    expect(match.role).toBe("viewer");
    expect(typeof match.email).toBe("string");
    expect(typeof match.name).toBe("string");
    expect(match.grantedBy).toBe(seed.ownerUserId);
    expect(typeof match.createdAt).toBe("string");
  });
});

describe("GET /api/workspaces/:workspaceId/members/search", () => {
  let seed: SeedMultiRoleResult;
  beforeEach(async () => {
    seed = await seedMultiRoleWorkspace();
  });
  afterEach(async () => {
    await seed.cleanup();
  });

  it("returns matching members by partial email", async () => {
    const app = createApp();
    const cookie = await signSessionCookie(seed.ownerUserId);
    // The multi-role seed inserts users with email = `e2e-<uuid>@example.com`.
    // Search by the unique uuid prefix of editorUserId.
    const prefix = seed.editorUserId.slice(0, 8);
    const res = await app.request(
      `/api/workspaces/${seed.workspaceId}/members/search?q=${prefix}`,
      { headers: { cookie } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.members)).toBe(true);
    const match = body.members.find(
      (m: { userId: string }) => m.userId === seed.editorUserId,
    );
    expect(match).toBeDefined();
    expect(typeof match.email).toBe("string");
    expect(typeof match.name).toBe("string");
    expect(typeof match.role).toBe("string");
  });
});
