import type {
  CodeWorkspaceCommandRunResult,
} from "@opencairn/shared";
import type { Client } from "@temporalio/client";
import type { CodeCommandRunner, CodeCommandRunnerInput } from "./agent-actions";
import { getTemporalClient, taskQueue } from "./temporal-client";

const DEFAULT_TIMEOUT_BUFFER_MS = 30_000;

export interface CodeWorkspaceCommandWorkflowPayload {
  actionId: string;
  requestId: string;
  workspaceId: string;
  projectId: string;
  actorUserId: string;
  codeWorkspaceId: string;
  snapshotId: string;
  command: "lint" | "test" | "build";
  timeoutMs: number;
  manifest: CodeCommandRunnerInput["snapshot"]["manifest"];
}

export type StartCodeWorkspaceCommandWorkflow = (
  payload: CodeWorkspaceCommandWorkflowPayload,
) => Promise<CodeWorkspaceCommandRunResult>;

export function workflowIdForCodeWorkspaceCommandAction(actionId: string): string {
  return `code-workspace-command-${actionId}`;
}

export function createTemporalCodeCommandRunner(options?: {
  startWorkflow?: StartCodeWorkspaceCommandWorkflow;
}): CodeCommandRunner {
  const startWorkflow = options?.startWorkflow ?? startCodeWorkspaceCommandWorkflow;
  return {
    async run(input) {
      return startWorkflow({
        actionId: input.action.id,
        requestId: input.action.requestId,
        workspaceId: input.action.workspaceId,
        projectId: input.action.projectId,
        actorUserId: input.action.actorUserId,
        codeWorkspaceId: input.workspace.id,
        snapshotId: input.snapshot.id,
        command: input.request.command,
        timeoutMs: input.request.timeoutMs,
        manifest: input.snapshot.manifest,
      });
    },
  };
}

export async function startCodeWorkspaceCommandWorkflow(
  payload: CodeWorkspaceCommandWorkflowPayload,
  client?: Client,
): Promise<CodeWorkspaceCommandRunResult> {
  const temporal = client ?? await getTemporalClient();
  const handle = await temporal.workflow.start("CodeWorkspaceCommandWorkflow", {
    workflowId: workflowIdForCodeWorkspaceCommandAction(payload.actionId),
    taskQueue: taskQueue(),
    args: [payload],
    workflowExecutionTimeout: payload.timeoutMs + DEFAULT_TIMEOUT_BUFFER_MS,
  });
  return handle.result() as Promise<CodeWorkspaceCommandRunResult>;
}

export async function cancelCodeWorkspaceCommandWorkflow(
  actionId: string,
  client?: Client,
): Promise<void> {
  const temporal = client ?? await getTemporalClient();
  await temporal.workflow
    .getHandle(workflowIdForCodeWorkspaceCommandAction(actionId))
    .cancel();
}
