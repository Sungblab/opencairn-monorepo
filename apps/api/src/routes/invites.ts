import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db, workspaceInvites, workspaceMembers, eq } from "@opencairn/db";
import { randomBytes } from "node:crypto";
import { requireAuth } from "../middleware/auth";
import { requireWorkspaceRole } from "../middleware/require-role";
import { sendInviteEmail } from "../lib/email";
import { isUuid } from "../lib/validators";
import type { AppEnv } from "../lib/types";

export const inviteRoutes = new Hono<AppEnv>().use("*", requireAuth);

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
