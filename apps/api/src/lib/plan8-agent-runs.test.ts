import { describe, expect, it } from "vitest";
import {
  Plan8AgentRunError,
  runPlan8Agent,
  type Plan8AgentName,
  type Plan8AgentRunRepository,
  type Plan8AgentRunServiceOptions,
} from "./plan8-agent-runs";

const userId = "user-1";
const workspaceId = "00000000-0000-4000-8000-000000000001";
const projectId = "00000000-0000-4000-8000-000000000002";
const otherProjectId = "00000000-0000-4000-8000-000000000003";
const noteId = "00000000-0000-4000-8000-000000000004";
const runId = "00000000-0000-4000-8000-000000000005";
const workflowId = "librarian-00000000-0000-4000-8000-000000000006";

type StartWorkflowArgs = Parameters<
  NonNullable<Plan8AgentRunServiceOptions["startWorkflow"]>
>[0];

describe("Plan8 agent run service", () => {
  it("pre-creates a trackable agent run before starting the workflow", async () => {
    const repo = createMemoryRepo();
    const workflows: StartWorkflowArgs[] = [];

    const result = await runPlan8Agent(projectId, userId, { agentName: "librarian" }, {
      repo,
      canWriteProject: async () => true,
      newRunId: () => runId,
      newWorkflowId: () => workflowId,
      startWorkflow: async (args) => {
        workflows.push(args);
      },
    });

    expect(result).toEqual({
      runId,
      workflowId,
      agentName: "librarian",
      status: "running",
    });
    expect(repo.runs).toEqual([
      expect.objectContaining({
        runId,
        workspaceId,
        projectId,
        userId,
        agentName: "librarian",
        workflowId,
        status: "running",
      }),
    ]);
    expect(workflows).toEqual([
      expect.objectContaining({
        workflowType: "LibrarianWorkflow",
        workflowId,
        input: expect.objectContaining({
          project_id: projectId,
          workspace_id: workspaceId,
          user_id: userId,
          workflowId,
        }),
      }),
    ]);
  });

  it("rejects synthesis when a source note is outside the project", async () => {
    const repo = createMemoryRepo({ noteProjectId: otherProjectId });

    await expect(
      runPlan8Agent(projectId, userId, { agentName: "synthesis", noteIds: [noteId] }, {
        repo,
        canWriteProject: async () => true,
        canReadNote: async () => true,
        startWorkflow: async () => {
          throw new Error("unreachable");
        },
      }),
    ).rejects.toMatchObject({
      code: "note_not_found",
      status: 404,
    });
    expect(repo.runs).toHaveLength(0);
  });

  it("marks the pre-created run failed when Temporal start fails", async () => {
    const repo = createMemoryRepo();

    await expect(
      runPlan8Agent(projectId, userId, {
        agentName: "staleness",
        staleDays: 90,
        maxNotes: 20,
        scoreThreshold: 0.5,
      }, {
        repo,
        canReadProject: async () => true,
        newRunId: () => runId,
        newWorkflowId: () => workflowId,
        startWorkflow: async () => {
          throw new Error("Temporal unavailable");
        },
      }),
    ).rejects.toBeInstanceOf(Plan8AgentRunError);

    expect(repo.failures).toEqual([
      {
        runId,
        errorClass: "plan8_agent_start_failed",
        errorMessage: "Temporal unavailable",
      },
    ]);
    expect(repo.runs[0]).toMatchObject({
      runId,
      status: "failed",
      errorClass: "plan8_agent_start_failed",
    });
  });
});

function createMemoryRepo(options?: {
  noteProjectId?: string;
}): Plan8AgentRunRepository & {
  runs: Array<Record<string, unknown>>;
  failures: Array<{ runId: string; errorClass: string; errorMessage: string }>;
} {
  const runs: Array<Record<string, unknown>> = [];
  const failures: Array<{ runId: string; errorClass: string; errorMessage: string }> = [];
  return {
    runs,
    failures,
    async findProjectScope(id) {
      return id === projectId || id === otherProjectId ? { workspaceId } : null;
    },
    async findNoteScope(id) {
      if (id !== noteId) return null;
      return {
        workspaceId,
        projectId: options?.noteProjectId ?? projectId,
      };
    },
    async insertRun(values: {
      runId: string;
      workspaceId: string;
      projectId: string;
      userId: string;
      agentName: Plan8AgentName;
      parentRunId?: string | null;
      workflowId: string;
      status: "running" | "failed";
      trajectoryUri: string;
    }) {
      runs.push({ ...values });
    },
    async markRunFailed(id, errorClass, errorMessage) {
      failures.push({ runId: id, errorClass, errorMessage });
      const run = runs.find((candidate) => candidate.runId === id);
      if (run) {
        run.status = "failed";
        run.errorClass = errorClass;
        run.errorMessage = errorMessage;
      }
    },
  };
}
