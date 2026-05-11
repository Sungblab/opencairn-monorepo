import { Hono, type Context } from "hono";
import JSZip from "jszip";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import {
  codeWorkspaceCreateRequestSchema,
  type CodeWorkspaceManifest,
} from "@opencairn/shared";
import { db, eq, projects } from "@opencairn/db";
import { requireAuth } from "../middleware/auth";
import { canRead, canWrite } from "../lib/permissions";
import type { AppEnv } from "../lib/types";
import { isUuid } from "../lib/validators";
import { AgentActionError } from "../lib/agent-actions";
import { emitTreeEvent } from "../lib/tree-events";
import {
  createCodeWorkspaceDraft,
  createDrizzleCodeWorkspaceRepository,
  prepareCodeWorkspacePatch,
  type CodeWorkspaceRecord,
  type CodeWorkspaceRepository,
  type CodeWorkspaceSnapshotRecord,
} from "../lib/code-project-workspaces";

interface ProjectScope {
  workspaceId: string;
  projectId: string;
}

export interface CodeWorkspaceRouteOptions {
  repo?: CodeWorkspaceRepository;
  auth?: typeof requireAuth;
  canReadProject?: (userId: string, projectId: string) => Promise<boolean>;
  canWriteProject?: (userId: string, projectId: string) => Promise<boolean>;
  projectScope?: (projectId: string) => Promise<ProjectScope | null>;
}

export function createCodeWorkspaceRoutes(options: CodeWorkspaceRouteOptions = {}) {
  const repo = options.repo ?? createDrizzleCodeWorkspaceRepository();
  const auth = options.auth ?? requireAuth;
  const canReadProject = options.canReadProject ?? ((userId, projectId) =>
    canRead(userId, { type: "project", id: projectId }));
  const canWriteProject = options.canWriteProject ?? ((userId, projectId) =>
    canWrite(userId, { type: "project", id: projectId }));
  const projectScope = options.projectScope ?? readProjectScope;
  const routes = new Hono<AppEnv>();

  routes.get("/projects/:projectId/code-workspaces", auth, async (c) => {
    const userId = c.get("userId");
    const projectId = c.req.param("projectId");
    if (!isUuid(projectId)) return c.json({ error: "Bad Request" }, 400);
    if (!(await canReadProject(userId, projectId))) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const scope = await projectScope(projectId);
    if (!scope) return c.json({ error: "project_not_found" }, 404);
    const workspaces = await repo.listWorkspaces(scope);
    return c.json({ workspaces: workspaces.map(serializeWorkspace) });
  });

  routes.post(
    "/projects/:projectId/code-workspaces",
    auth,
    zValidator("json", codeWorkspaceCreateRequestSchema),
    async (c) => {
      const userId = c.get("userId");
      const projectId = c.req.param("projectId");
      if (!isUuid(projectId)) return c.json({ error: "Bad Request" }, 400);
      if (!(await canWriteProject(userId, projectId))) {
        return c.json({ error: "Forbidden" }, 403);
      }
      const scope = await projectScope(projectId);
      if (!scope) return c.json({ error: "project_not_found" }, 404);
      try {
        const result = await createCodeWorkspaceDraft(
          repo,
          { ...scope, actorUserId: userId },
          c.req.valid("json"),
        );
        if (!result.idempotent) {
          emitTreeEvent({
            kind: "tree.code_workspace_created",
            projectId,
            id: result.workspace.id,
            parentId: null,
            label: result.workspace.name,
            at: new Date().toISOString(),
          });
        }
        return c.json(
          {
            workspace: serializeWorkspace(result.workspace),
            snapshot: serializeSnapshot(result.snapshot),
            idempotent: result.idempotent,
          },
          result.idempotent ? 200 : 201,
        );
      } catch (error) {
        return codeWorkspaceError(c, error);
      }
    },
  );

  routes.get("/code-workspaces/:id", auth, async (c) => {
    const userId = c.get("userId");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
    const workspace = await repo.findWorkspaceByIdAny(id);
    if (!workspace) return c.json({ error: "code_workspace_not_found" }, 404);
    if (!(await canReadProject(userId, workspace.projectId))) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const snapshot = await repo.findSnapshotById(workspace.id, workspace.currentSnapshotId);
    if (!snapshot) return c.json({ error: "code_workspace_snapshot_not_found" }, 404);
    return c.json({
      workspace: serializeWorkspace(workspace),
      snapshot: serializeSnapshot(snapshot),
    });
  });

  routes.patch(
    "/code-workspaces/:id",
    auth,
    zValidator("json", z.object({
      name: z.string().trim().min(1).max(120).optional(),
      description: z.string().max(1000).nullable().optional(),
    }).refine((body) => body.name !== undefined || body.description !== undefined, {
      message: "No changes provided",
    })),
    async (c) => {
      const userId = c.get("userId");
      const id = c.req.param("id");
      if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
      const workspace = await repo.findWorkspaceByIdAny(id);
      if (!workspace) return c.json({ error: "code_workspace_not_found" }, 404);
      if (!(await canWriteProject(userId, workspace.projectId))) {
        return c.json({ error: "Forbidden" }, 403);
      }
      const body = c.req.valid("json");
      const updated = await repo.renameWorkspace({
        scope: { workspaceId: workspace.workspaceId, projectId: workspace.projectId },
        id,
        name: body.name ?? workspace.name,
        description: body.description,
      });
      if (!updated) return c.json({ error: "code_workspace_not_found" }, 404);
      emitTreeEvent({
        kind: "tree.code_workspace_renamed",
        projectId: updated.projectId,
        id: updated.id,
        parentId: null,
        label: updated.name,
        at: new Date().toISOString(),
      });
      return c.json({ workspace: serializeWorkspace(updated) });
    },
  );

  routes.delete("/code-workspaces/:id", auth, async (c) => {
    const userId = c.get("userId");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
    const workspace = await repo.findWorkspaceByIdAny(id);
    if (!workspace) return c.json({ error: "code_workspace_not_found" }, 404);
    if (!(await canWriteProject(userId, workspace.projectId))) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const deleted = await repo.softDeleteWorkspace({
      scope: { workspaceId: workspace.workspaceId, projectId: workspace.projectId },
      id,
    });
    if (!deleted) return c.json({ error: "code_workspace_not_found" }, 404);
    emitTreeEvent({
      kind: "tree.code_workspace_deleted",
      projectId: deleted.projectId,
      id: deleted.id,
      parentId: null,
      label: deleted.name,
      at: new Date().toISOString(),
    });
    return c.json({ ok: true });
  });

  routes.post(
    "/code-workspaces/:id/patches",
    auth,
    zValidator("json", z.record(z.unknown())),
    async (c) => {
      const userId = c.get("userId");
      const id = c.req.param("id");
      if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
      const workspace = await repo.findWorkspaceByIdAny(id);
      if (!workspace) return c.json({ error: "code_workspace_not_found" }, 404);
      if (!(await canWriteProject(userId, workspace.projectId))) {
        return c.json({ error: "Forbidden" }, 403);
      }
      try {
        const result = await prepareCodeWorkspacePatch(
          repo,
          {
            workspaceId: workspace.workspaceId,
            projectId: workspace.projectId,
            actorUserId: userId,
          },
          { ...c.req.valid("json"), codeWorkspaceId: id },
        );
        return c.json(
          { patch: serializePatch(result.patch), idempotent: result.idempotent },
          result.idempotent ? 200 : 201,
        );
      } catch (error) {
        return codeWorkspaceError(c, error);
      }
    },
  );

  routes.get("/code-workspaces/:id/snapshots/:snapshotId/archive", auth, async (c) => {
    const userId = c.get("userId");
    const id = c.req.param("id");
    const snapshotId = c.req.param("snapshotId");
    if (!isUuid(id) || !isUuid(snapshotId)) return c.json({ error: "Bad Request" }, 400);
    const workspace = await repo.findWorkspaceByIdAny(id);
    if (!workspace) return c.json({ error: "code_workspace_not_found" }, 404);
    if (!(await canReadProject(userId, workspace.projectId))) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const snapshot = await repo.findSnapshotById(workspace.id, snapshotId);
    if (!snapshot) return c.json({ error: "code_workspace_snapshot_not_found" }, 404);
    try {
      const archive = await archiveSnapshot(workspace, snapshot);
      return new Response(archive as unknown as BodyInit, {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${safeArchiveName(workspace.name)}.zip"`,
        },
      });
    } catch (error) {
      return codeWorkspaceError(c, error);
    }
  });

  return routes;
}

