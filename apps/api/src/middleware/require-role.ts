import { createMiddleware } from "hono/factory";
import { resolveRole, ResolvedRole } from "../lib/permissions";
import type { AppEnv } from "../lib/types";

const ORDER: Record<ResolvedRole, number> = { none: 0, viewer: 1, commenter: 2, editor: 3, admin: 4, owner: 5 };

export function requireWorkspaceRole(minRole: "member" | "admin" | "owner") {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const wsId = c.req.param("workspaceId") ?? c.req.param("id") ?? "";
    const role = await resolveRole(user.id, { type: "workspace", id: wsId });
    const required = minRole === "owner" ? "owner" : minRole === "admin" ? "admin" : "viewer";
    if (ORDER[role] < ORDER[required]) return c.json({ error: "Forbidden" }, 403);
    c.set("wsRole", role);
    await next();
  });
}
