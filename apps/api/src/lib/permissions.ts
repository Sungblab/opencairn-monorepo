import {
  db as defaultDb,
  workspaceMembers,
  projectPermissions,
  pagePermissions,
  projects,
  notes,
  and,
  eq,
  type DB,
} from "@opencairn/db";

export type ResolvedRole = "owner" | "admin" | "editor" | "commenter" | "viewer" | "none";
export type ResourceType = "workspace" | "project" | "note";

export interface PermissionsOptions {
  db?: DB;
}

export async function findWorkspaceId(
  resource: { type: ResourceType; id: string },
  options?: PermissionsOptions,
): Promise<string | null> {
  const conn = options?.db ?? defaultDb;
  if (resource.type === "workspace") return resource.id;
  if (resource.type === "project") {
    const [row] = await conn
      .select({ wsId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, resource.id));
    return row?.wsId ?? null;
  }
  if (resource.type === "note") {
    const [row] = await conn
      .select({ wsId: notes.workspaceId })
      .from(notes)
      .where(eq(notes.id, resource.id));
    return row?.wsId ?? null;
  }
  return null;
}

export async function findProjectId(
  resource: { type: ResourceType; id: string },
  options?: PermissionsOptions,
): Promise<string | null> {
  const conn = options?.db ?? defaultDb;
  if (resource.type === "project") return resource.id;
  if (resource.type === "note") {
    const [row] = await conn
      .select({ pid: notes.projectId })
      .from(notes)
      .where(eq(notes.id, resource.id));
    return row?.pid ?? null;
  }
  return null;
}

export async function resolveRole(
  userId: string,
  resource: { type: ResourceType; id: string },
  options?: PermissionsOptions,
): Promise<ResolvedRole> {
  const conn = options?.db ?? defaultDb;
  const wsId = await findWorkspaceId(resource, options);
  if (!wsId) return "none";

  const [membership] = await conn
    .select()
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, wsId), eq(workspaceMembers.userId, userId)));

  if (!membership) return "none";
  if (membership.role === "owner") return "owner";
  if (membership.role === "admin") return "admin";

  if (resource.type === "note") {
    const [pp] = await conn
      .select()
      .from(pagePermissions)
      .where(and(eq(pagePermissions.pageId, resource.id), eq(pagePermissions.userId, userId)));
    if (pp) return pp.role === "none" ? "none" : pp.role;

    const [note] = await conn
      .select({ inherit: notes.inheritParent })
      .from(notes)
      .where(eq(notes.id, resource.id));
    if (note && note.inherit === false) return "none";
  }

  const projectId = await findProjectId(resource, options);
  if (projectId) {
    const [pp] = await conn
      .select()
      .from(projectPermissions)
      .where(and(eq(projectPermissions.projectId, projectId), eq(projectPermissions.userId, userId)));
    if (pp) return pp.role;
  }

  if (membership.role === "member") {
    if (projectId) {
      const [proj] = await conn
        .select({ dr: projects.defaultRole })
        .from(projects)
        .where(eq(projects.id, projectId));
      return proj?.dr ?? "viewer";
    }
    return "editor";
  }
  // guest는 명시적 공유 없으면 접근 불가 (page/project permission 없이는 여기로 떨어짐)
  return "none";
}

export async function canRead(
  userId: string,
  resource: { type: ResourceType; id: string },
  options?: PermissionsOptions,
): Promise<boolean> {
  const r = await resolveRole(userId, resource, options);
  return r !== "none";
}

export async function canWrite(
  userId: string,
  resource: { type: ResourceType; id: string },
  options?: PermissionsOptions,
): Promise<boolean> {
  const r = await resolveRole(userId, resource, options);
  return ["owner", "admin", "editor"].includes(r);
}

// Plan 2B: commenter+ can read and post comments but not edit content (content is Yjs).
export async function canComment(
  userId: string,
  resource: { type: ResourceType; id: string },
  options?: PermissionsOptions,
): Promise<boolean> {
  const r = await resolveRole(userId, resource, options);
  return ["owner", "admin", "editor", "commenter"].includes(r);
}

export async function canAdmin(
  userId: string,
  workspaceId: string,
  options?: PermissionsOptions,
): Promise<boolean> {
  const r = await resolveRole(userId, { type: "workspace", id: workspaceId }, options);
  return r === "owner" || r === "admin";
}

export async function requireWorkspaceRole(
  userId: string,
  workspaceId: string,
  roles: Array<"owner" | "admin" | "editor" | "viewer">,
  options?: PermissionsOptions,
): Promise<void> {
  const r = await resolveRole(userId, { type: "workspace", id: workspaceId }, options);
  if (r === "none" || r === "commenter" || !roles.includes(r)) {
    throw new Error(`Forbidden: workspace ${workspaceId} requires role in [${roles.join(",")}], got ${r}`);
  }
}
