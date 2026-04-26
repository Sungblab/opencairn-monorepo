import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  db,
  workspaceInvites,
  workspaceMembers,
  workspaces,
  user,
  and,
  eq,
  desc,
  isNull,
} from "@opencairn/db";
import { randomBytes } from "node:crypto";
import { requireAuth } from "../middleware/auth";
import { requireWorkspaceRole } from "../middleware/require-role";
import { sendInviteEmail } from "../lib/email";
import { isUuid } from "../lib/validators";
import { checkRateLimit } from "../lib/rate-limit";
import type { AppEnv } from "../lib/types";

// Tier 0 item 0-4 (Plan 1 C-5): cap invite bursts per (workspace, admin) to
// 10/min. Real admins rarely send more than a handful; attackers want orders
// of magnitude more.
const INVITE_MAX = 10;
const INVITE_WINDOW_MS = 60_000;

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

  // invited_by is ON DELETE SET NULL — skip the lookup when the inviter
  // account has been removed, so the preview still renders.
  const inviter = row.invitedBy
    ? (
        await db
          .select({ name: user.name })
          .from(user)
          .where(eq(user.id, row.invitedBy))
      )[0]
    : null;

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

    const rl = checkRateLimit(
      `invite:${workspaceId}:${inviter.id}`,
      INVITE_MAX,
      INVITE_WINDOW_MS,
    );
    if (!rl.allowed) {
      c.header("Retry-After", String(rl.retryAfterSec));
      return c.json({ error: "rate_limited" }, 429);
    }

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

  // Tier 0 item 0-5 (Plan 1 C-2): claim the invite BEFORE inserting the
  // member so concurrent accepts serialize cleanly. The `isNull(acceptedAt)`
  // guard means the losing transaction's UPDATE returns zero rows — we
  // detect that via `rowCount === 1` and abort without relying on the
  // workspace_members PK as the sole backstop (defense-in-depth).
  const INVITE_RACE_LOST = Symbol("invite_race_lost");
  try {
    await db.transaction(async (tx) => {
      const claimed = await tx
        .update(workspaceInvites)
        .set({ acceptedAt: new Date() })
        .where(
          and(
            eq(workspaceInvites.id, inv.id),
            isNull(workspaceInvites.acceptedAt),
          ),
        )
        .returning({ id: workspaceInvites.id });
      if (claimed.length !== 1) {
        // Another concurrent caller already claimed the invite. Throw a
        // sentinel so the outer handler maps it to the same 400 as the
        // pre-transaction check above.
        throw INVITE_RACE_LOST;
      }
      await tx.insert(workspaceMembers).values({
        workspaceId: inv.workspaceId, userId: user.id, role: inv.role, invitedBy: inv.invitedBy,
      });
    });
  } catch (err: unknown) {
    if (err === INVITE_RACE_LOST) {
      return c.json({ error: "Already accepted" }, 400);
    }
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

// App Shell Phase 5 Task 6 — workspace settings → invites 탭. 워크스페이스
// 어드민이 발송했던 초대 전체 목록 (수락된 것까지) 을 created_at desc 로.
// pending vs accepted 구분은 acceptedAt 컬럼으로 클라이언트에서 처리.
inviteRoutes.get(
  "/workspaces/:workspaceId/invites",
  requireWorkspaceRole("admin"),
  async (c) => {
    const id = c.req.param("workspaceId");
    if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
    const rows = await db
      .select({
        id: workspaceInvites.id,
        email: workspaceInvites.email,
        role: workspaceInvites.role,
        expiresAt: workspaceInvites.expiresAt,
        acceptedAt: workspaceInvites.acceptedAt,
        createdAt: workspaceInvites.createdAt,
      })
      .from(workspaceInvites)
      .where(eq(workspaceInvites.workspaceId, id))
      .orderBy(desc(workspaceInvites.createdAt));
    return c.json(rows);
  },
);

// App Shell Phase 5 Task 6 — invite 취소. workspaceId 를 path 에 명시해
// 한 워크스페이스 admin 이 다른 워크스페이스 초대를 건드리지 못하게.
// (internal-api workspaceId-scope 룰)
inviteRoutes.delete(
  "/workspaces/:workspaceId/invites/:inviteId",
  requireWorkspaceRole("admin"),
  async (c) => {
    const { workspaceId, inviteId } = c.req.param();
    if (!isUuid(workspaceId) || !isUuid(inviteId)) {
      return c.json({ error: "Bad Request" }, 400);
    }
    const result = await db
      .delete(workspaceInvites)
      .where(
        and(
          eq(workspaceInvites.id, inviteId),
          eq(workspaceInvites.workspaceId, workspaceId),
        ),
      )
      .returning({ id: workspaceInvites.id });
    if (result.length === 0) return c.json({ error: "Not found" }, 404);
    return c.json({ ok: true });
  },
);
