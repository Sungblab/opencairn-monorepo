import { describe, it, expect, afterEach } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { db, workspaces, workspaceMembers, user, eq } from "@opencairn/db";
import { createApp } from "../src/app.js";
import { createUser } from "./helpers/seed.js";

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
