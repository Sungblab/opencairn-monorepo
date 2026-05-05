import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AppEnv } from "../lib/types";
import {
  createCodeWorkspaceRoutes,
} from "./code-workspaces";
import {
  createMemoryCodeWorkspaceRepository,
  type CodeWorkspaceRepository,
} from "../lib/code-project-workspaces";

const userId = "user-1";
const workspaceId = "00000000-0000-4000-8000-000000000001";
const projectId = "00000000-0000-4000-8000-000000000002";
const requestId = "00000000-0000-4000-8000-000000000003";

function appWith(repo: CodeWorkspaceRepository = createMemoryCodeWorkspaceRepository()) {
  const app = new Hono<AppEnv>().route(
    "/api",
    createCodeWorkspaceRoutes({
      repo,
      projectScope: async (pid) => pid === projectId ? { workspaceId, projectId } : null,
      canReadProject: async (_uid, pid) => pid === projectId,
      canWriteProject: async (_uid, pid) => pid === projectId,
      auth: async (c, next) => {
        c.set("userId", userId);
        c.set("user", { id: userId, email: "user@example.com", name: "User" });
        await next();
      },
    }),
  );
  return { app, repo };
}

describe("code workspace routes", () => {
  it("creates, lists, and reads a project-scoped code workspace idempotently", async () => {
    const { app } = appWith();
    const create = await app.request(`/api/projects/${projectId}/code-workspaces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestId,
        name: "Demo app",
        language: "typescript",
        framework: "react",
        manifest: {
          entries: [
            { path: "src", kind: "directory" },
            {
              path: "src/App.tsx",
              kind: "file",
              bytes: 36,
              contentHash: "sha256:app",
              inlineContent: "export function App() { return null; }",
            },
          ],
        },
      }),
    });

    expect(create.status).toBe(201);
    const created = await create.json() as {
      idempotent: boolean;
      workspace: { id: string; currentSnapshotId: string; name: string };
      snapshot: { id: string; manifest: { entries: Array<{ path: string }> } };
    };
    expect(created.idempotent).toBe(false);
    expect(created.workspace.name).toBe("Demo app");
    expect(created.snapshot.manifest.entries.map((entry) => entry.path)).toEqual([
      "src",
      "src/App.tsx",
    ]);

    const duplicate = await app.request(`/api/projects/${projectId}/code-workspaces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestId,
        name: "Ignored",
        manifest: { entries: [] },
      }),
    });
    expect(duplicate.status).toBe(200);
    expect((await duplicate.json() as { idempotent: boolean }).idempotent).toBe(true);

    const list = await app.request(`/api/projects/${projectId}/code-workspaces`);
    expect(list.status).toBe(200);
    const listed = await list.json() as { workspaces: Array<{ id: string }> };
    expect(listed.workspaces.map((row) => row.id)).toEqual([created.workspace.id]);

    const detail = await app.request(`/api/code-workspaces/${created.workspace.id}`);
    expect(detail.status).toBe(200);
    const loaded = await detail.json() as {
      workspace: { id: string };
      snapshot: { id: string };
    };
    expect(loaded.workspace.id).toBe(created.workspace.id);
    expect(loaded.snapshot.id).toBe(created.workspace.currentSnapshotId);
  });

  it("creates reviewable patches and rejects stale bases", async () => {
    const { app } = appWith();
    const create = await app.request(`/api/projects/${projectId}/code-workspaces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Patchable app",
        manifest: {
          entries: [
            {
              path: "src/App.tsx",
              kind: "file",
              bytes: 9,
              contentHash: "sha256:old",
              inlineContent: "old",
            },
          ],
        },
      }),
    });
    const { workspace } = await create.json() as {
      workspace: { id: string; currentSnapshotId: string };
    };

    const patch = await app.request(`/api/code-workspaces/${workspace.id}/patches`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseSnapshotId: workspace.currentSnapshotId,
        operations: [
          {
            op: "update",
            path: "src/App.tsx",
            beforeHash: "sha256:old",
            afterHash: "sha256:new",
            inlineContent: "new",
          },
        ],
        preview: { filesChanged: 1, additions: 1, deletions: 1, summary: "Update app" },
        risk: "write",
      }),
    });
    expect(patch.status).toBe(201);
    const body = await patch.json() as { patch: { status: string; baseSnapshotId: string } };
    expect(body.patch).toMatchObject({
      status: "approval_required",
      baseSnapshotId: workspace.currentSnapshotId,
    });

    const stale = await app.request(`/api/code-workspaces/${workspace.id}/patches`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseSnapshotId: "00000000-0000-4000-8000-000000000099",
        operations: [
          {
            op: "delete",
            path: "src/App.tsx",
            beforeHash: "sha256:old",
          },
        ],
        preview: { filesChanged: 1, additions: 0, deletions: 1, summary: "Delete app" },
        risk: "destructive",
      }),
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: "code_workspace_stale_base" });
  });

  it("streams a snapshot archive without command execution or preview side effects", async () => {
    const { app } = appWith();
    const create = await app.request(`/api/projects/${projectId}/code-workspaces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Packaged app",
        manifest: {
          entries: [
            { path: "src", kind: "directory" },
            {
              path: "src/App.tsx",
              kind: "file",
              bytes: 9,
              contentHash: "sha256:app",
              inlineContent: "app",
            },
          ],
        },
      }),
    });
    const { workspace } = await create.json() as {
      workspace: { id: string; currentSnapshotId: string };
    };

    const archive = await app.request(
      `/api/code-workspaces/${workspace.id}/snapshots/${workspace.currentSnapshotId}/archive`,
    );
    expect(archive.status).toBe(200);
    expect(archive.headers.get("content-type")).toContain("application/zip");
    expect(archive.headers.get("content-disposition")).toContain("Packaged app.zip");
    expect((await archive.arrayBuffer()).byteLength).toBeGreaterThan(20);
  });

  it("renames and soft deletes a code workspace for project tree operations", async () => {
    const { app } = appWith();
    const create = await app.request(`/api/projects/${projectId}/code-workspaces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Original app",
        description: "Before",
        manifest: { entries: [] },
      }),
    });
    const { workspace } = await create.json() as {
      workspace: { id: string };
    };

    const rename = await app.request(`/api/code-workspaces/${workspace.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Renamed app", description: "After" }),
    });
    expect(rename.status).toBe(200);
    expect(await rename.json()).toMatchObject({
      workspace: { id: workspace.id, name: "Renamed app", description: "After" },
    });

    const remove = await app.request(`/api/code-workspaces/${workspace.id}`, {
      method: "DELETE",
    });
    expect(remove.status).toBe(200);

    const detail = await app.request(`/api/code-workspaces/${workspace.id}`);
    expect(detail.status).toBe(404);
    const list = await app.request(`/api/projects/${projectId}/code-workspaces`);
    expect(await list.json()).toMatchObject({ workspaces: [] });
  });

  it("checks project permissions before exposing workspace rows", async () => {
    const { app } = appWith();
    const forbiddenProject = "00000000-0000-4000-8000-000000000404";
    const response = await app.request(`/api/projects/${forbiddenProject}/code-workspaces`);
    expect(response.status).toBe(403);
  });
});
