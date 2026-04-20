import type { Context, Next } from "hono";
import { auth } from "../lib/auth";

// authMiddleware — 모든 plan에서 이 이름으로 사용
// requireAuth는 하위 호환 alias
export async function authMiddleware(c: Context, next: Next) {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set("user", session.user);
  c.set("session", session.session);
  // userId도 세팅 — plan 6/7/8/9에서 c.get("userId")로 사용
  c.set("userId", session.user.id);
  await next();
}

export const requireAuth = authMiddleware; // alias
