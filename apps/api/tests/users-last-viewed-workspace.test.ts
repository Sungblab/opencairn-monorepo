import { afterEach, describe, expect, it } from "vitest";
import { and, db, eq, user, workspaces, workspaceMembers } from "@opencairn/db";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import { createUser } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

const app = createApp();

const createdUserIds = new Set<string>();
const createdWorkspaceIds = new Set<string>();

async function patchLastViewed(
  userId: string,
  body: unknown,
): Promise<Response> {
  const cookie = await signSessionCookie(userId);
  return app.request("/api/users/me/last-viewed-workspace", {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function seedWorkspaceFor(ownerId: string): Promise<string> {
  const wsId = randomUUID();
  const slug = `lvw-${wsId.slice(0, 8)}`;
  await db.insert(workspaces).values({
    id: wsId,
    slug,
    name: "lvw test ws",
    ownerId,
    planType: "free",
  });
  await db.insert(workspaceMembers).values({
    workspaceId: wsId,
    userId: ownerId,
    role: "owner",
  });
  createdWorkspaceIds.add(wsId);
  return wsId;
}

afterEach(async () => {
  for (const wsId of createdWorkspaceIds) {
    await db.delete(workspaces).where(eq(workspaces.id, wsId));
  }
  createdWorkspaceIds.clear();
  for (const id of createdUserIds) {
    await db.delete(user).where(eq(user.id, id));
  }
  createdUserIds.clear();
});

describe("PATCH /api/users/me/last-viewed-workspace", () => {
  it("persists the workspace id when the user is a member", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const wsId = await seedWorkspaceFor(u.id);

    const res = await patchLastViewed(u.id, { workspaceId: wsId });

    expect(res.status).toBe(200);

    const [row] = await db
      .select({ lastViewedWorkspaceId: user.lastViewedWorkspaceId })
      .from(user)
      .where(eq(user.id, u.id));
    expect(row?.lastViewedWorkspaceId).toBe(wsId);
  });

  it("rejects a workspace the user is not a member of", async () => {
    const owner = await createUser();
    createdUserIds.add(owner.id);
    const foreignWs = await seedWorkspaceFor(owner.id);

    const me = await createUser();
    createdUserIds.add(me.id);

    const res = await patchLastViewed(me.id, { workspaceId: foreignWs });

    expect(res.status).toBe(403);

    const [row] = await db
      .select({ lastViewedWorkspaceId: user.lastViewedWorkspaceId })
      .from(user)
      .where(eq(user.id, me.id));
    expect(row?.lastViewedWorkspaceId).toBeNull();
  });

  it("returns 400 on invalid uuid", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);

    const res = await patchLastViewed(u.id, { workspaceId: "not-a-uuid" });

    expect(res.status).toBe(400);
  });

  it("returns 401 without a session", async () => {
    const res = await app.request("/api/users/me/last-viewed-workspace", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId: randomUUID() }),
    });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/users/me/last-viewed-workspace", () => {
  async function getLastViewed(userId: string): Promise<Response> {
    const cookie = await signSessionCookie(userId);
    return app.request("/api/users/me/last-viewed-workspace", {
      headers: { cookie },
    });
  }

  it("returns null when never set", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const res = await getLastViewed(u.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { workspace: unknown };
    expect(body.workspace).toBeNull();
  });

  it("returns {id, slug} when set and user is still a member", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const wsId = await seedWorkspaceFor(u.id);
    await patchLastViewed(u.id, { workspaceId: wsId });

    const res = await getLastViewed(u.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      workspace: { id: string; slug: string } | null;
    };
    expect(body.workspace?.id).toBe(wsId);
    expect(body.workspace?.slug).toMatch(/^lvw-/);
  });

  it("returns null after the user lost membership", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const wsId = await seedWorkspaceFor(u.id);
    await patchLastViewed(u.id, { workspaceId: wsId });

    // Remove membership while keeping the workspace + lastViewedWorkspaceId.
    await db
      .delete(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, wsId),
          eq(workspaceMembers.userId, u.id),
        ),
      );

    const res = await getLastViewed(u.id);
    const body = (await res.json()) as { workspace: unknown };
    expect(body.workspace).toBeNull();
  });
});
