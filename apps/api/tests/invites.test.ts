import { describe, it, expect, afterEach } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { db, workspaces, workspaceMembers, workspaceInvites, user, and, eq } from "@opencairn/db";
import { createApp } from "../src/app.js";
import { createUser } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

const app = createApp();

interface SeededInvite {
  token: string;
  workspaceId: string;
  workspaceName: string;
  inviter: { id: string; email: string; name: string };
}

const createdWorkspaceIds = new Set<string>();
const createdUserIds = new Set<string>();

async function seedInvite(opts: {
  email?: string;
  expiresAt?: Date;
  acceptedAt?: Date | null;
}): Promise<SeededInvite> {
  const inviter = await createUser();
  createdUserIds.add(inviter.id);

  const workspaceId = randomUUID();
  const workspaceName = "Invite WS";
  await db.insert(workspaces).values({
    id: workspaceId,
    slug: `inv-${randomBytes(4).toString("hex")}`,
    name: workspaceName,
    ownerId: inviter.id,
    planType: "free",
  });
  createdWorkspaceIds.add(workspaceId);

  await db.insert(workspaceMembers).values({
    workspaceId,
    userId: inviter.id,
    role: "owner",
  });

  const token = randomBytes(32).toString("base64url");
  const { workspaceInvites } = await import("@opencairn/db");
  await db.insert(workspaceInvites).values({
    workspaceId,
    email:
      opts.email ?? `invitee-${randomBytes(4).toString("hex")}@ex.com`,
    role: "member",
    token,
    invitedBy: inviter.id,
    expiresAt:
      opts.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    acceptedAt: opts.acceptedAt ?? null,
  });
  return { token, workspaceId, workspaceName, inviter };
}

async function cleanup(): Promise<void> {
  // 내가 생성한 workspace만 삭제 → CASCADE로 members/invites 정리.
  for (const id of createdWorkspaceIds) {
    await db.delete(workspaces).where(eq(workspaces.id, id));
  }
  createdWorkspaceIds.clear();
  for (const id of createdUserIds) {
    await db.delete(user).where(eq(user.id, id));
  }
  createdUserIds.clear();
}

