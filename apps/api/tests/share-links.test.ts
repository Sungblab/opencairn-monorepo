import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "../src/app.js";
import { db, shareLinks, notes, eq } from "@opencairn/db";
import {
  seedMultiRoleWorkspace,
  seedWorkspace,
  type SeedMultiRoleResult,
  type SeedResult,
} from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

// Plan 2C Task 3 — share routes integration tests.
// Real Postgres (no mocks). Each test seeds a fresh multi-role workspace and
// cleans it up. Where the plan calls for an "outsider", we spawn a separate
// `seedWorkspace({role: "owner"})` so the outsider has no membership at all
// in the target workspace.

describe("POST /api/notes/:id/share", () => {
  let seed: SeedMultiRoleResult;
  beforeEach(async () => {
    seed = await seedMultiRoleWorkspace();
  });
  afterEach(async () => {
    await seed.cleanup();
  });

  it("owner creates a new active share link with default viewer role", async () => {
    const app = createApp();
    const res = await app.request(`/api/notes/${seed.noteId}/share`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: await signSessionCookie(seed.ownerUserId),
      },
      body: JSON.stringify({ role: "viewer" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.role).toBe("viewer");
    expect(typeof body.id).toBe("string");
  });

  it("returns existing active link with same role (idempotent, 200)", async () => {
    const app = createApp();
    const cookie = await signSessionCookie(seed.ownerUserId);
    const first = await app
      .request(`/api/notes/${seed.noteId}/share`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ role: "viewer" }),
      })
      .then((r) => r.json());
    const res = await app.request(`/api/notes/${seed.noteId}/share`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ role: "viewer" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe(first.token);
    expect(body.id).toBe(first.id);
  });

  it("creates a separate token for a different role", async () => {
    const app = createApp();
    const cookie = await signSessionCookie(seed.ownerUserId);
    const a = await app
      .request(`/api/notes/${seed.noteId}/share`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ role: "viewer" }),
      })
      .then((r) => r.json());
    const b = await app
      .request(`/api/notes/${seed.noteId}/share`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ role: "commenter" }),
      })
      .then((r) => r.json());
    expect(b.token).not.toBe(a.token);
    expect(b.role).toBe("commenter");
  });

  it("rejects with 403 when caller is not a workspace member", async () => {
    const outsider: SeedResult = await seedWorkspace({ role: "owner" });
    try {
      const app = createApp();
      const res = await app.request(`/api/notes/${seed.noteId}/share`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: await signSessionCookie(outsider.userId),
        },
        body: JSON.stringify({ role: "viewer" }),
      });
      expect(res.status).toBe(403);
    } finally {
      await outsider.cleanup();
    }
  });
});

describe("GET /api/notes/:id/share", () => {
  let seed: SeedMultiRoleResult;
  beforeEach(async () => {
    seed = await seedMultiRoleWorkspace();
  });
  afterEach(async () => {
    await seed.cleanup();
  });

  it("lists active links for the note", async () => {
    const app = createApp();
    const cookie = await signSessionCookie(seed.ownerUserId);
    await app.request(`/api/notes/${seed.noteId}/share`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ role: "viewer" }),
    });
    const res = await app.request(`/api/notes/${seed.noteId}/share`, {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.links)).toBe(true);
    expect(body.links.length).toBe(1);
    expect(body.links[0].role).toBe("viewer");
    expect(body.links[0].createdBy.id).toBe(seed.ownerUserId);
  });
});

describe("DELETE /api/share/:shareId", () => {
  let seed: SeedMultiRoleResult;
  beforeEach(async () => {
    seed = await seedMultiRoleWorkspace();
  });
  afterEach(async () => {
    await seed.cleanup();
  });

  it("soft-revokes the link, idempotent on second call", async () => {
    const app = createApp();
    const cookie = await signSessionCookie(seed.ownerUserId);
    const created = await app
      .request(`/api/notes/${seed.noteId}/share`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ role: "viewer" }),
      })
      .then((r) => r.json());

    const res1 = await app.request(`/api/share/${created.id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(res1.status).toBe(204);

    const res2 = await app.request(`/api/share/${created.id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(res2.status).toBe(204);

    const [row] = await db
      .select()
      .from(shareLinks)
      .where(eq(shareLinks.id, created.id));
    expect(row).toBeDefined();
    expect(row.revokedAt).not.toBeNull();
  });
});

describe("GET /api/workspaces/:workspaceId/share", () => {
  let seed: SeedMultiRoleResult;
  beforeEach(async () => {
    seed = await seedMultiRoleWorkspace();
  });
  afterEach(async () => {
    await seed.cleanup();
  });

  it("owner sees workspace-wide active links", async () => {
    const app = createApp();
    const ownerCookie = await signSessionCookie(seed.ownerUserId);
    await app.request(`/api/notes/${seed.noteId}/share`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ role: "viewer" }),
    });
    const res = await app.request(
      `/api/workspaces/${seed.workspaceId}/share`,
      { headers: { cookie: ownerCookie } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.links.length).toBe(1);
    expect(body.links[0].noteId).toBe(seed.noteId);
    expect(body.links[0].noteTitle).toBeDefined();
  });

  it("non-admin (commenter) gets 403", async () => {
    const app = createApp();
    const memberCookie = await signSessionCookie(seed.commenterUserId);
    const res = await app.request(
      `/api/workspaces/${seed.workspaceId}/share`,
      { headers: { cookie: memberCookie } },
    );
    expect(res.status).toBe(403);
  });
});

describe("GET /api/public/share/:token", () => {
  let seed: SeedMultiRoleResult;
  beforeEach(async () => {
    seed = await seedMultiRoleWorkspace();
  });
  afterEach(async () => {
    await seed.cleanup();
  });

  it("returns Plate value + role without auth, no sensitive fields", async () => {
    const app = createApp();
    const cookie = await signSessionCookie(seed.ownerUserId);
    const created = await app
      .request(`/api/notes/${seed.noteId}/share`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ role: "viewer" }),
      })
      .then((r) => r.json());

    const res = await app.request(`/api/public/share/${created.token}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.note.id).toBe(seed.noteId);
    expect(body.note.role).toBe("viewer");
    expect(Array.isArray(body.note.plateValue)).toBe(true);
    // Sensitive fields MUST NOT leak.
    expect(body.note).not.toHaveProperty("workspaceId");
    expect(body.note).not.toHaveProperty("projectId");
    expect(body.note).not.toHaveProperty("createdBy");
  });

  it("404s for an unknown token", async () => {
    const app = createApp();
    const fakeToken = "x".repeat(43);
    const res = await app.request(`/api/public/share/${fakeToken}`);
    expect(res.status).toBe(404);
  });

  it("404s for a revoked link", async () => {
    const app = createApp();
    const cookie = await signSessionCookie(seed.ownerUserId);
    const created = await app
      .request(`/api/notes/${seed.noteId}/share`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ role: "viewer" }),
      })
      .then((r) => r.json());
    await app.request(`/api/share/${created.id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    const res = await app.request(`/api/public/share/${created.token}`);
    expect(res.status).toBe(404);
  });

  it("404s when the underlying note is soft-deleted", async () => {
    const app = createApp();
    const cookie = await signSessionCookie(seed.ownerUserId);
    const created = await app
      .request(`/api/notes/${seed.noteId}/share`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ role: "viewer" }),
      })
      .then((r) => r.json());
    await db
      .update(notes)
      .set({ deletedAt: new Date() })
      .where(eq(notes.id, seed.noteId));
    const res = await app.request(`/api/public/share/${created.token}`);
    expect(res.status).toBe(404);
  });
});
