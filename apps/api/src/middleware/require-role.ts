import { createMiddleware } from "hono/factory";
import { resolveRole, ResolvedRole } from "../lib/permissions";

const ORDER: Record<ResolvedRole, number> = { none: 0, viewer: 1, editor: 2, admin: 3, owner: 4 };

export function requireWorkspaceRole(minRole: "member" | "admin" | "owner") {
  return createMiddleware(async (c, next) => {
    const user = c.get("user") as { id: string } | undefined;
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const wsId = c.req.param("workspaceId") ?? c.req.param("id") ?? "";
    const role = await resolveRole(user.id, { type: "workspace", id: wsId });
    const required = minRole === "owner" ? "owner" : minRole === "admin" ? "admin" : "viewer";
    if (ORDER[role] < ORDER[required]) return c.json({ error: "Forbidden" }, 403);
    c.set("wsRole", role);
    await next();
  });
}
