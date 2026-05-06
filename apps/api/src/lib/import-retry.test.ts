import { describe, expect, it } from "vitest";
import type { AgentAction } from "@opencairn/shared";
import {
  ImportRetryError,
  type ImportRetryRepository,
  retryImportJob,
  safeSourceMetadata,
} from "./import-retry";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const projectId = "00000000-0000-4000-8000-000000000002";
const failedJobId = "00000000-0000-4000-8000-000000000030";
const retryJobId = "00000000-0000-4000-8000-000000000031";
const actionId = "00000000-0000-4000-8000-000000000040";
const userId = "user-1";

describe("import retry service", () => {
  it("creates a retry job, queues an import action, and starts the workflow", async () => {
    const repo = createMemoryImportRetryRepo();
    const started: unknown[] = [];
    const createdActions: unknown[] = [];

    const result = await retryImportJob(failedJobId, userId, {
      repo,
      canWriteWorkspace: async () => true,
      canWriteProject: async () => true,
      newWorkflowId: () => "import-retry-workflow",
      createWorkflowAction: async (args) => {
        createdActions.push(args);
        return {
          action: agentAction({
            id: actionId,
            requestId: args.jobId,
            sourceRunId: args.jobId,
            kind: "import.markdown_zip",
            status: "queued",
            risk: "write",
          }),
          idempotent: false,
        };
      },
      startWorkflow: async (args) => {
        started.push(args);
      },
    });

    expect(result).toEqual({
      jobId: retryJobId,
      action: expect.objectContaining({
        id: actionId,
        kind: "import.markdown_zip",
        status: "queued",
      }),
    });
    expect(repo.inserted).toEqual([
      expect.objectContaining({
        workspaceId,
        userId,
        source: "markdown_zip",
        targetProjectId: projectId,
        workflowId: "import-retry-workflow",
      }),
    ]);
    expect(createdActions).toEqual([
      expect.objectContaining({
        jobId: retryJobId,
        workflowId: "import-retry-workflow",
      }),
    ]);
    expect(started).toEqual([
      expect.objectContaining({
        jobId: retryJobId,
        workflowId: "import-retry-workflow",
        actionId,
      }),
    ]);
  });

  it("rejects retry when the source job is not failed", async () => {
    const repo = createMemoryImportRetryRepo({ status: "running" });

    await expect(
      retryImportJob(failedJobId, userId, {
        repo,
        canWriteWorkspace: async () => true,
        canWriteProject: async () => true,
      }),
    ).rejects.toMatchObject(new ImportRetryError("retry_requires_failed_job", 409));

    expect(repo.inserted).toEqual([]);
  });

  it("uses UI-safe source metadata for queued import actions", () => {
    expect(safeSourceMetadata("markdown_zip", {
      original_name: "vault.zip",
      object_key: "private/object.zip",
    })).toEqual({ originalName: "vault.zip" });
    expect(safeSourceMetadata("google_drive", {
      file_ids: ["a", "b"],
      token: "private",
    })).toEqual({ fileCount: 2 });
  });
});

function createMemoryImportRetryRepo(overrides: Partial<Awaited<ReturnType<ImportRetryRepository["findJobById"]>>> = {}) {
  const inserted: unknown[] = [];
  const repo: ImportRetryRepository & { inserted: unknown[] } = {
    inserted,
    async findJobById(id) {
      if (id !== failedJobId) return null;
      return {
        id: failedJobId,
        workspaceId,
        userId,
        source: "markdown_zip",
        targetProjectId: projectId,
        targetParentNoteId: null,
        workflowId: "import-original",
        status: "failed",
        sourceMetadata: {
          original_name: "vault.zip",
          object_key: "private/object.zip",
        },
        ...overrides,
      };
    },
    async countRunningJobs() {
      return 0;
    },
    async insertRetryJob(values) {
      inserted.push(values);
      return { id: retryJobId };
    },
    async markFailed(jobId, errorSummary) {
      inserted.push({ markFailed: jobId, errorSummary });
    },
  };
  return repo;
}

function agentAction(overrides: Partial<AgentAction> = {}): AgentAction {
  const now = new Date("2026-05-06T00:00:00.000Z").toISOString();
  return {
    id: "00000000-0000-4000-8000-000000000099",
    requestId: "00000000-0000-4000-8000-000000000098",
    workspaceId,
    projectId,
    actorUserId: userId,
    sourceRunId: null,
    kind: "workflow.placeholder",
    status: "completed",
    risk: "low",
    input: {},
    preview: null,
    result: null,
    errorCode: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
