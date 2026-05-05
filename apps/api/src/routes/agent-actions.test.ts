import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createAgentActionRoutes } from "./agent-actions";
import type { AppEnv } from "../lib/types";
import type { AgentAction } from "@opencairn/shared";
import type {
  AgentActionRepository,
  CodeCommandRunner,
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
});

function appWith(options: {
  repo: AgentActionRepository;
  codeWorkspaceRepo?: CodeWorkspaceRepository;
  codeCommandRunner?: CodeCommandRunner;
  noteUpdatePreviewer?: NoteUpdatePreviewer;
  noteUpdateApplier?: NoteUpdateApplier;
}) {
  return new Hono<AppEnv>().route(
    "/api",
    createAgentActionRoutes({
      repo: options.repo,
      codeWorkspaceRepo: options.codeWorkspaceRepo,
      codeCommandRunner: options.codeCommandRunner,
      canWriteProject: async () => true,
      noteUpdatePreviewer: options.noteUpdatePreviewer,
      noteUpdateApplier: options.noteUpdateApplier,
      auth: async (c, next) => {
        c.set("userId", userId);
        c.set("user", { id: userId, email: "user@example.com", name: "User" });
        await next();
      },
    }),
  );
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
        ok: result.exitCode === 0,
        command: input.request.command,
        exitCode: result.exitCode,
        durationMs: 42,
        logs: [{ stream: "stdout", text: result.exitCode === 0 ? "tests passed" : "tests failed" }],
      };
    },
  };
}

function createMemoryRepo(): AgentActionRepository {
  const rows = new Map<string, AgentAction>();
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
    async insert(values) {
      const existing = await this.findByRequestId(
        values.projectId,
        values.actorUserId,
        values.requestId,
      );
      if (existing) return { action: existing, inserted: false };
      const now = new Date("2026-05-05T00:00:00.000Z").toISOString();
      const row: AgentAction = {
        id: "00000000-0000-4000-8000-000000000010",
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
        ...(values.preview !== undefined ? { preview: values.preview } : {}),
        ...(values.result !== undefined ? { result: values.result } : {}),
        ...(values.errorCode !== undefined ? { errorCode: values.errorCode } : {}),
      };
      rows.set(id, next);
      return next;
    },
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
