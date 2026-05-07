import { Hono } from "hono";
import { db, eq, user } from "@opencairn/db";
import { auth } from "../lib/auth";

// /api/auth/me — thin session echo used by the web app's requireSession()
// helper (server components). Must be registered BEFORE the Better Auth
// catch-all, otherwise `.all("/*")` swallows it.
export const authRoutes = new Hono()
  .get("/me", async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: "Unauthorized" }, 401);
    const [row] = await db
      .select({ isSiteAdmin: user.isSiteAdmin })
      .from(user)
      .where(eq(user.id, session.user.id))
      .limit(1);
    return c.json({
      userId: session.user.id,
      email: session.user.email,
      name: session.user.name,
      emailVerified: session.user.emailVerified ?? false,
      isSiteAdmin: row?.isSiteAdmin ?? false,
    });
  })
  .all("/*", (c) => auth.handler(c.req.raw));