export const codeWorkspaceRoutes = createCodeWorkspaceRoutes();

async function readProjectScope(projectId: string): Promise<ProjectScope | null> {
  const [project] = await db
    .select({ id: projects.id, workspaceId: projects.workspaceId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return project ? { workspaceId: project.workspaceId, projectId: project.id } : null;
}

function serializeWorkspace(workspace: CodeWorkspaceRecord) {
  return {
    id: workspace.id,
    requestId: workspace.requestId,
    workspaceId: workspace.workspaceId,
    projectId: workspace.projectId,
    createdBy: workspace.createdBy,
    name: workspace.name,
    description: workspace.description,
    language: workspace.language,
    framework: workspace.framework,
    currentSnapshotId: workspace.currentSnapshotId,
    sourceRunId: workspace.sourceRunId,
    sourceActionId: workspace.sourceActionId,
    createdAt: serializeDate(workspace.createdAt),
    updatedAt: serializeDate(workspace.updatedAt),
  };
}

function serializeSnapshot(snapshot: CodeWorkspaceSnapshotRecord) {
  return {
    id: snapshot.id,
    codeWorkspaceId: snapshot.codeWorkspaceId,
    parentSnapshotId: snapshot.parentSnapshotId,
    treeHash: snapshot.treeHash,
    manifest: snapshot.manifest,
  };
}

function serializePatch(patch: Awaited<ReturnType<CodeWorkspaceRepository["createPatch"]>>) {
  return {
    id: patch.id,
    requestId: patch.requestId,
    codeWorkspaceId: patch.codeWorkspaceId,
    baseSnapshotId: patch.baseSnapshotId,
    status: patch.status,
    patch: patch.patch,
  };
}

function serializeDate(value: Date | string | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

async function archiveSnapshot(
  workspace: CodeWorkspaceRecord,
  snapshot: CodeWorkspaceSnapshotRecord,
): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const entry of snapshot.manifest.entries) {
    if (entry.kind === "directory") {
      zip.folder(entry.path);
      continue;
    }
    if (entry.inlineContent === undefined) {
      throw new AgentActionError("code_workspace_archive_requires_inline_content", 409);
    }
    zip.file(entry.path, entry.inlineContent);
  }
  zip.file(
    "opencairn-code-workspace.json",
    JSON.stringify({
      workspace: serializeWorkspace(workspace),
      snapshot: serializeSnapshot(snapshot),
    }, null, 2),
  );
  return zip.generateAsync({ type: "uint8array" });
}

function safeArchiveName(value: string): string {
  const normalized = value.trim().replace(/[\\/:*?"<>|]+/g, "-");
  return normalized || "code-workspace";
}

function codeWorkspaceError(c: Context<AppEnv>, error: unknown) {
  if (error instanceof AgentActionError) {
    return c.json({ error: error.code }, error.status as 400 | 403 | 404 | 409 | 500);
  }
  throw error;
}
