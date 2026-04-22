import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  db,
  workspaceInvites,
  workspaceMembers,
  workspaces,
  user,
  eq,
} from "@opencairn/db";
import { randomBytes } from "node:crypto";
import { requireAuth } from "../middleware/auth";
import { requireWorkspaceRole } from "../middleware/require-role";
import { sendInviteEmail } from "../lib/email";
import { isUuid } from "../lib/validators";
import type { AppEnv } from "../lib/types";

export const inviteRoutes = new Hono<AppEnv>();

// Public — 토큰 자체가 비밀이므로 수락 UI 프리뷰는 인증 불필요.
// requireAuth 미들웨어 *앞에* 등록해야 함.
inviteRoutes.get("/invites/:token", async (c) => {
  const token = c.req.param("token");
  if (!token || token.length < 32) {
    return c.json({ error: "bad_request" }, 400);
  }
  const [row] = await db
    .select({
      workspaceId: workspaceInvites.workspaceId,
      email: workspaceInvites.email,
      role: workspaceInvites.role,
      expiresAt: workspaceInvites.expiresAt,
      acceptedAt: workspaceInvites.acceptedAt,
      invitedBy: workspaceInvites.invitedBy,
      workspaceName: workspaces.name,
    })
    .from(workspaceInvites)
    .innerJoin(workspaces, eq(workspaces.id, workspaceInvites.workspaceId))
    .where(eq(workspaceInvites.token, token));
  if (!row) return c.json({ error: "not_found" }, 404);
  if (row.acceptedAt) return c.json({ error: "already_accepted" }, 400);
  if (row.expiresAt < new Date()) return c.json({ error: "expired" }, 410);

  const [inviter] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, row.invitedBy));

  return c.json({
    workspaceId: row.workspaceId,
    workspaceName: row.workspaceName,
    inviterName: inviter?.name ?? "",
    role: row.role,
    email: row.email,
    expiresAt: row.expiresAt.toISOString(),
  });
});

// 인증 필요한 라우트
inviteRoutes.use("*", requireAuth);

// 초대 생성 (admin 이상)
inviteRoutes.post(
  "/workspaces/:workspaceId/invites",
  requireWorkspaceRole("admin"),
  zValidator("json", z.object({ email: z.string().email(), role: z.enum(["admin", "member", "guest"]).default("member") })),
  async (c) => {
    const { workspaceId } = c.req.param();
    if (!isUuid(workspaceId)) return c.json({ error: "Bad Request" }, 400);
    const { email, role } = c.req.valid("json");
    const inviter = c.get("user");
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const [inv] = await db.insert(workspaceInvites).values({
      workspaceId, email, role, token, invitedBy: inviter.id, expiresAt,
    }).returning();

    await sendInviteEmail(email, { token, workspaceId, invitedByName: inviter.name });
    return c.json({ id: inv.id }, 201);
  }
);

// 초대 수락
inviteRoutes.post("/invites/:token/accept", async (c) => {
  const user = c.get("user");

  const token = c.req.param("token");
  if (!token || token.length < 32) return c.json({ error: "Bad Request" }, 400);
  const [inv] = await db.select().from(workspaceInvites).where(eq(workspaceInvites.token, token));
  if (!inv) return c.json({ error: "Invite not found" }, 404);
  if (inv.acceptedAt) return c.json({ error: "Already accepted" }, 400);
  if (inv.expiresAt < new Date()) return c.json({ error: "Expired" }, 410);
  if (inv.email.toLowerCase() !== user.email.toLowerCase()) {
    return c.json({ error: "Invite email does not match your account" }, 403);
  }

  try {
    await db.transaction(async (tx) => {
      await tx.insert(workspaceMembers).values({
        workspaceId: inv.workspaceId, userId: user.id, role: inv.role, invitedBy: inv.invitedBy,
      });
      await tx.update(workspaceInvites).set({ acceptedAt: new Date() }).where(eq(workspaceInvites.id, inv.id));
    });
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "23505") {
      return c.json({ error: "Already a member of this workspace" }, 409);
    }
    throw err;
  }
  return c.json({ workspaceId: inv.workspaceId });
});

// 초대 거절
inviteRoutes.post("/invites/:token/decline", async (c) => {
  const token = c.req.param("token");
  if (!token || token.length < 32) return c.json({ error: "Bad Request" }, 400);
  await db.delete(workspaceInvites).where(eq(workspaceInvites.token, token));
  return c.json({ ok: true });
});
