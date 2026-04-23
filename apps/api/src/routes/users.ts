import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, db, eq, user, workspaceMembers } from "@opencairn/db";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../lib/types";

export const userRoutes = new Hono<AppEnv>().use("*", requireAuth);

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
