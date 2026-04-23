import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, db, eq, user, workspaceMembers, workspaces } from "@opencairn/db";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../lib/types";

export const userRoutes = new Hono<AppEnv>().use("*", requireAuth);

// App Shell Phase 1 — root `/` reads this to decide where to land the user.
// Returns the {id, slug} pair so the caller can redirect without a second
// hop just to resolve the slug. Membership is re-checked at read time so a
// user kicked from the workspace after writing the value doesn't leak the
// id back to themselves.
userRoutes.get("/me/last-viewed-workspace", async (c) => {
  const me = c.get("user");
  const [row] = await db
    .select({
      id: workspaces.id,
      slug: workspaces.slug,
    })
    .from(user)
    .innerJoin(workspaces, eq(workspaces.id, user.lastViewedWorkspaceId))
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, workspaces.id),
        eq(workspaceMembers.userId, me.id),
      ),
    )
    .where(eq(user.id, me.id))
    .limit(1);

  if (!row) return c.json({ workspace: null });
  return c.json({ workspace: { id: row.id, slug: row.slug } });
});

// App Shell Phase 1 — record the user's most recent workspace so the root
// `/` redirect can land them in the same place across devices. The membership
// check before the write is mandatory: without it, a malicious client could
// pin a foreign workspace into their own user row, and our redirect would
// happily 302 them into a 403 next time they hit `/`.
const lastViewedSchema = z.object({
  workspaceId: z.string().uuid(),
});

userRoutes.patch(
  "/me/last-viewed-workspace",
  zValidator("json", lastViewedSchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: "invalid_workspace_id" }, 400);
    }
  }),
  async (c) => {
    const me = c.get("user");
    const { workspaceId } = c.req.valid("json");

    const [membership] = await db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, me.id),
        ),
      )
      .limit(1);

    if (!membership) {
      return c.json({ error: "not_a_member" }, 403);
    }

    await db
      .update(user)
      .set({ lastViewedWorkspaceId: workspaceId })
      .where(eq(user.id, me.id));

    return c.json({ ok: true });
  },
);
