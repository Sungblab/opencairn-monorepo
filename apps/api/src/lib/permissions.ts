import { db, workspaceMembers, projectPermissions, pagePermissions, projects, notes, and, eq } from "@opencairn/db";

export type ResolvedRole = "owner" | "admin" | "editor" | "viewer" | "none";
export type ResourceType = "workspace" | "project" | "note";

export async function findWorkspaceId(resource: { type: ResourceType; id: string }): Promise<string | null> {
  if (resource.type === "workspace") return resource.id;
  if (resource.type === "project") {
    const [row] = await db.select({ wsId: projects.workspaceId }).from(projects).where(eq(projects.id, resource.id));
    return row?.wsId ?? null;
  }
  if (resource.type === "note") {
    const [row] = await db.select({ wsId: notes.workspaceId }).from(notes).where(eq(notes.id, resource.id));
    return row?.wsId ?? null;
  }
  return null;
}

export async function findProjectId(resource: { type: ResourceType; id: string }): Promise<string | null> {
  if (resource.type === "project") return resource.id;
  if (resource.type === "note") {
    const [row] = await db.select({ pid: notes.projectId }).from(notes).where(eq(notes.id, resource.id));
    return row?.pid ?? null;
  }
  return null;
}

export async function resolveRole(userId: string, resource: { type: ResourceType; id: string }): Promise<ResolvedRole> {
  const wsId = await findWorkspaceId(resource);
  if (!wsId) return "none";

  const [membership] = await db
    .select()
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, wsId), eq(workspaceMembers.userId, userId)));

  if (!membership) return "none";
  if (membership.role === "owner") return "owner";
  if (membership.role === "admin") return "admin";

  if (resource.type === "note") {
    const [pp] = await db
      .select()
      .from(pagePermissions)
      .where(and(eq(pagePermissions.pageId, resource.id), eq(pagePermissions.userId, userId)));
    if (pp) return pp.role === "none" ? "none" : pp.role;

    const [note] = await db.select({ inherit: notes.inheritParent }).from(notes).where(eq(notes.id, resource.id));
    if (note && note.inherit === false) return "none";
  }

  const projectId = await findProjectId(resource);
  if (projectId) {
    const [pp] = await db
      .select()
      .from(projectPermissions)
      .where(and(eq(projectPermissions.projectId, projectId), eq(projectPermissions.userId, userId)));
    if (pp) return pp.role;
  }

  if (membership.role === "member") {
    if (projectId) {
      const [proj] = await db.select({ dr: projects.defaultRole }).from(projects).where(eq(projects.id, projectId));
      return proj?.dr ?? "viewer";
    }
    return "editor";
  }
  return "none";
}

export async function canRead(userId: string, resource: { type: ResourceType; id: string }): Promise<boolean> {
  const r = await resolveRole(userId, resource);
  return r !== "none";
}

export async function canWrite(userId: string, resource: { type: ResourceType; id: string }): Promise<boolean> {
  const r = await resolveRole(userId, resource);
  return ["owner", "admin", "editor"].includes(r);
}

export async function canAdmin(userId: string, workspaceId: string): Promise<boolean> {
  const r = await resolveRole(userId, { type: "workspace", id: workspaceId });
  return r === "owner" || r === "admin";
}

export async function requireWorkspaceRole(
  userId: string,
  workspaceId: string,
  roles: Array<"owner" | "admin" | "editor" | "viewer">,
): Promise<void> {
  const r = await resolveRole(userId, { type: "workspace", id: workspaceId });
  if (r === "none" || !roles.includes(r as Exclude<ResolvedRole, "none">)) {
    throw new Error(`Forbidden: workspace ${workspaceId} requires role in [${roles.join(",")}], got ${r}`);
  }
}
