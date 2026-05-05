import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { AgentAction } from "@opencairn/shared";
import type { AgentActionRepository } from "../lib/agent-actions";
import type { StartDocumentGenerationParams } from "../lib/document-generation-client";
import type { AppEnv } from "../lib/types";
import { createDocumentGenerationRoutes } from "./document-generation";

const userId = "user-1";
const workspaceId = "00000000-0000-4000-8000-000000000001";
const projectId = "00000000-0000-4000-8000-000000000002";
const requestId = "00000000-0000-4000-8000-000000000003";

describe("document generation routes", () => {
  it("lists project-scoped source options for the generation picker", async () => {
    const app = new Hono<AppEnv>().route(
      "/api",
      createDocumentGenerationRoutes({
        repo: createMemoryRepo(),
        canWriteProject: async () => true,
        listSourceOptions: async (pid, uid) => {
          expect(pid).toBe(projectId);
          expect(uid).toBe(userId);
          return [
            {
              id: "note:00000000-0000-4000-8000-000000000031",
              type: "note",
              title: "Kickoff note",
              subtitle: "note",
              source: {
                type: "note",
                noteId: "00000000-0000-4000-8000-000000000031",
              },
            },
            {
              id: "agent_file:00000000-0000-4000-8000-000000000032",
              type: "agent_file",
              title: "Scanned deck",
              subtitle: "deck.pdf",
              source: {
                type: "agent_file",
                objectId: "00000000-0000-4000-8000-000000000032",
              },
              qualitySignals: ["metadata_fallback"],
            },
          ];
        },
        startDocumentGeneration: async () => ({
          workflowId: `document-generation/${requestId}`,
        }),
        auth: async (c, next) => {
          c.set("userId", userId);
          c.set("user", { id: userId, email: "user@example.com", name: "User" });
          await next();
        },
      }),
    );

    const response = await app.request(
      `/api/projects/${projectId}/document-generation/sources`,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      sources: [
        expect.objectContaining({
          type: "note",
          title: "Kickoff note",
          source: {
            type: "note",
            noteId: "00000000-0000-4000-8000-000000000031",
          },
        }),
        expect.objectContaining({
          type: "agent_file",
          qualitySignals: ["metadata_fallback"],
        }),
      ],
    });
  });

  it("starts a document generation workflow with server-injected scope", async () => {
    const startDocumentGeneration = vi.fn().mockResolvedValue({
      workflowId: `document-generation/${requestId}`,
    });
    const repo = createMemoryRepo();
    const app = createTestApp(repo, startDocumentGeneration);

    const response = await app.request(`/api/projects/${projectId}/project-object-actions/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validGenerateAction()),
    });

    expect(response.status).toBe(202);
    const body = await response.json() as {
      action: AgentAction;
      event: unknown;
      idempotent: boolean;
      workflowId: string;
    };
    expect(body.idempotent).toBe(false);
    expect(body.workflowId).toBe(`document-generation/${requestId}`);
    expect(body.action).toMatchObject({
      requestId,
      workspaceId,
      projectId,
      actorUserId: userId,
      kind: "file.generate",
      status: "queued",
      risk: "expensive",
      input: {
        type: "generate_project_object",
        generation: {
          format: "pdf",
          destination: { filename: "project-report.pdf" },
        },
      },
      result: {
        workflowId: `document-generation/${requestId}`,
        workflowHint: "document_generation",
      },
    });
    expect(body.event).toMatchObject({
      type: "project_object_generation_requested",
      requestId,
      workflowHint: "document_generation",
      generation: {
        format: "pdf",
        destination: { filename: "project-report.pdf" },
      },
    });
    expect(startDocumentGeneration).toHaveBeenCalledTimes(1);
    expect(startDocumentGeneration).toHaveBeenCalledWith({
      actionId: body.action.id,
      requestId,
      workspaceId,
      projectId,
      userId,
      generation: expect.objectContaining({
        format: "pdf",
        prompt: "Generate a polished project report.",
      }),
    });
  });

  it("rejects request-owned scope before starting Temporal", async () => {
    const startDocumentGeneration = vi.fn();
    const app = createTestApp(createMemoryRepo(), startDocumentGeneration);

    const response = await app.request(`/api/projects/${projectId}/project-object-actions/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...validGenerateAction(),
        generation: {
          ...validGenerateAction().generation,
          workspaceId,
        },
      }),
    });

    expect(response.status).toBe(400);
    expect(startDocumentGeneration).not.toHaveBeenCalled();
  });

  it("does not start Temporal twice for the same requestId", async () => {
    const startDocumentGeneration = vi.fn().mockResolvedValue({
      workflowId: `document-generation/${requestId}`,
    });
    const app = createTestApp(createMemoryRepo(), startDocumentGeneration);
    const payload = validGenerateAction();

    const first = await app.request(`/api/projects/${projectId}/project-object-actions/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const second = await app.request(`/api/projects/${projectId}/project-object-actions/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    expect((await second.json() as { idempotent: boolean }).idempotent).toBe(true);
    expect(startDocumentGeneration).toHaveBeenCalledTimes(1);
  });

  it("restarts a retryable failed requestId instead of returning a stale action", async () => {
    const startDocumentGeneration = vi.fn().mockResolvedValue({
      workflowId: `document-generation/${requestId}-retry`,
    });
    const failedAction = createAgentAction({
      id: "00000000-0000-4000-8000-000000000020",
      status: "failed",
      result: {
        ok: false,
        requestId,
        errorCode: "document_generation_start_failed",
        retryable: true,
      },
      errorCode: "document_generation_start_failed",
    });
    const app = createTestApp(createMemoryRepo([failedAction]), startDocumentGeneration);

    const response = await app.request(`/api/projects/${projectId}/project-object-actions/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validGenerateAction()),
    });

    expect(response.status).toBe(202);
    const body = await response.json() as {
      action: AgentAction;
      idempotent: boolean;
      workflowId: string;
    };
    expect(body.idempotent).toBe(false);
    expect(body.action.id).toBe(failedAction.id);
    expect(body.action.status).toBe("queued");
    expect(body.action.result).toMatchObject({
      workflowId: `document-generation/${requestId}-retry`,
      workflowHint: "document_generation",
    });
    expect(startDocumentGeneration).toHaveBeenCalledTimes(1);
    expect(startDocumentGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: failedAction.id,
        requestId,
      }),
    );
  });

  it("recovers a queued requestId that never recorded a workflowId", async () => {
    const startDocumentGeneration = vi.fn().mockResolvedValue({
      workflowId: `document-generation/${requestId}-recovered`,
    });
    const zombieAction = createAgentAction({
      id: "00000000-0000-4000-8000-000000000030",
      status: "queued",
      result: null,
    });
    const app = createTestApp(createMemoryRepo([zombieAction]), startDocumentGeneration);

    const response = await app.request(`/api/projects/${projectId}/project-object-actions/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validGenerateAction()),
    });

    expect(response.status).toBe(202);
    const body = await response.json() as {
      action: AgentAction;
      idempotent: boolean;
      workflowId: string;
    };
    expect(body.idempotent).toBe(false);
    expect(body.action.id).toBe(zombieAction.id);
    expect(body.action.result).toMatchObject({
      workflowId: `document-generation/${requestId}-recovered`,
      workflowHint: "document_generation",
    });
    expect(startDocumentGeneration).toHaveBeenCalledTimes(1);
  });
});

