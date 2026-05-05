import type { Client } from "@temporalio/client";
import type { AgentFileSummary, GoogleExportProvider } from "@opencairn/shared";
import { taskQueue } from "./temporal-client";

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

function workflowExecutionTimeoutMs(): number {
  const raw = process.env.GOOGLE_WORKSPACE_EXPORT_TIMEOUT_MS;
  if (!raw) return TWO_HOURS_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : TWO_HOURS_MS;
}

export const googleWorkspaceExportWorkflowIdFor = (requestId: string) =>
  `google-workspace-export/${requestId}`;

export interface StartGoogleWorkspaceExportParams {
  actionId: string;
  requestId: string;
  workspaceId: string;
  projectId: string;
  userId: string;
  provider: GoogleExportProvider;
  format?: string;
  file: AgentFileSummary & { objectKey?: string };
}

export async function startGoogleWorkspaceExportWorkflow(
  client: Client,
  params: StartGoogleWorkspaceExportParams,
): Promise<{ workflowId: string }> {
  const workflowId = googleWorkspaceExportWorkflowIdFor(params.requestId);
  await client.workflow.start("GoogleWorkspaceExportWorkflow", {
    workflowId,
    taskQueue: taskQueue(),
    args: [
      {
        action_id: params.actionId,
        request_id: params.requestId,
        workspace_id: params.workspaceId,
        project_id: params.projectId,
        user_id: params.userId,
        provider: params.provider,
        format: params.format ?? null,
        object: {
          id: params.file.id,
          title: params.file.title,
          filename: params.file.filename,
          kind: params.file.kind,
          mime_type: params.file.mimeType,
          bytes: params.file.bytes,
          object_key: params.file.objectKey ?? null,
        },
      },
    ],
    workflowExecutionTimeout: workflowExecutionTimeoutMs(),
  });
  return { workflowId };
}
