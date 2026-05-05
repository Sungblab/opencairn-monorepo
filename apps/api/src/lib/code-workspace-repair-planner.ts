import type { Client } from "@temporalio/client";
import type { CodeWorkspaceCommandRunLog } from "@opencairn/shared";
import type { CodeRepairPlanner, CodeRepairPlannerInput } from "./agent-actions";
import { getTemporalClient, taskQueue } from "./temporal-client";

const DEFAULT_REPAIR_TIMEOUT_MS = 300_000;

export interface CodeWorkspaceRepairWorkflowPayload {
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
) => Promise<Record<string, unknown>>;

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
      return startWorkflow({
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
    },
  };
}

export async function startCodeWorkspaceRepairWorkflow(
  payload: CodeWorkspaceRepairWorkflowPayload,
  client?: Client,
): Promise<Record<string, unknown>> {
  const temporal = client ?? await getTemporalClient();
  const handle = await temporal.workflow.start("CodeWorkspaceRepairWorkflow", {
    workflowId: workflowIdForCodeWorkspaceRepairAction(
      payload.failedRunActionId,
      payload.requestId,
    ),
    taskQueue: taskQueue(),
    args: [payload],
    workflowExecutionTimeout: DEFAULT_REPAIR_TIMEOUT_MS,
  });
  return handle.result() as Promise<Record<string, unknown>>;
}
