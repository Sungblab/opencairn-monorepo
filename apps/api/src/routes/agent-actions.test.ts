import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createAgentActionRoutes } from "./agent-actions";
import type { AppEnv } from "../lib/types";
import type { AgentAction } from "@opencairn/shared";
import type {
  AgentActionRepository,
  AgentActionServiceOptions,
  CodeCommandCanceller,
  CodeCommandRunner,
  CodeInstallRunner,
  CodeRepairPlanner,
  NoteUpdateApplier,
  NoteUpdatePreviewer,
} from "../lib/agent-actions";
import {
  createMemoryCodeWorkspaceRepository,
  type CodeWorkspaceRepository,
} from "../lib/code-project-workspaces";

const userId = "user-1";
const workspaceId = "00000000-0000-4000-8000-000000000001";
const projectId = "00000000-0000-4000-8000-000000000002";
const requestId = "00000000-0000-4000-8000-000000000003";

describe("agent action routes", () => {
  it("runs a low-risk placeholder action end to end through the API route", async () => {
    const app = new Hono<AppEnv>().route(
      "/api",
      createAgentActionRoutes({
        repo: createMemoryRepo(),
        canWriteProject: async () => true,
        auth: async (c, next) => {
          c.set("userId", userId);
          c.set("user", { id: userId, email: "user@example.com", name: "User" });
          await next();
        },
      }),
    );

    const create = await app.request(`/api/projects/${projectId}/agent-actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestId,
        kind: "workflow.placeholder",
        risk: "low",
        input: { label: "api-smoke" },
      }),
    });

    expect(create.status).toBe(201);
    const body = await create.json() as { action: AgentAction; idempotent: boolean };
    expect(body.idempotent).toBe(false);
    expect(body.action).toMatchObject({
      requestId,
      workspaceId,
      projectId,
      actorUserId: userId,
      status: "completed",
      result: { ok: true, placeholder: true, input: { label: "api-smoke" } },
    });

    const duplicate = await app.request(`/api/projects/${projectId}/agent-actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestId,
        kind: "workflow.placeholder",
        risk: "low",
      }),
    });
    expect(duplicate.status).toBe(200);
    expect((await duplicate.json() as { idempotent: boolean }).idempotent).toBe(true);
  });

  it("rejects scope fields in payloads before service execution", async () => {
    const app = new Hono<AppEnv>().route(
      "/api",
      createAgentActionRoutes({
        repo: createMemoryRepo(),
        canWriteProject: async () => true,
        auth: async (c, next) => {
          c.set("userId", userId);
          c.set("user", { id: userId, email: "user@example.com", name: "User" });
          await next();
        },
      }),
    );

    const response = await app.request(`/api/projects/${projectId}/agent-actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "workflow.placeholder",
        risk: "low",
        input: { project_id: projectId },
      }),
    });

    expect(response.status).toBe(400);
  });

  it("creates note.update as a draft action with a generated preview", async () => {
    const noteUpdatePreviewer = createMemoryNoteUpdatePreviewer();
    const app = new Hono<AppEnv>().route(
      "/api",
      createAgentActionRoutes({
        repo: createMemoryRepo(),
        canWriteProject: async () => true,
        noteUpdatePreviewer,
        auth: async (c, next) => {
          c.set("userId", userId);
          c.set("user", { id: userId, email: "user@example.com", name: "User" });
          await next();
        },
      }),
    );

    const response = await app.request(`/api/projects/${projectId}/agent-actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestId,
        kind: "note.update",
        risk: "write",
        input: {
          noteId: "00000000-0000-4000-8000-000000000021",
          draft: {
            format: "plate_value_v1",
            content: [{ type: "p", children: [{ text: "updated draft" }] }],
          },
        },
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json() as { action: AgentAction };
    expect(noteUpdatePreviewer.calls).toEqual([
      { noteId: "00000000-0000-4000-8000-000000000021" },
    ]);
    expect(body.action).toMatchObject({
      kind: "note.update",
      status: "draft",
      preview: {
        noteId: "00000000-0000-4000-8000-000000000021",
        source: "yjs",
        draft: { contentText: "updated draft" },
      },
      result: null,
    });
  });

  it("applies a note.update draft action through the API route", async () => {
    const repo = createMemoryRepo();
    const app = new Hono<AppEnv>().route(
      "/api",
      createAgentActionRoutes({
        repo,
        canWriteProject: async () => true,
        noteUpdatePreviewer: createMemoryNoteUpdatePreviewer(),
        noteUpdateApplier: createMemoryNoteUpdateApplier(),
        auth: async (c, next) => {
          c.set("userId", userId);
          c.set("user", { id: userId, email: "user@example.com", name: "User" });
          await next();
        },
      }),
    );

    const create = await app.request(`/api/projects/${projectId}/agent-actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestId,
        kind: "note.update",
        risk: "write",
        input: {
          noteId: "00000000-0000-4000-8000-000000000021",
          draft: {
            format: "plate_value_v1",
            content: [{ type: "p", children: [{ text: "updated draft" }] }],
          },
        },
      }),
    });
    const { action } = await create.json() as { action: AgentAction };

    const apply = await app.request(`/api/agent-actions/${action.id}/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ yjsStateVectorBase64: "AQID" }),
    });

    expect(apply.status).toBe(200);
    const body = await apply.json() as { action: AgentAction };
    expect(body.action).toMatchObject({
      kind: "note.update",
      status: "completed",
      result: {
        ok: true,
        noteId: "00000000-0000-4000-8000-000000000021",
      },
      errorCode: null,
    });
  });

  it("creates a code_project.create action and persists a code workspace", async () => {
    const codeWorkspaceRepo = createMemoryCodeWorkspaceRepository();
    const app = appWith({
      repo: createMemoryRepo(),
      codeWorkspaceRepo,
    });

    const response = await app.request(`/api/projects/${projectId}/agent-actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestId,
        kind: "code_project.create",
        risk: "write",
        input: {
          name: "Agent app",
          language: "typescript",
          framework: "react",
          manifest: {
            entries: [
              { path: "src", kind: "directory" },
              {
                path: "src/App.tsx",
                kind: "file",
                bytes: 12,
                contentHash: "sha256:app",
                inlineContent: "export {}",
              },
            ],
          },
        },
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json() as { action: AgentAction };
    expect(body.action).toMatchObject({
      kind: "code_project.create",
      status: "completed",
      result: {
        ok: true,
        workspace: { name: "Agent app" },
        snapshot: { manifest: { entries: [{ path: "src" }, { path: "src/App.tsx" }] } },
      },
      errorCode: null,
    });
    expect(codeWorkspaceRepo.rows.workspaces.size).toBe(1);
  });

  it("creates a draft code_project.patch action and applies it into a new snapshot", async () => {
    const codeWorkspaceRepo = createMemoryCodeWorkspaceRepository();
    const app = appWith({
      repo: createMemoryRepo(),
      codeWorkspaceRepo,
    });

    const createWorkspace = await app.request(`/api/projects/${projectId}/agent-actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "code_project.create",
        risk: "write",
        input: {
          name: "Patchable app",
          manifest: {
            entries: [
              {
                path: "src/App.tsx",
                kind: "file",
                bytes: 3,
                contentHash: "sha256:old",
                inlineContent: "old",
              },
            ],
          },
        },
      }),
    });
    const created = await createWorkspace.json() as { action: AgentAction };
    const workspace = (created.action.result?.workspace as { id: string; currentSnapshotId: string });

    const patch = await app.request(`/api/projects/${projectId}/agent-actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestId: "00000000-0000-4000-8000-000000000044",
        kind: "code_project.patch",
        risk: "write",
        input: {
          codeWorkspaceId: workspace.id,
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
        },
      }),
    });

    expect(patch.status).toBe(201);
    const draft = await patch.json() as { action: AgentAction };
    expect(draft.action).toMatchObject({
      kind: "code_project.patch",
      status: "draft",
      preview: { filesChanged: 1, summary: "Update app" },
      result: null,
    });

    const apply = await app.request(`/api/agent-actions/${draft.action.id}/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(apply.status).toBe(200);
    const applied = await apply.json() as { action: AgentAction };
    expect(applied.action).toMatchObject({
      kind: "code_project.patch",
      status: "completed",
      result: {
        ok: true,
        workspace: { id: workspace.id },
        snapshot: {
          manifest: {
            entries: [
              expect.objectContaining({
                path: "src/App.tsx",
                contentHash: "sha256:new",
                inlineContent: "new",
              }),
            ],
          },
        },
      },
    });
  });

  it("runs an approved code_project.run command through the command runner seam", async () => {
    const codeWorkspaceRepo = createMemoryCodeWorkspaceRepository();
    const codeCommandRunner = createMemoryCodeCommandRunner({ exitCode: 0 });
    const app = appWith({
      repo: createMemoryRepo(),
      codeWorkspaceRepo,
      codeCommandRunner,
    });

    const createWorkspace = await app.request(`/api/projects/${projectId}/agent-actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "code_project.create",
        risk: "write",
        input: {
          name: "Runnable app",
          manifest: {
            entries: [
              {
                path: "package.json",
                kind: "file",
                bytes: 16,
                contentHash: "sha256:pkg",
                inlineContent: "{\"scripts\":{}}",
              },
            ],
          },
        },
      }),
    });
    const created = await createWorkspace.json() as { action: AgentAction };
    const workspace = (created.action.result?.workspace as { id: string; currentSnapshotId: string });

    const run = await app.request(`/api/projects/${projectId}/agent-actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestId: "00000000-0000-4000-8000-000000000055",
        kind: "code_project.run",
        risk: "write",
        input: {
          codeWorkspaceId: workspace.id,
          snapshotId: workspace.currentSnapshotId,
          command: "test",
          timeoutMs: 30_000,
        },
      }),
    });

    expect(run.status).toBe(201);
    const body = await run.json() as { action: AgentAction };
    expect(codeCommandRunner.calls).toEqual([
      {
        command: "test",
        entries: ["package.json"],
      },
    ]);
    expect(body.action).toMatchObject({
      kind: "code_project.run",
      status: "completed",
      result: {
        ok: true,
        command: "test",
        exitCode: 0,
        logs: [{ stream: "stdout", text: "tests passed" }],
      },
    });
  });

  it("rejects unapproved code_project.run commands before execution", async () => {
    const codeCommandRunner = createMemoryCodeCommandRunner({ exitCode: 0 });
    const app = appWith({
      repo: createMemoryRepo(),
      codeWorkspaceRepo: createMemoryCodeWorkspaceRepository(),
      codeCommandRunner,
    });

    const response = await app.request(`/api/projects/${projectId}/agent-actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "code_project.run",
        risk: "write",
        input: {
          codeWorkspaceId: "00000000-0000-4000-8000-000000000020",
          snapshotId: "00000000-0000-4000-8000-000000000021",
          command: "rm -rf /",
        },
      }),
    });

    expect(response.status).toBe(400);
    expect(codeCommandRunner.calls).toEqual([]);
  });

  it("creates an approval-required code_project.install action without executing it", async () => {
    const app = appWith({
      repo: createMemoryRepo(),
    });

    const response = await app.request(`/api/projects/${projectId}/agent-actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestId: "00000000-0000-4000-8000-000000000075",
        kind: "code_project.install",
        risk: "external",
        input: {
          codeWorkspaceId: "00000000-0000-4000-8000-000000000020",
          snapshotId: "00000000-0000-4000-8000-000000000021",
          packageManager: "pnpm",
          packages: [{ name: "@vitejs/plugin-react", dev: true }],
          network: "required",
          reason: "Build needs the React plugin",
        },
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json() as { action: AgentAction };
    expect(body.action).toMatchObject({
      kind: "code_project.install",
      risk: "external",
      status: "approval_required",
      preview: {
        kind: "code_project.install",
        approval: "dependency_install",
        packageManager: "pnpm",
        network: "required",
        summary: "Install @vitejs/plugin-react (dev) with pnpm",
      },
    });
  });

  it("applies an approved code_project.install action through the install runner seam", async () => {
    const codeWorkspaceRepo = createMemoryCodeWorkspaceRepository();
    const codeInstallRunner = createMemoryCodeInstallRunner({ exitCode: 0 });
    const app = appWith({
      repo: createMemoryRepo(),
      codeWorkspaceRepo,
      codeInstallRunner,
    });

    const createWorkspace = await app.request(`/api/projects/${projectId}/agent-actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "code_project.create",
        risk: "write",
        input: {
          name: "Installable app",
          manifest: {
            entries: [
              {
                path: "package.json",
                kind: "file",
                bytes: 16,
                contentHash: "sha256:pkg",
                inlineContent: "{\"dependencies\":{}}",
              },
            ],
          },
        },
      }),
    });
    const created = (await createWorkspace.json()) as { action: AgentAction };
    const workspace = created.action.result?.workspace as {
      id: string;
      currentSnapshotId: string;
    };

    const createInstall = await app.request(`/api/projects/${projectId}/agent-actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestId: "00000000-0000-4000-8000-000000000077",
        kind: "code_project.install",
        risk: "external",
        input: {
          codeWorkspaceId: workspace.id,
          snapshotId: workspace.currentSnapshotId,
          packageManager: "pnpm",
          packages: [{ name: "@vitejs/plugin-react", dev: true }],
          network: "required",
          reason: "Build needs the React plugin",
        },
      }),
    });
    expect(createInstall.status).toBe(201);
    const install = (await createInstall.json()) as { action: AgentAction };
    expect(install.action.status).toBe("approval_required");

    const apply = await app.request(`/api/agent-actions/${install.action.id}/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(apply.status).toBe(200);
    expect(codeInstallRunner.calls).toEqual([
      {
        packageManager: "pnpm",
        packages: ["@vitejs/plugin-react"],
        devPackages: ["@vitejs/plugin-react"],
        entries: ["package.json"],
      },
    ]);
    const applied = (await apply.json()) as { action: AgentAction };
    expect(applied.action).toMatchObject({
      kind: "code_project.install",
      status: "completed",
      errorCode: null,
      result: {
        ok: true,
        packageManager: "pnpm",
        installed: [{ name: "@vitejs/plugin-react", dev: true }],
        exitCode: 0,
      },
    });
  });

  it("creates an approval-required static code_project.preview action", async () => {
    const app = appWith({
      repo: createMemoryRepo(),
    });

    const response = await app.request(`/api/projects/${projectId}/agent-actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestId: "00000000-0000-4000-8000-000000000076",
        kind: "code_project.preview",
        risk: "external",
        input: {
          codeWorkspaceId: "00000000-0000-4000-8000-000000000020",
          snapshotId: "00000000-0000-4000-8000-000000000021",
          mode: "static",
          entryPath: "index.html",
          reason: "Review generated app",
        },
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json() as { action: AgentAction };
    expect(body.action).toMatchObject({
      kind: "code_project.preview",
      risk: "external",
      status: "approval_required",
      preview: {
        kind: "code_project.preview",
        approval: "hosted_preview",
        mode: "static",
        entryPath: "index.html",
        summary: "Create static preview for index.html",
      },
    });
  });

  it("applies and serves a sandboxed static code_project.preview asset", async () => {
    const repo = createMemoryRepo();
    const codeWorkspaceRepo = createMemoryCodeWorkspaceRepository();
    const { workspace, snapshot } = await codeWorkspaceRepo.createWorkspaceDraft({
      scope: { workspaceId, projectId, actorUserId: userId },
      requestId: "00000000-0000-4000-8000-000000000096",
      snapshotId: "00000000-0000-4000-8000-000000000097",
      treeHash: "sha256:preview",
      request: {
        name: "Preview app",
        manifest: {
          entries: [
            {
              path: "index.html",
              kind: "file",
              mimeType: "text/html",
              bytes: 16,
              contentHash: "sha256:index",
              inlineContent: "<h1>Preview</h1>",
            },
          ],
        },
      },
    });
    const app = appWith({ repo, codeWorkspaceRepo });
    const create = await app.request(`/api/projects/${projectId}/agent-actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestId: "00000000-0000-4000-8000-000000000098",
        kind: "code_project.preview",
        risk: "external",
        input: {
          codeWorkspaceId: workspace.id,
          snapshotId: snapshot.id,
          mode: "static",
          entryPath: "index.html",
        },
      }),
    });
    const created = await create.json() as { action: AgentAction };

    const apply = await app.request(`/api/agent-actions/${created.action.id}/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(apply.status).toBe(200);
    const applied = await apply.json() as { action: AgentAction };
    expect(applied.action.result).toMatchObject({
      previewUrl: `/api/agent-actions/${created.action.id}/preview/index.html`,
    });

    const asset = await app.request(
      `/api/agent-actions/${created.action.id}/preview/index.html`,
    );
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toContain("text/html");
    expect(asset.headers.get("content-security-policy")).toContain("sandbox");
    expect(await asset.text()).toBe("<h1>Preview</h1>");
  });

  it("serves signed public static code_project.preview assets without a session", async () => {
    const repo = createMemoryRepo();
    const codeWorkspaceRepo = createMemoryCodeWorkspaceRepository();
    const { workspace, snapshot } = await codeWorkspaceRepo.createWorkspaceDraft({
      scope: { workspaceId, projectId, actorUserId: userId },
      requestId: "00000000-0000-4000-8000-000000000085",
      snapshotId: "00000000-0000-4000-8000-000000000086",
      treeHash: "sha256:public-preview",
      request: {
        name: "Public preview app",
        manifest: {
          entries: [
            {
              path: "index.html",
              kind: "file",
              mimeType: "text/html",
              bytes: 16,
              contentHash: "sha256:index",
              inlineContent: "<h1>Public Preview</h1>",
            },
          ],
        },
      },
    });
    const app = appWith({
      repo,
      codeWorkspaceRepo,
      codePreviewPublicBaseUrl: "https://preview.example.com",
      codePreviewPublicUrlSecret: "test-public-preview-secret",
    });
    const create = await app.request(`/api/projects/${projectId}/agent-actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestId: "00000000-0000-4000-8000-000000000087",
        kind: "code_project.preview",
        risk: "external",
        input: {
          codeWorkspaceId: workspace.id,
          snapshotId: snapshot.id,
          mode: "static",
          entryPath: "index.html",
        },
      }),
    });
    const created = await create.json() as { action: AgentAction };
    const apply = await app.request(`/api/agent-actions/${created.action.id}/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const applied = await apply.json() as { action: AgentAction };
    const publicPreviewUrl = new URL(
      (applied.action.result as { publicPreviewUrl: string }).publicPreviewUrl,
    );

    expect(publicPreviewUrl.origin).toBe("https://preview.example.com");
    const asset = await app.request(`${publicPreviewUrl.pathname}${publicPreviewUrl.search}`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-security-policy")).toContain("sandbox");
    expect(asset.headers.get("cache-control")).toBe("public, no-store");
    expect(await asset.text()).toBe("<h1>Public Preview</h1>");

    const invalidToken = publicPreviewUrl.pathname.replace(
      /\/preview\/[^/]+\//,
      "/preview/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/",
    );
    const rejected = await app.request(invalidToken);
    expect(rejected.status).toBe(403);
    expect(await rejected.json()).toMatchObject({ error: "code_project_preview_invalid_token" });
  });

  it("serves object-backed static code_project.preview assets", async () => {
    const repo = createMemoryRepo();
    const codeWorkspaceRepo = createMemoryCodeWorkspaceRepository();
    const { workspace, snapshot } = await codeWorkspaceRepo.createWorkspaceDraft({
      scope: { workspaceId, projectId, actorUserId: userId },
      requestId: "00000000-0000-4000-8000-000000000089",
      snapshotId: "00000000-0000-4000-8000-000000000090",
      treeHash: "sha256:preview-object",
      request: {
        name: "Preview app",
        manifest: {
          entries: [
            {
              path: "index.html",
              kind: "file",
              mimeType: "text/html",
              bytes: 16,
              contentHash: "sha256:index",
              inlineContent: "<link rel=\"stylesheet\" href=\"style.css\">",
            },
            {
              path: "style.css",
              kind: "file",
              mimeType: "text/css",
              bytes: 15,
              contentHash: "sha256:css",
              objectKey: "code-workspaces/demo/style.css",
            },
          ],
        },
      },
    });
    const app = appWith({
      repo,
      codeWorkspaceRepo,
      codePreviewObjectReader: {
        async read(objectKey) {
          expect(objectKey).toBe("code-workspaces/demo/style.css");
          return {
            body: "body{color:red}",
            contentType: "text/css; charset=utf-8",
            contentLength: 15,
          };
        },
      },
    });
    const create = await app.request(`/api/projects/${projectId}/agent-actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestId: "00000000-0000-4000-8000-000000000091",
        kind: "code_project.preview",
        risk: "external",
        input: {
          codeWorkspaceId: workspace.id,
          snapshotId: snapshot.id,
          mode: "static",
          entryPath: "index.html",
        },
      }),
    });
    const created = await create.json() as { action: AgentAction };
    await app.request(`/api/agent-actions/${created.action.id}/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    const asset = await app.request(
      `/api/agent-actions/${created.action.id}/preview/style.css`,
    );

    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toContain("text/css");
    expect(await asset.text()).toBe("body{color:red}");
  });

  it("serves object-backed static code_project.preview entry assets", async () => {
    const repo = createMemoryRepo();
    const codeWorkspaceRepo = createMemoryCodeWorkspaceRepository();
    const { workspace, snapshot } = await codeWorkspaceRepo.createWorkspaceDraft({
      scope: { workspaceId, projectId, actorUserId: userId },
      requestId: "00000000-0000-4000-8000-000000000092",
      snapshotId: "00000000-0000-4000-8000-000000000093",
      treeHash: "sha256:preview-object-entry",
      request: {
        name: "Preview app",
        manifest: {
          entries: [
            {
              path: "index.html",
              kind: "file",
              mimeType: "text/html",
              bytes: 16,
              contentHash: "sha256:index",
              objectKey: "code-workspaces/demo/index.html",
            },
          ],
        },
      },
    });
    const app = appWith({
      repo,
      codeWorkspaceRepo,
      codePreviewObjectReader: {
        async read(objectKey) {
          expect(objectKey).toBe("code-workspaces/demo/index.html");
          return {
            body: "<h1>Preview</h1>",
            contentType: "text/html; charset=utf-8",
            contentLength: 16,
          };
        },
      },
    });
    const create = await app.request(`/api/projects/${projectId}/agent-actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestId: "00000000-0000-4000-8000-000000000094",
        kind: "code_project.preview",
        risk: "external",
        input: {
          codeWorkspaceId: workspace.id,
          snapshotId: snapshot.id,
          mode: "static",
          entryPath: "index.html",
        },
      }),
    });
    const created = await create.json() as { action: AgentAction };
    const apply = await app.request(`/api/agent-actions/${created.action.id}/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(apply.status).toBe(200);

    const asset = await app.request(
      `/api/agent-actions/${created.action.id}/preview/index.html`,
    );

    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toContain("text/html");
    expect(asset.headers.get("content-security-policy")).toContain("sandbox");
    expect(await asset.text()).toBe("<h1>Preview</h1>");
  });

  it("rejects expired static code_project.preview assets", async () => {
    const repo = createMemoryRepo();
    const codeWorkspaceRepo = createMemoryCodeWorkspaceRepository();
    const { workspace, snapshot } = await codeWorkspaceRepo.createWorkspaceDraft({
      scope: { workspaceId, projectId, actorUserId: userId },
      requestId: "00000000-0000-4000-8000-000000000086",
      snapshotId: "00000000-0000-4000-8000-000000000087",
      treeHash: "sha256:preview",
      request: {
        name: "Preview app",
        manifest: {
          entries: [
            {
              path: "index.html",
              kind: "file",
              mimeType: "text/html",
              bytes: 16,
              contentHash: "sha256:index",
              inlineContent: "<h1>Preview</h1>",
            },
          ],
        },
      },
    });
    let now = new Date("2026-05-05T00:00:00.000Z");
    const app = appWith({
      repo,
      codeWorkspaceRepo,
      now: () => now,
      codePreviewTtlMs: 60_000,
    });
    const create = await app.request(`/api/projects/${projectId}/agent-actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestId: "00000000-0000-4000-8000-000000000088",
        kind: "code_project.preview",
        risk: "external",
        input: {
          codeWorkspaceId: workspace.id,
          snapshotId: snapshot.id,
          mode: "static",
          entryPath: "index.html",
        },
      }),
    });
    const created = await create.json() as { action: AgentAction };
    const apply = await app.request(`/api/agent-actions/${created.action.id}/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(await apply.json()).toMatchObject({
      action: {
        result: { expiresAt: "2026-05-05T00:01:00.000Z" },
      },
    });
    now = new Date("2026-05-05T00:02:00.000Z");

    const expired = await app.request(
      `/api/agent-actions/${created.action.id}/preview/index.html`,
    );

    expect(expired.status).toBe(409);
    expect(await expired.json()).toMatchObject({
      error: "code_project_preview_expired",
    });
  });

  it("cancels a running code_project.run action", async () => {
    const running = makeAction({
      id: "00000000-0000-4000-8000-000000000080",
      kind: "code_project.run",
      status: "running",
      risk: "write",
    });
    const calls: string[] = [];
    const app = appWith({
      repo: createMemoryRepo([running]),
      codeCommandCanceller: {
        async cancel(input) {
          calls.push(input.action.id);
        },
      },
    });

    const response = await app.request(`/api/agent-actions/${running.id}/cancel`, {
      method: "POST",
    });

    expect(response.status).toBe(202);
    const body = await response.json() as { action: AgentAction; idempotent: boolean };
    expect(calls).toEqual([running.id]);
    expect(body.idempotent).toBe(false);
    expect(body.action).toMatchObject({
      status: "cancelled",
      errorCode: "cancelled",
      result: { ok: false, errorCode: "cancelled" },
    });
  });

  it("creates a repair patch draft from a failed code_project.run action", async () => {
    const codeWorkspaceRepo = createMemoryCodeWorkspaceRepository();
    const codeRepairPlanner = createMemoryCodeRepairPlanner();
    const app = appWith({
      repo: createMemoryRepo(),
      codeWorkspaceRepo,
      codeCommandRunner: createMemoryCodeCommandRunner({ exitCode: 1 }),
      codeRepairPlanner,
    });

    const createWorkspace = await app.request(`/api/projects/${projectId}/agent-actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "code_project.create",
        risk: "write",
        input: {
          name: "Repairable app",
          manifest: {
            entries: [
              {
                path: "src/App.tsx",
                kind: "file",
                bytes: 3,
                contentHash: "sha256:old",
                inlineContent: "old",
              },
            ],
          },
        },
      }),
    });
    const created = await createWorkspace.json() as { action: AgentAction };
    const workspace = (created.action.result?.workspace as { id: string; currentSnapshotId: string });

    const run = await app.request(`/api/projects/${projectId}/agent-actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestId: "00000000-0000-4000-8000-000000000060",
        kind: "code_project.run",
        risk: "write",
        input: {
          codeWorkspaceId: workspace.id,
          snapshotId: workspace.currentSnapshotId,
          command: "test",
        },
      }),
    });
    const failedRun = await run.json() as { action: AgentAction };
    expect(failedRun.action.status).toBe("failed");

    const repair = await app.request(`/api/agent-actions/${failedRun.action.id}/repair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: "00000000-0000-4000-8000-000000000061" }),
    });

    expect(repair.status).toBe(201);
    const body = await repair.json() as { action: AgentAction; idempotent: boolean };
    expect(codeRepairPlanner.calls).toEqual([
      {
        failedRunActionId: failedRun.action.id,
        command: "test",
        logs: ["tests failed"],
        entries: ["src/App.tsx"],
      },
    ]);
    expect(body.idempotent).toBe(false);
    expect(body.action).toMatchObject({
      kind: "code_project.patch",
      sourceRunId: failedRun.action.id,
      status: "draft",
      preview: { filesChanged: 1, summary: "Repair failing test" },
      input: {
        codeWorkspaceId: workspace.id,
        baseSnapshotId: workspace.currentSnapshotId,
        operations: [
          expect.objectContaining({
            op: "update",
            path: "src/App.tsx",
            beforeHash: "sha256:old",
            afterHash: "sha256:repair",
          }),
        ],
      },
    });
  });

  it("caps repair patch attempts per failed code_project.run action", async () => {
    const codeWorkspaceRepo = createMemoryCodeWorkspaceRepository();
    const app = appWith({
      repo: createMemoryRepo(),
      codeWorkspaceRepo,
      codeCommandRunner: createMemoryCodeCommandRunner({ exitCode: 1 }),
      codeRepairPlanner: createMemoryCodeRepairPlanner(),
    });

    const createWorkspace = await app.request(`/api/projects/${projectId}/agent-actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "code_project.create",
        risk: "write",
        input: {
          name: "Repair capped app",
          manifest: {
            entries: [
              {
                path: "src/App.tsx",
                kind: "file",
                bytes: 3,
                contentHash: "sha256:old",
                inlineContent: "old",
              },
            ],
          },
        },
      }),
    });
    const created = await createWorkspace.json() as { action: AgentAction };
    const workspace = (created.action.result?.workspace as { id: string; currentSnapshotId: string });

    const run = await app.request(`/api/projects/${projectId}/agent-actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestId: "00000000-0000-4000-8000-000000000070",
        kind: "code_project.run",
        risk: "write",
        input: {
          codeWorkspaceId: workspace.id,
          snapshotId: workspace.currentSnapshotId,
          command: "test",
        },
      }),
    });
    const failedRun = await run.json() as { action: AgentAction };

    for (const suffix of ["071", "072", "073"]) {
      const response = await app.request(`/api/agent-actions/${failedRun.action.id}/repair`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId: `00000000-0000-4000-8000-000000000${suffix}` }),
      });
      expect(response.status).toBe(201);
    }

    const capped = await app.request(`/api/agent-actions/${failedRun.action.id}/repair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: "00000000-0000-4000-8000-000000000074" }),
    });
    expect(capped.status).toBe(409);
    expect(await capped.json()).toMatchObject({ error: "code_project_repair_limit_exceeded" });
  });
});

