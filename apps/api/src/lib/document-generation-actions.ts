import { randomUUID } from "node:crypto";
import type {
  AgentAction,
  ProjectObjectActionEvent,
  ProjectObjectAction,
} from "@opencairn/shared";
import {
  AgentActionError,
  createDrizzleAgentActionRepository,
  type AgentActionRepository,
} from "./agent-actions";
import { canWrite } from "./permissions";
import { getTemporalClient } from "./temporal-client";
import {
  startDocumentGenerationWorkflow,
  type StartDocumentGenerationParams,
} from "./document-generation-client";

type GenerateProjectObjectAction = Extract<
  ProjectObjectAction,
  { type: "generate_project_object" }
>;

export interface DocumentGenerationActionServiceOptions {
  repo?: AgentActionRepository;
  canWriteProject?: (userId: string, projectId: string) => Promise<boolean>;
  startDocumentGeneration?: (
    params: StartDocumentGenerationParams,
  ) => Promise<{ workflowId: string }>;
}

export interface RequestDocumentGenerationResult {
  action: AgentAction;
  event: ProjectObjectActionEvent;
  idempotent: boolean;
  workflowId?: string;
}

export async function requestDocumentGenerationProjectObject(
  projectId: string,
  actorUserId: string,
  request: GenerateProjectObjectAction,
  options?: DocumentGenerationActionServiceOptions,
): Promise<RequestDocumentGenerationResult> {
  const repo = options?.repo ?? createDrizzleAgentActionRepository();
  const scope = await repo.findProjectScope(projectId);
  if (!scope) throw new AgentActionError("project_not_found", 404);

  const canWriteProject =
    options?.canWriteProject ?? ((userId, id) => canWrite(userId, { type: "project", id }));
  if (!(await canWriteProject(actorUserId, projectId))) {
    throw new AgentActionError("forbidden", 403);
  }

  const requestId = request.requestId ?? randomUUID();
  const event = generationRequestedEvent(requestId, request);
  const existing = await repo.findByRequestId(projectId, actorUserId, requestId);
  if (existing) {
    if (canRestartExistingGeneration(existing)) {
      return startDocumentGenerationForAction({
        action: existing,
        requestId,
        workspaceId: scope.workspaceId,
        projectId,
        actorUserId,
        request,
        event,
        repo,
        options,
      });
    }
    return {
      action: existing,
      event,
      idempotent: true,
      workflowId: workflowIdFromAction(existing),
    };
  }

  const { action, inserted } = await repo.insert({
    requestId,
    workspaceId: scope.workspaceId,
    projectId,
    actorUserId,
    kind: "file.generate",
    status: "queued",
    risk: "expensive",
    input: {
      type: request.type,
      generation: request.generation,
    },
    preview: {
      event,
    },
    result: null,
    errorCode: null,
  });
  if (!inserted) {
    if (canRestartExistingGeneration(action)) {
      return startDocumentGenerationForAction({
        action,
        requestId,
        workspaceId: scope.workspaceId,
        projectId,
        actorUserId,
        request,
        event,
        repo,
        options,
      });
    }
    return {
      action,
      event,
      idempotent: true,
      workflowId: workflowIdFromAction(action),
    };
  }

  return startDocumentGenerationForAction({
    action,
    requestId,
    workspaceId: scope.workspaceId,
    projectId,
    actorUserId,
    request,
    event,
    repo,
    options,
  });
}

async function startDocumentGenerationForAction(input: {
  action: AgentAction;
  requestId: string;
  workspaceId: string;
  projectId: string;
  actorUserId: string;
  request: GenerateProjectObjectAction;
  event: ProjectObjectActionEvent;
  repo: AgentActionRepository;
  options?: DocumentGenerationActionServiceOptions;
}): Promise<RequestDocumentGenerationResult> {
  const {
    action,
    requestId,
    workspaceId,
    projectId,
    actorUserId,
    request,
    event,
    repo,
    options,
  } = input;
  try {
    const start = options?.startDocumentGeneration ?? startDocumentGenerationWithClient;
    const { workflowId } = await start({
      actionId: action.id,
      requestId,
      workspaceId,
      projectId,
      userId: actorUserId,
      generation: request.generation,
    });
    const updated = await repo.updateStatus(action.id, {
      status: "queued",
      result: {
        workflowId,
        workflowHint: "document_generation",
      },
      errorCode: null,
    });
    if (!updated) throw new AgentActionError("action_not_found", 404);
    return {
      action: updated,
      event,
      idempotent: false,
      workflowId,
    };
  } catch (err) {
    await repo.updateStatus(action.id, {
      status: "failed",
      result: {
        ok: false,
        requestId,
        errorCode: "document_generation_start_failed",
        retryable: true,
      },
      errorCode: "document_generation_start_failed",
    });
    throw err;
  }
}

function generationRequestedEvent(
  requestId: string,
  request: GenerateProjectObjectAction,
): ProjectObjectActionEvent {
  return {
    type: "project_object_generation_requested",
    requestId,
    generation: request.generation,
    workflowHint: "document_generation",
  };
}

async function startDocumentGenerationWithClient(
  params: StartDocumentGenerationParams,
): Promise<{ workflowId: string }> {
  const client = await getTemporalClient();
  return startDocumentGenerationWorkflow(client, params);
}

function workflowIdFromAction(action: AgentAction): string | undefined {
  const workflowId = action.result?.workflowId;
  return typeof workflowId === "string" ? workflowId : undefined;
}

function canRestartExistingGeneration(action: AgentAction): boolean {
  if (action.kind !== "file.generate") return false;
  const workflowId = workflowIdFromAction(action);
  if (action.status === "queued" && !workflowId) return true;
  if (action.status !== "failed") return false;
  return isRetryableGenerationFailure(action.result);
}

function isRetryableGenerationFailure(result: Record<string, unknown> | null): boolean {
  if (!result) return false;
  return result.ok === false && result.retryable === true;
}
