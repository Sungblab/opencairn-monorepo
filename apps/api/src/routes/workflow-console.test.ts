import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { WorkflowConsoleRun } from "@opencairn/shared";
import { createWorkflowConsoleRoutes } from "./workflow-console";
import type { AppEnv } from "../lib/types";
import type { WorkflowConsoleRepository } from "../lib/workflow-console";

const userId = "user-1";
const workspaceId = "00000000-0000-4000-8000-000000000001";
const projectId = "00000000-0000-4000-8000-000000000002";
const otherProjectId = "00000000-0000-4000-8000-000000000099";
const createdAt = "2026-05-05T00:00:00.000Z";
const updatedAt = "2026-05-05T00:01:00.000Z";

describe("workflow console routes", () => {
  it("lists normalized project-scoped runs from multiple sources", async () => {
    const app = createTestApp({
      repo: createMemoryRepo(),
      canReadProject: async () => true,
    });

    const response = await app.request(
      `/api/projects/${projectId}/workflow-console/runs`,
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { runs: WorkflowConsoleRun[] };
    expect(body.runs.map((run) => [run.runType, run.status, run.sourceStatus])).toEqual([
      ["export", "completed", "completed"],
      ["import", "failed", "failed"],
      ["agent_action", "approval_required", "approval_required"],
      ["chat", "running", "running"],
      ["plan8_agent", "blocked", "awaiting_input"],
    ]);
    expect(body.runs.every((run) => run.projectId === projectId)).toBe(true);
  });

  it("filters listed runs by normalized status", async () => {
    const app = createTestApp({
      repo: createMemoryRepo(),
      canReadProject: async () => true,
    });

    const response = await app.request(
      `/api/projects/${projectId}/workflow-console/runs?status=failed`,
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { runs: WorkflowConsoleRun[] };
    expect(body.runs.map((run) => [run.runType, run.status])).toEqual([
      ["import", "failed"],
    ]);
  });

  it("searches listed runs by title and diagnostics", async () => {
    const app = createTestApp({
      repo: createMemoryRepo(),
      canReadProject: async () => true,
    });

    const titleResponse = await app.request(
      `/api/projects/${projectId}/workflow-console/runs?q=google`,
    );
    const errorResponse = await app.request(
      `/api/projects/${projectId}/workflow-console/runs?q=try%20again`,
    );

    expect(titleResponse.status).toBe(200);
    expect((await titleResponse.json() as { runs: WorkflowConsoleRun[] }).runs.map((run) => run.runType)).toEqual([
      "import",
    ]);
    expect(errorResponse.status).toBe(200);
    expect((await errorResponse.json() as { runs: WorkflowConsoleRun[] }).runs.map((run) => run.runType)).toEqual([
      "import",
    ]);
  });

  it("rejects unknown list status filters", async () => {
    const app = createTestApp({
      repo: createMemoryRepo(),
      canReadProject: async () => true,
    });

    const response = await app.request(
      `/api/projects/${projectId}/workflow-console/runs?status=unknown`,
    );

    expect(response.status).toBe(400);
  });

  it("returns one normalized run by prefixed run id", async () => {
    const app = createTestApp({
      repo: createMemoryRepo(),
      canReadProject: async () => true,
    });

    const response = await app.request(
      `/api/projects/${projectId}/workflow-console/runs/chat:00000000-0000-4000-8000-000000000010`,
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { run: WorkflowConsoleRun };
    expect(body.run).toMatchObject({
      runId: "chat:00000000-0000-4000-8000-000000000010",
      runType: "chat",
      status: "running",
      threadId: "00000000-0000-4000-8000-000000000011",
    });
  });

  it("returns import and export runs by prefixed run id", async () => {
    const app = createTestApp({
      repo: createMemoryRepo(),
      canReadProject: async () => true,
    });

    const importResponse = await app.request(
      `/api/projects/${projectId}/workflow-console/runs/import:00000000-0000-4000-8000-000000000050`,
    );
    const exportResponse = await app.request(
      `/api/projects/${projectId}/workflow-console/runs/export:00000000-0000-4000-8000-000000000060`,
    );

    expect(importResponse.status).toBe(200);
    expect((await importResponse.json() as { run: WorkflowConsoleRun }).run).toMatchObject({
      runType: "import",
      status: "failed",
      outputs: [{ outputType: "import", label: "vault.zip" }],
    });
    expect(exportResponse.status).toBe(200);
    expect((await exportResponse.json() as { run: WorkflowConsoleRun }).run).toMatchObject({
      runType: "export",
      status: "completed",
      outputs: [{ outputType: "export", label: "pdf export" }],
    });
  });

  it("hides runs from another project even when the prefixed id is valid", async () => {
    const app = createTestApp({
      repo: createMemoryRepo(),
      canReadProject: async () => true,
    });

    const response = await app.request(
      `/api/projects/${projectId}/workflow-console/runs/chat:00000000-0000-4000-8000-000000000090`,
    );

    expect(response.status).toBe(404);
  });

  it("requires project read permission before listing runs", async () => {
    const app = createTestApp({
      repo: createMemoryRepo(),
      canReadProject: async () => false,
    });

    const response = await app.request(
      `/api/projects/${projectId}/workflow-console/runs`,
    );

    expect(response.status).toBe(403);
  });
});

function createTestApp(options: {
  repo: WorkflowConsoleRepository;
  canReadProject: (actorUserId: string, id: string) => Promise<boolean>;
}) {
  return new Hono<AppEnv>().route(
    "/api",
    createWorkflowConsoleRoutes({
      repo: options.repo,
      canReadProject: options.canReadProject,
      auth: async (c, next) => {
        c.set("userId", userId);
        c.set("user", { id: userId, email: "user@example.com", name: "User" });
        await next();
      },
    }),
  );
}

function createMemoryRepo(): WorkflowConsoleRepository {
  return {
    async findProjectScope(id) {
      return id === projectId || id === otherProjectId ? { workspaceId } : null;
    },
    async listChatRunsByProject({ projectId: pid }) {
      return [
        {
          id: "00000000-0000-4000-8000-000000000010",
          threadId: "00000000-0000-4000-8000-000000000011",
          userMessageId: "00000000-0000-4000-8000-000000000012",
          agentMessageId: "00000000-0000-4000-8000-000000000013",
          workspaceId,
          projectId: pid,
          userId,
          workflowId: "chat-run-00000000-0000-4000-8000-000000000010",
          status: "running",
          mode: "auto",
          createdAt,
          updatedAt,
          completedAt: null,
        },
      ];
    },
    async listAgentActionsByProject() {
      return [
        {
          id: "00000000-0000-4000-8000-000000000020",
          requestId: "00000000-0000-4000-8000-000000000021",
          workspaceId,
          projectId,
          actorUserId: userId,
          sourceRunId: null,
          kind: "note.update",
          status: "approval_required",
          risk: "write",
          input: {},
          preview: {},
          result: null,
          errorCode: null,
          createdAt,
          updatedAt,
        },
      ];
    },
    async listPlan8RunsByProject() {
      return [
        {
          runId: "00000000-0000-4000-8000-000000000030",
          workspaceId,
          projectId,
          userId,
          agentName: "librarian",
          workflowId: "plan8-librarian/00000000-0000-4000-8000-000000000030",
          status: "awaiting_input",
          startedAt: createdAt,
          endedAt: null,
          totalCostKrw: 12,
          errorMessage: null,
        },
      ];
    },
    async listImportJobsByProject() {
      return [
        {
          id: "00000000-0000-4000-8000-000000000050",
          workspaceId,
          projectId,
          userId,
          source: "google_drive",
          workflowId: "import/00000000-0000-4000-8000-000000000050",
          status: "failed",
          totalItems: 10,
          completedItems: 6,
          failedItems: 2,
          sourceMetadata: { filename: "vault.zip" },
          errorSummary: "Import could not be started. Please try again.",
          createdAt,
          updatedAt,
          completedAt: updatedAt,
        },
      ];
    },
    async listSynthesisExportRunsByProject() {
      return [
        {
          runId: "00000000-0000-4000-8000-000000000060",
          workspaceId,
          projectId,
          userId,
          workflowId: "synthesis-export/00000000-0000-4000-8000-000000000060",
          status: "completed",
          format: "pdf",
          template: "report",
          userPrompt: "Generate an implementation report",
          tokensUsed: 1200,
          createdAt,
          updatedAt,
          documents: [
            {
              id: "00000000-0000-4000-8000-000000000061",
              format: "pdf",
              bytes: 4096,
              url: "/api/synthesis-export/runs/00000000-0000-4000-8000-000000000060/document",
            },
          ],
        },
      ];
    },
    async getChatRunById({ runId, projectId: pid }) {
      if (runId === "00000000-0000-4000-8000-000000000090") {
        return {
          id: runId,
          threadId: "00000000-0000-4000-8000-000000000091",
          userMessageId: "00000000-0000-4000-8000-000000000092",
          agentMessageId: "00000000-0000-4000-8000-000000000093",
          workspaceId,
          projectId: otherProjectId,
          userId,
          workflowId: `chat-run-${runId}`,
          status: "complete",
          mode: "auto",
          createdAt,
          updatedAt,
          completedAt: updatedAt,
        };
      }
      return (await this.listChatRunsByProject({ projectId: pid, userId, limit: 10 }))
        .find((run) => run.id === runId) ?? null;
    },
    async getAgentActionById({ actionId, projectId: pid }) {
      return (await this.listAgentActionsByProject({ projectId: pid, userId, limit: 10 }))
        .find((action) => action.id === actionId) ?? null;
    },
    async getPlan8RunById({ runId, projectId: pid }) {
      return (await this.listPlan8RunsByProject({ projectId: pid, userId, limit: 10 }))
        .find((run) => run.runId === runId) ?? null;
    },
    async getImportJobById({ jobId, projectId: pid }) {
      return (await this.listImportJobsByProject({ projectId: pid, userId, limit: 10 }))
        .find((job) => job.id === jobId) ?? null;
    },
    async getSynthesisExportRunById({ runId, projectId: pid }) {
      return (await this.listSynthesisExportRunsByProject({ projectId: pid, userId, limit: 10 }))
        .find((run) => run.runId === runId) ?? null;
    },
  };
}