function appWith(options: {
  repo: AgentActionRepository;
  codeWorkspaceRepo?: CodeWorkspaceRepository;
  codeCommandRunner?: CodeCommandRunner;
  codeInstallRunner?: CodeInstallRunner;
  codeCommandCanceller?: CodeCommandCanceller;
  codeRepairPlanner?: CodeRepairPlanner;
  noteUpdatePreviewer?: NoteUpdatePreviewer;
  noteUpdateApplier?: NoteUpdateApplier;
  now?: () => Date;
  codePreviewTtlMs?: number;
  codePreviewObjectReader?: AgentActionServiceOptions["codePreviewObjectReader"];
  codePreviewPublicBaseUrl?: string;
  codePreviewPublicUrlSecret?: string;
}) {
  return new Hono<AppEnv>().route(
    "/api",
    createAgentActionRoutes({
      repo: options.repo,
      codeWorkspaceRepo: options.codeWorkspaceRepo,
      codeCommandRunner: options.codeCommandRunner,
      codeInstallRunner: options.codeInstallRunner,
      codeCommandCanceller: options.codeCommandCanceller,
      codeRepairPlanner: options.codeRepairPlanner,
      canWriteProject: async () => true,
      noteUpdatePreviewer: options.noteUpdatePreviewer,
      noteUpdateApplier: options.noteUpdateApplier,
      now: options.now,
      codePreviewTtlMs: options.codePreviewTtlMs,
      codePreviewObjectReader: options.codePreviewObjectReader,
      codePreviewPublicBaseUrl: options.codePreviewPublicBaseUrl,
      codePreviewPublicUrlSecret: options.codePreviewPublicUrlSecret,
      auth: async (c, next) => {
        c.set("userId", userId);
        c.set("user", { id: userId, email: "user@example.com", name: "User" });
        await next();
      },
    }),
  );
}

