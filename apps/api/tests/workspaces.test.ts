import { randomBytes, randomUUID } from "node:crypto";
import { describe, it, expect, afterEach } from "vitest";
import {
  db,
  workspaces,
  workspaceMembers,
  workspaceInvites,
  user,
  eq,
} from "@opencairn/db";
import { createApp } from "../src/app.js";
import { createUser } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

const app = createApp();

const createdWorkspaceSlugs = new Set<string>();
const createdWorkspaceIds = new Set<string>();
const createdUserIds = new Set<string>();

async function authedPost(
  path: string,
  body: unknown,
): Promise<{ res: Response; userId: string }> {
  const u = await createUser();
  createdUserIds.add(u.id);
  const cookie = await signSessionCookie(u.id);
  const res = await app.request(path, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  // Track slug for cleanup if created
  if (res.status === 201) {
    const clone = res.clone();
    try {
      const json = (await clone.json()) as { slug?: string };
      if (json.slug) createdWorkspaceSlugs.add(json.slug);
    } catch {
      // ignore parse
    }
  }
  return { res, userId: u.id };
}

async function authedGet(
  path: string,
  userId: string,
): Promise<Response> {
  const cookie = await signSessionCookie(userId);
  return app.request(path, { headers: { cookie } });
}

async function seedMembership(
  userId: string,
  opts: { role?: "owner" | "admin" | "member" | "guest"; name?: string } = {},
): Promise<{ workspaceId: string; slug: string }> {
  const workspaceId = randomUUID();
  const slug = `test-ws-${workspaceId.slice(0, 8)}`;
  await db.insert(workspaces).values({
    id: workspaceId,
    slug,
    name: opts.name ?? "Test Workspace",
    ownerId: userId,
    planType: "free",
  });
  createdWorkspaceIds.add(workspaceId);
  createdWorkspaceSlugs.add(slug);
  await db.insert(workspaceMembers).values({
    workspaceId,
    userId,
    role: opts.role ?? "owner",
  });
  return { workspaceId, slug };
}

async function seedInvite(
  workspaceId: string,
  email: string,
  opts: { acceptedAt?: Date; expiresAt?: Date } = {},
): Promise<string> {
  const id = randomUUID();
  const expiresAt =
    opts.expiresAt ?? new Date(Date.now() + 1000 * 60 * 60 * 24);
  await db.insert(workspaceInvites).values({
    id,
    workspaceId,
    email,
    role: "member",
    token: randomBytes(16).toString("hex"),
    expiresAt,
    acceptedAt: opts.acceptedAt ?? null,
  });
  return id;
}

async function cleanup(): Promise<void> {
  for (const slug of createdWorkspaceSlugs) {
    await db.delete(workspaces).where(eq(workspaces.slug, slug));
  }
  createdWorkspaceSlugs.clear();
  createdWorkspaceIds.clear();
  for (const id of createdUserIds) {
    await db.delete(user).where(eq(user.id, id));
  }
  createdUserIds.clear();
}

describe("POST /api/workspaces reserved-slug validation", () => {
  afterEach(cleanup);

  it.each(["app", "api", "admin", "auth", "onboarding", "billing"])(
    "rejects reserved slug %s",
    async (slug) => {
      const { res } = await authedPost("/api/workspaces", {
        name: "Test",
        slug,
      });
      expect(res.status).toBe(400);
    },
  );

  it("accepts a non-reserved slug", async () => {
    const { res } = await authedPost("/api/workspaces", {
      name: "Test",
      slug: "my-team",
    });
    expect(res.status).toBe(201);
  });

  it("returns 409 on slug conflict", async () => {
    await authedPost("/api/workspaces", { name: "A", slug: "dup-slug" });
    const { res } = await authedPost("/api/workspaces", {
      name: "B",
      slug: "dup-slug",
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("slug_conflict");
  });

  it("rejects slug shorter than 3 chars", async () => {
    const { res } = await authedPost("/api/workspaces", {
      name: "Test",
      slug: "ab",
    });
    expect(res.status).toBe(400);
  });

  it("rejects slug longer than 40 chars", async () => {
    const { res } = await authedPost("/api/workspaces", {
      name: "Test",
      slug: "a".repeat(41),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/workspaces slug auto-generation", () => {
  afterEach(cleanup);

  it("derives slug from ASCII-compatible name when slug omitted", async () => {
    const { res } = await authedPost("/api/workspaces", { name: "My Team" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { slug: string };
    expect(body.slug).toBe("my-team");
  });

  it("falls back to `w-{hex}` when name has no ASCII", async () => {
    const { res } = await authedPost("/api/workspaces", { name: "내 작업공간" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { slug: string };
    expect(body.slug).toMatch(/^w-[a-f0-9]{8}$/);
  });

  it("auto-retries on derived-slug conflict with random fallback", async () => {
    // Occupy the ASCII-derived slug first.
    const first = await authedPost("/api/workspaces", {
      name: "Shared Name",
      slug: "shared-name",
    });
    expect(first.res.status).toBe(201);
    // Second call omits slug; derived clashes → must fall back to w-{hex}.
    const { res } = await authedPost("/api/workspaces", {
      name: "Shared Name",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { slug: string };
    expect(body.slug).toMatch(/^w-[a-f0-9]{8}$/);
  });

  it("respects user-supplied slug even when conflict would be auto-recoverable", async () => {
    await authedPost("/api/workspaces", { name: "A", slug: "taken" });
    const { res } = await authedPost("/api/workspaces", {
      name: "B",
      slug: "taken",
    });
    expect(res.status).toBe(409);
  });
});

describe("GET /api/workspaces/me", () => {
  afterEach(cleanup);

  it("returns empty arrays for user with no memberships or invites", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const res = await authedGet("/api/workspaces/me", u.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      workspaces: unknown[];
      invites: unknown[];
    };
    expect(body.workspaces).toEqual([]);
    expect(body.invites).toEqual([]);
  });

  it("returns workspaces the user is a member of with role", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const { workspaceId, slug } = await seedMembership(u.id, {
      role: "owner",
      name: "ACME",
    });
    const res = await authedGet("/api/workspaces/me", u.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      workspaces: Array<{
        id: string;
        slug: string;
        name: string;
        role: string;
      }>;
    };
    expect(body.workspaces).toHaveLength(1);
    expect(body.workspaces[0]).toMatchObject({
      id: workspaceId,
      slug,
      name: "ACME",
      role: "owner",
    });
  });

  it("includes pending invites addressed to the user's email", async () => {
    const inviter = await createUser();
    createdUserIds.add(inviter.id);
    const invitee = await createUser();
    createdUserIds.add(invitee.id);
    const { workspaceId } = await seedMembership(inviter.id, {
      name: "Invite Land",
    });
    const inviteId = await seedInvite(workspaceId, invitee.email);

    const res = await authedGet("/api/workspaces/me", invitee.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      invites: Array<{
        id: string;
        workspaceId: string;
        workspaceName: string;
        role: string;
      }>;
    };
    expect(body.invites).toHaveLength(1);
    expect(body.invites[0]).toMatchObject({
      id: inviteId,
      workspaceId,
      workspaceName: "Invite Land",
    });
  });

  it("excludes accepted or expired invites", async () => {
    const inviter = await createUser();
    createdUserIds.add(inviter.id);
    const invitee = await createUser();
    createdUserIds.add(invitee.id);
    const { workspaceId } = await seedMembership(inviter.id);
    // accepted invite
    await seedInvite(workspaceId, invitee.email, {
      acceptedAt: new Date(),
    });
    // expired invite (into a second workspace — partial unique allows it)
    const other = await seedMembership(inviter.id, { name: "Other" });
    await seedInvite(other.workspaceId, invitee.email, {
      expiresAt: new Date(Date.now() - 1000),
    });

    const res = await authedGet("/api/workspaces/me", invitee.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { invites: unknown[] };
    expect(body.invites).toEqual([]);
  });

  it("excludes invites addressed to other emails", async () => {
    const inviter = await createUser();
    createdUserIds.add(inviter.id);
    const me = await createUser();
    createdUserIds.add(me.id);
    const { workspaceId } = await seedMembership(inviter.id);
    await seedInvite(workspaceId, "someone-else@example.com");

    const res = await authedGet("/api/workspaces/me", me.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { invites: unknown[] };
    expect(body.invites).toEqual([]);
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await app.request("/api/workspaces/me");
    expect(res.status).toBe(401);
  });
});
