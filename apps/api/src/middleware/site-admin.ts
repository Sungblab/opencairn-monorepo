import type { Context, Next } from "hono";
import { db, eq, user } from "@opencairn/db";

export async function requireSiteAdmin(c: Context, next: Next) {
  const userId = c.get("userId");
  const [row] = await db
    .select({ isSiteAdmin: user.isSiteAdmin })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  if (!row?.isSiteAdmin) {
    return c.json({ error: "Forbidden" }, 403);
  }

  await next();
}