function createMemoryCodeInstallRunner(result: {
  exitCode: number;
}): CodeInstallRunner & {
  calls: Array<{
    packageManager: string;
    packages: string[];
    devPackages: string[];
    entries: string[];
  }>;
} {
  const calls: Array<{
    packageManager: string;
    packages: string[];
    devPackages: string[];
    entries: string[];
  }> = [];
  return {
    calls,
    async install(input) {
      calls.push({
        packageManager: input.request.packageManager,
        packages: input.request.packages.map((pkg) => pkg.name),
        devPackages: input.request.packages
          .filter((pkg) => pkg.dev)
          .map((pkg) => pkg.name),
        entries: input.snapshot.manifest.entries.map((entry) => entry.path),
      });
      return {
        kind: "completed",
        result: {
          ok: result.exitCode === 0,
          packageManager: input.request.packageManager,
          installed: input.request.packages,
          exitCode: result.exitCode,
          logs: [{ stream: "stdout", text: result.exitCode === 0 ? "install passed" : "install failed" }],
        },
      };
    },
  };
}

function createMemoryCodeRepairPlanner(): CodeRepairPlanner & {
  calls: Array<{
    failedRunActionId: string;
    command: string;
    logs: string[];
    entries: string[];
  }>;
} {
  const calls: Array<{
    failedRunActionId: string;
    command: string;
    logs: string[];
    entries: string[];
  }> = [];
  return {
    calls,
    async plan(input) {
      calls.push({
        failedRunActionId: input.failedRunAction.id,
        command: input.runResult.command,
        logs: input.runResult.logs.map((log) => log.text),
        entries: input.snapshot.manifest.entries.map((entry) => entry.path),
      });
      return {
        kind: "completed",
        result: {
          codeWorkspaceId: input.workspace.id,
          baseSnapshotId: input.snapshot.id,
          operations: [
            {
              op: "update",
              path: "src/App.tsx",
              beforeHash: "sha256:old",
              afterHash: "sha256:repair",
              inlineContent: "repair",
            },
          ],
          preview: {
            filesChanged: 1,
            additions: 1,
            deletions: 1,
            summary: "Repair failing test",
          },
        },
      };
    },
  };
}