function createTestApp(
  repo: AgentActionRepository,
  startDocumentGeneration: (
    params: StartDocumentGenerationParams,
  ) => Promise<{ workflowId: string }>,
) {
  return new Hono<AppEnv>().route(
    "/api",
    createDocumentGenerationRoutes({
      repo,
      canWriteProject: async () => true,
      startDocumentGeneration,
      auth: async (c, next) => {
        c.set("userId", userId);
        c.set("user", { id: userId, email: "user@example.com", name: "User" });
        await next();
      },
    }),
  );
}

function validGenerateAction() {
  return {
    type: "generate_project_object",
    requestId,
    generation: {
      format: "pdf",
      prompt: "Generate a polished project report.",
      locale: "ko",
      template: "report",
      sources: [],
      destination: {
        filename: "project-report.pdf",
        publishAs: "agent_file",
        startIngest: false,
      },
      artifactMode: "object_storage",
    },
  };
}

function createMemoryRepo(seed: AgentAction[] = []): AgentActionRepository {
  const rows = new Map(seed.map((row) => [row.id, row]));
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

function createAgentAction(overrides: Partial<AgentAction> = {}): AgentAction {
  const now = new Date("2026-05-05T00:00:00.000Z").toISOString();
  return {
    id: "00000000-0000-4000-8000-000000000010",
    requestId,
    workspaceId,
    projectId,
    actorUserId: userId,
    sourceRunId: null,
    kind: "file.generate",
    status: "queued",
    risk: "expensive",
    input: {
      type: "generate_project_object",
      generation: validGenerateAction().generation,
    },
    preview: null,
    result: null,
    errorCode: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
