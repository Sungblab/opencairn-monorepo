import type { Client } from "@temporalio/client";
import type { CodeWorkspaceCommandRunLog } from "@opencairn/shared";
import type { CodeRepairPlanner, CodeRepairPlannerInput } from "./agent-actions";
import { getTemporalClient, taskQueue } from "./temporal-client";

const DEFAULT_REPAIR_TIMEOUT_MS = 300_000;

export interface CodeWorkspaceRepairWorkflowPayload {
  repairActionId: string;
  requestId: string;
  failedRunActionId: string;
  workspaceId: string;
  projectId: string;
  actorUserId: string;
  codeWorkspaceId: string;
  snapshotId: string;
  command: "lint" | "test" | "build";
  exitCode: number;
  logs: CodeWorkspaceCommandRunLog[];
  manifest: CodeRepairPlannerInput["snapshot"]["manifest"];
}

export type StartCodeWorkspaceRepairWorkflow = (
  payload: CodeWorkspaceRepairWorkflowPayload,
) => Promise<{ workflowId: string }>;

export function workflowIdForCodeWorkspaceRepairAction(
  failedRunActionId: string,
  requestId: string,
): string {
  return `code-workspace-repair-${failedRunActionId}-${requestId}`;
}

export function createTemporalCodeRepairPlanner(options?: {
  startWorkflow?: StartCodeWorkspaceRepairWorkflow;
}): CodeRepairPlanner {
  const startWorkflow = options?.startWorkflow ?? startCodeWorkspaceRepairWorkflow;
  return {
    async plan(input) {
      const started = await startWorkflow({
        repairActionId: input.repairAction.id,
        requestId: input.requestId,
        failedRunActionId: input.failedRunAction.id,
        workspaceId: input.failedRunAction.workspaceId,
        projectId: input.failedRunAction.projectId,
        actorUserId: input.failedRunAction.actorUserId,
        codeWorkspaceId: input.workspace.id,
        snapshotId: input.snapshot.id,
        command: input.runResult.command,
        exitCode: input.runResult.exitCode,
        logs: input.runResult.logs,
        manifest: input.snapshot.manifest,
      });
      return {
        kind: "started",
        workflowId: started.workflowId,
      };
    },
  };
}

export async function startCodeWorkspaceRepairWorkflow(
  payload: CodeWorkspaceRepairWorkflowPayload,
  client?: Client,
): Promise<{ workflowId: string }> {
  const temporal = client ?? await getTemporalClient();
  const workflowId = workflowIdForCodeWorkspaceRepairAction(
    payload.failedRunActionId,
    payload.requestId,
  );
  await temporal.workflow.start("CodeWorkspaceRepairWorkflow", {
    workflowId,
    taskQueue: taskQueue(),
    args: [payload],
    workflowExecutionTimeout: DEFAULT_REPAIR_TIMEOUT_MS,
  });
  return { workflowId };
}