function createMemoryCodeCommandRunner(result: {
  exitCode: number;
}): CodeCommandRunner & {
  calls: Array<{ command: string; entries: string[] }>;
} {
  const calls: Array<{ command: string; entries: string[] }> = [];
  return {
    calls,
    async run(input) {
      calls.push({
        command: input.request.command,
        entries: input.snapshot.manifest.entries.map((entry) => entry.path),
      });
      return {
        kind: "completed",
        result: {
          ok: result.exitCode === 0,
          command: input.request.command,
          exitCode: result.exitCode,
          durationMs: 42,
          logs: [{ stream: "stdout", text: result.exitCode === 0 ? "tests passed" : "tests failed" }],
        },
      };
    },
  };
}

function createMemoryRepo(seed: AgentAction[] = []): AgentActionRepository {
  const rows = new Map<string, AgentAction>(seed.map((row) => [row.id, row]));
  return {
    async findProjectScope(id) {
      return id === projectId ? { workspaceId } : null;
    },
    async findByRequestId(pid, actorUserId, rid) {
      return [...rows.values()].find(
        (row) => row.projectId === pid && row.actorUserId === actorUserId && row.requestId === rid,
      ) ?? null;
    },
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async listByProject({ projectId: pid }) {
      return [...rows.values()].filter((row) => row.projectId === pid);
    },
    async listBySourceRunId({ projectId: pid, sourceRunId, kind }) {
      return [...rows.values()].filter(
        (row) =>
          row.projectId === pid &&
          row.sourceRunId === sourceRunId &&
          (!kind || row.kind === kind),
      );
    },
    async listExpiredCodePreviewActions() {
      return [];
    },
    async insert(values) {
      const existing = await this.findByRequestId(
        values.projectId,
        values.actorUserId,
        values.requestId,
      );
      if (existing) return { action: existing, inserted: false };
      const now = new Date("2026-05-05T00:00:00.000Z").toISOString();
      const row: AgentAction = {
        id: `00000000-0000-4000-8000-${String(rows.size + 10).padStart(12, "0")}`,
        requestId: values.requestId,
        workspaceId: values.workspaceId,
        projectId: values.projectId,
        actorUserId: values.actorUserId,
        sourceRunId: values.sourceRunId ?? null,
        kind: values.kind,
        status: values.status,
        risk: values.risk,
        input: values.input,
        preview: values.preview ?? null,
        result: values.result ?? null,
        errorCode: values.errorCode ?? null,
        createdAt: now,
        updatedAt: now,
      };
      rows.set(row.id, row);
      return { action: row, inserted: true };
    },
    async updateStatus(id, values) {
      const current = rows.get(id);
      if (!current) return null;
      const next = {
        ...current,
        status: values.status,
        ...(values.input !== undefined ? { input: values.input } : {}),
        ...(values.preview !== undefined ? { preview: values.preview } : {}),
        ...(values.result !== undefined ? { result: values.result } : {}),
        ...(values.errorCode !== undefined ? { errorCode: values.errorCode } : {}),
      };
      rows.set(id, next);
      return next;
    },
  };
}

