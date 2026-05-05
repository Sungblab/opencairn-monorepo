import type { Client } from "@temporalio/client";
import type { DocumentGenerationRequest } from "@opencairn/shared";
import { taskQueue } from "./temporal-client";

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

function workflowExecutionTimeoutMs(): number {
  const raw = process.env.DOCUMENT_GENERATION_TIMEOUT_MS;
  if (!raw) return TWO_HOURS_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : TWO_HOURS_MS;
}

export const documentGenerationWorkflowIdFor = (requestId: string) =>
  `document-generation/${requestId}`;

export interface StartDocumentGenerationParams {
  actionId: string;
  requestId: string;
  workspaceId: string;
  projectId: string;
  userId: string;
  generation: DocumentGenerationRequest;
}

export async function startDocumentGenerationWorkflow(
  client: Client,
  params: StartDocumentGenerationParams,
): Promise<{ workflowId: string }> {
  const workflowId = documentGenerationWorkflowIdFor(params.requestId);
  await client.workflow.start("DocumentGenerationWorkflow", {
    workflowId,
    taskQueue: taskQueue(),
    args: [
      {
        action_id: params.actionId,
        request_id: params.requestId,
        workspace_id: params.workspaceId,
        project_id: params.projectId,
        user_id: params.userId,
        generation: params.generation,
      },
    ],
    workflowExecutionTimeout: workflowExecutionTimeoutMs(),
  });
  return { workflowId };
}
