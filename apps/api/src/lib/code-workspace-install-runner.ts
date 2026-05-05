import type {
  CodeWorkspaceInstallResult,
} from "@opencairn/shared";
import type { Client } from "@temporalio/client";
import type { CodeInstallRunner, CodeInstallRunnerInput } from "./agent-actions";
import { getTemporalClient, taskQueue } from "./temporal-client";

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_TIMEOUT_BUFFER_MS = 30_000;

export interface CodeWorkspaceInstallWorkflowPayload {
  actionId: string;
  requestId: string;
  workspaceId: string;
  projectId: string;
  actorUserId: string;
  codeWorkspaceId: string;
  snapshotId: string;
  packageManager: "pnpm" | "npm" | "yarn";
  packages: CodeInstallRunnerInput["request"]["packages"];
  timeoutMs: number;
  manifest: CodeInstallRunnerInput["snapshot"]["manifest"];
}

export type StartCodeWorkspaceInstallWorkflow = (
  payload: CodeWorkspaceInstallWorkflowPayload,
) => Promise<CodeWorkspaceInstallResult>;

export function workflowIdForCodeWorkspaceInstallAction(actionId: string): string {
  return `code-workspace-install-${actionId}`;
}

export function createTemporalCodeInstallRunner(options?: {
  startWorkflow?: StartCodeWorkspaceInstallWorkflow;
}): CodeInstallRunner {
  const startWorkflow = options?.startWorkflow ?? startCodeWorkspaceInstallWorkflow;
  return {
    async install(input) {
      return startWorkflow({
        actionId: input.action.id,
        requestId: input.action.requestId,
        workspaceId: input.action.workspaceId,
        projectId: input.action.projectId,
        actorUserId: input.action.actorUserId,
        codeWorkspaceId: input.workspace.id,
        snapshotId: input.snapshot.id,
        packageManager: input.request.packageManager,
        packages: input.request.packages,
        timeoutMs: timeoutMs(input.request),
        manifest: input.snapshot.manifest,
      });
    },
  };
}

export async function startCodeWorkspaceInstallWorkflow(
  payload: CodeWorkspaceInstallWorkflowPayload,
  client?: Client,
): Promise<CodeWorkspaceInstallResult> {
  const temporal = client ?? await getTemporalClient();
  const handle = await temporal.workflow.start("CodeWorkspaceInstallWorkflow", {
    workflowId: workflowIdForCodeWorkspaceInstallAction(payload.actionId),
    taskQueue: taskQueue(),
    args: [payload],
    workflowExecutionTimeout: payload.timeoutMs + DEFAULT_TIMEOUT_BUFFER_MS,
  });
  return handle.result() as Promise<CodeWorkspaceInstallResult>;
}

function timeoutMs(request: CodeInstallRunnerInput["request"]): number {
  const value = (request as { timeoutMs?: unknown }).timeoutMs;
  return typeof value === "number" ? value : DEFAULT_TIMEOUT_MS;
}