describe("GET /api/invites/:token", () => {
  afterEach(cleanup);

  it("returns invite metadata for a valid token", async () => {
    const { token, workspaceId, workspaceName, inviter } = await seedInvite({});
    const res = await app.request(`/api/invites/${token}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      workspaceId: string;
      workspaceName: string;
      inviterName: string;
      role: "admin" | "member" | "guest";
      email: string;
      expiresAt: string;
    };
    expect(body.workspaceId).toBe(workspaceId);
    expect(body.workspaceName).toBe(workspaceName);
    expect(body.inviterName).toBe(inviter.name);
    expect(body.role).toBe("member");
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("returns 404 for unknown token", async () => {
    const fake = randomBytes(32).toString("base64url");
    const res = await app.request(`/api/invites/${fake}`);
    expect(res.status).toBe(404);
  });

  it("returns 410 for expired token", async () => {
    const { token } = await seedInvite({
      expiresAt: new Date(Date.now() - 1000),
    });
    const res = await app.request(`/api/invites/${token}`);
    expect(res.status).toBe(410);
  });

  it("returns 400 for already-accepted token", async () => {
    const { token } = await seedInvite({ acceptedAt: new Date() });
    const res = await app.request(`/api/invites/${token}`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("already_accepted");
  });

  it("returns 400 when token is shorter than 32 chars", async () => {
    const res = await app.request(`/api/invites/tooshort`);
    expect(res.status).toBe(400);
  });
});

// Tier 0 item 0-4 (Plan 1 C-5): invite POST must be rate-limited per admin
// so a compromised or malicious admin cannot email-bomb arbitrary addresses.
// The limit is 10 invites / 60 seconds per (workspace, admin) bucket — chosen
// because real admins rarely invite more than a handful at a time, while
// attackers want orders of magnitude more.
describe("POST /api/workspaces/:workspaceId/invites — rate limit", () => {
  afterEach(async () => {
    const { _resetRateLimits } = await import("../src/lib/rate-limit.js");
    _resetRateLimits();
    await cleanup();
  });

  it("per-admin bucket caps invite bursts (429 after ~10 in the window)", async () => {
    const admin = await createUser();
    createdUserIds.add(admin.id);
    const workspaceId = randomUUID();
    await db.insert(workspaces).values({
      id: workspaceId,
      slug: `rl-${randomBytes(4).toString("hex")}`,
      name: "Rate Limit WS",
      ownerId: admin.id,
      planType: "free",
    });
    createdWorkspaceIds.add(workspaceId);
    await db.insert(workspaceMembers).values({
      workspaceId,
      userId: admin.id,
      role: "admin",
    });

    const cookie = await signSessionCookie(admin.id);
    const statuses: number[] = [];
    for (let i = 0; i < 15; i++) {
      const r = await app.request(
        `/api/workspaces/${workspaceId}/invites`,
        {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({
            email: `invitee-${i}-${randomBytes(3).toString("hex")}@ex.com`,
            role: "member",
          }),
        },
      );
      statuses.push(r.status);
    }

    const created = statuses.filter((s) => s === 201).length;
    const limited = statuses.filter((s) => s === 429).length;
    expect(created).toBeLessThanOrEqual(10);
    expect(limited).toBeGreaterThanOrEqual(5);
    // Total must account for every attempt.
    expect(created + limited).toBe(15);
  });
});

// Tier 0 item 0-5 (Plan 1 C-2): concurrent accepts of the same invite must
// produce exactly one member row. Without the `isNull(acceptedAt)` UPDATE
// guard, two interleaved accepts can both pass the HTTP `if (inv.acceptedAt)`
// check, then both run the UPDATE — relying entirely on the workspace_members
// PK as the backstop. The guard is defense-in-depth: the UPDATE itself
// returns zero rows for the losing transaction, so we do not rely on the
// downstream unique-violation catch to preserve the invariant.
describe("POST /api/invites/:token/accept — concurrency invariant", () => {
  afterEach(cleanup);

  it("concurrent accepts of the same invite yield exactly one member row", async () => {
    const email = `race-${randomBytes(4).toString("hex")}@ex.com`;
    const { token, workspaceId } = await seedInvite({ email });

    // Create an authenticated user whose email matches the invite.
    const targetUser = await createUser();
    createdUserIds.add(targetUser.id);
    await db.update(user).set({ email }).where(eq(user.id, targetUser.id));
    const cookie = await signSessionCookie(targetUser.id);

    const concurrency = 5;
    const results = await Promise.all(
      Array.from({ length: concurrency }, () =>
        app.request(`/api/invites/${token}/accept`, {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: "{}",
        }),
      ),
    );
    const statuses = results.map((r) => r.status);
    const successCount = statuses.filter((s) => s === 200).length;
    expect(successCount).toBe(1);

    // Exactly one membership row.
    const members = await db
      .select()
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, targetUser.id),
        ),
      );
    expect(members.length).toBe(1);

    // Invite is now marked accepted exactly once (timestamp present).
    const [inv] = await db
      .select()
      .from(workspaceInvites)
      .where(eq(workspaceInvites.token, token));
    expect(inv!.acceptedAt).not.toBeNull();
  });
});

// App Shell Phase 5 Task 6 — workspace settings → invites tab needs both a
// list endpoint and a cancel endpoint scoped to the (workspaceId, inviteId)
// pair so a workspace admin can't tamper with another workspace's invites.
describe("GET /api/workspaces/:wsId/invites + DELETE /:inviteId", () => {
  afterEach(cleanup);

  async function authedGet(
    path: string,
    userId: string,
  ): Promise<Response> {
    const cookie = await signSessionCookie(userId);
    return app.request(path, { headers: { cookie } });
  }
  async function authedDelete(
    path: string,
    userId: string,
  ): Promise<Response> {
    const cookie = await signSessionCookie(userId);
    return app.request(path, { method: "DELETE", headers: { cookie } });
  }

  it("admin sees their own workspace's invites in created_at desc order", async () => {
    const { workspaceId, inviter } = await seedInvite({});
    // Add a second invite a beat later.
    await new Promise((r) => setTimeout(r, 5));
    await db.insert(workspaceInvites).values({
      workspaceId,
      email: "second@ex.com",
      role: "admin",
      token: randomBytes(32).toString("base64url"),
      invitedBy: inviter.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const res = await authedGet(
      `/api/workspaces/${workspaceId}/invites`,
      inviter.id,
    );
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ email: string }>;
    expect(rows.length).toBe(2);
    // newest first
    expect(rows[0].email).toBe("second@ex.com");
  });

  it("non-admin (member) is forbidden", async () => {
    const { workspaceId } = await seedInvite({});
    const stranger = await createUser();
    createdUserIds.add(stranger.id);
    await db.insert(workspaceMembers).values({
      workspaceId,
      userId: stranger.id,
      role: "member",
    });
    const res = await authedGet(
      `/api/workspaces/${workspaceId}/invites`,
      stranger.id,
    );
    expect(res.status).toBe(403);
  });

  it("admin can cancel an invite from their workspace", async () => {
    const { workspaceId, inviter } = await seedInvite({});
    const [row] = await db
      .select({ id: workspaceInvites.id })
      .from(workspaceInvites)
      .where(eq(workspaceInvites.workspaceId, workspaceId));
    const res = await authedDelete(
      `/api/workspaces/${workspaceId}/invites/${row.id}`,
      inviter.id,
    );
    expect(res.status).toBe(200);
    const remaining = await db
      .select()
      .from(workspaceInvites)
      .where(eq(workspaceInvites.id, row.id));
    expect(remaining).toHaveLength(0);
  });

  it("404 when (workspaceId, inviteId) do not match", async () => {
    const a = await seedInvite({});
    const b = await seedInvite({});
    const [other] = await db
      .select({ id: workspaceInvites.id })
      .from(workspaceInvites)
      .where(eq(workspaceInvites.workspaceId, b.workspaceId));
    const res = await authedDelete(
      `/api/workspaces/${a.workspaceId}/invites/${other.id}`,
      a.inviter.id,
    );
    expect(res.status).toBe(404);
  });
});