function makeAction(overrides: Partial<AgentAction> = {}): AgentAction {
  return {
    id: "00000000-0000-4000-8000-000000000010",
    requestId: "00000000-0000-4000-8000-000000000011",
    workspaceId,
    projectId,
    actorUserId: userId,
    sourceRunId: null,
    kind: "workflow.placeholder",
    status: "draft",
    risk: "low",
    input: {},
    preview: null,
    result: null,
    errorCode: null,
    createdAt: "2026-05-05T00:00:00.000Z",
    updatedAt: "2026-05-05T00:00:00.000Z",
    ...overrides,
  };
}

function createMemoryNoteUpdatePreviewer(): NoteUpdatePreviewer & {
  calls: Array<{ noteId: string }>;
} {
  const calls: Array<{ noteId: string }> = [];
  return {
    calls,
    async preview(input) {
      calls.push({ noteId: input.payload.noteId });
      return {
        noteId: input.payload.noteId,
        source: "yjs",
        current: { contentText: "old draft", yjsStateVectorBase64: "AQID" },
        draft: { contentText: "updated draft" },
        diff: {
          fromVersion: "current",
          toVersion: "current",
          summary: {
            addedBlocks: 0,
            removedBlocks: 0,
            changedBlocks: 1,
            addedWords: 1,
            removedWords: 1,
          },
          blocks: [
            {
              key: "0",
              status: "changed",
              textDiff: [
                { kind: "delete", text: "old" },
                { kind: "insert", text: "updated" },
                { kind: "equal", text: " draft" },
              ],
            },
          ],
        },
        applyConstraints: [
          "apply_must_transform_yjs_document",
          "capture_version_before_apply",
        ],
      };
    },
  };
}

function createMemoryNoteUpdateApplier(): NoteUpdateApplier {
  return {
    async apply(input) {
      return {
        ok: true,
        noteId: input.payload.noteId,
        applied: {
          source: "yjs",
          yjsStateVectorBase64: "BAUG",
          contentText: "updated draft",
        },
        versionCapture: {
          before: { created: true, version: 4 },
          after: { created: true, version: 5 },
        },
        summary: {
          changedBlocks: 1,
          addedWords: 1,
          removedWords: 1,
        },
      };
    },
  };
}
