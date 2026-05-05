import { randomUUID } from "node:crypto";
import {
  and,
  db,
  eq,
  userIntegrations,
} from "@opencairn/db";
import type {
  AgentAction,
  AgentFileKind,
  GoogleExportProvider,
  ProjectObjectAction,
  ProjectObjectActionEvent,
} from "@opencairn/shared";
import {
  AgentActionError,
  createDrizzleAgentActionRepository,
  type AgentActionRepository,
} from "./agent-actions";
import {
  getAgentFileForRead,
  toSummary,
  type AgentFileRecord,
} from "./agent-files";
import { canWrite } from "./permissions";
import { getTemporalClient } from "./temporal-client";
import {
  startGoogleWorkspaceExportWorkflow,
  type StartGoogleWorkspaceExportParams,
} from "./google-workspace-export-client";

type ExportProjectObjectAction = Extract<
  ProjectObjectAction,
  { type: "export_project_object" }
>;
type ExportFormat = NonNullable<ExportProjectObjectAction["format"]>;

const GOOGLE_EXPORT_PROVIDERS = new Set<GoogleExportProvider>([
  "google_drive",
  "google_docs",
  "google_sheets",
  "google_slides",
]);
const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export interface GoogleWorkspaceGrant {
  accountEmail: string | null;
  scopes: string[];
}

export interface GoogleWorkspaceExportActionServiceOptions {
  repo?: AgentActionRepository;
  canWriteProject?: (userId: string, projectId: string) => Promise<boolean>;
  getAgentFile?: (objectId: string, userId: string) => Promise<AgentFileRecord>;
  findGrant?: (userId: string, workspaceId: string) => Promise<GoogleWorkspaceGrant | null>;
  startGoogleWorkspaceExport?: (
    params: StartGoogleWorkspaceExportParams,
  ) => Promise<{ workflowId: string }>;
}

export interface RequestGoogleWorkspaceExportResult {
  action: AgentAction;
  event: ProjectObjectActionEvent;
  idempotent: boolean;
  workflowId?: string;
}

export async function requestGoogleWorkspaceExportProjectObject(
  projectId: string,
  actorUserId: string,
  request: ExportProjectObjectAction,
  options?: GoogleWorkspaceExportActionServiceOptions,
): Promise<RequestGoogleWorkspaceExportResult> {
  const provider = asGoogleExportProvider(request.provider);
  if (!provider) throw new AgentActionError("unsupported_export_provider", 409);
  if (!options?.startGoogleWorkspaceExport && !googleWorkspaceExportFeatureEnabled()) {
    throw new AgentActionError("google_workspace_export_not_configured", 409);
  }

  const repo = options?.repo ?? createDrizzleAgentActionRepository();
  const scope = await repo.findProjectScope(projectId);
  if (!scope) throw new AgentActionError("project_not_found", 404);

  const canWriteProject =
    options?.canWriteProject ?? ((userId, id) => canWrite(userId, { type: "project", id }));
  if (!(await canWriteProject(actorUserId, projectId))) {
    throw new AgentActionError("forbidden", 403);
  }

  const getFile = options?.getAgentFile ?? getAgentFileForRead;
  const file = await getFile(request.objectId, actorUserId);
  if (file.workspaceId !== scope.workspaceId || file.projectId !== projectId) {
    throw new AgentActionError("project_object_context_mismatch", 409);
  }
  assertProviderCompatibility(provider, file.kind as AgentFileKind);

  const grant = await (options?.findGrant ?? findUserIntegrationGoogleWorkspaceGrant)(
    actorUserId,
    scope.workspaceId,
  );
  if (!grant) throw new AgentActionError("google_workspace_grant_required", 409);
  assertDriveFileScope(grant.scopes);

  const requestId = request.requestId ?? randomUUID();
  const event = exportRequestedEvent(requestId, request.objectId, provider, request.format);
  const existing = await repo.findByRequestId(projectId, actorUserId, requestId);
  if (existing) {
    if (canRestartExistingExport(existing)) {
      return startExportForAction({
        action: existing,
        requestId,
        workspaceId: scope.workspaceId,
        projectId,
        actorUserId,
        provider,
        format: request.format,
        file,
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
    kind: "file.export",
    status: "queued",
    risk: "external",
    input: {
      type: request.type,
      objectId: request.objectId,
      provider,
      ...(request.format !== undefined ? { format: request.format } : {}),
    },
    preview: { event },
    result: null,
    errorCode: null,
  });
  if (!inserted) {
    if (canRestartExistingExport(action)) {
      return startExportForAction({
        action,
        requestId,
        workspaceId: scope.workspaceId,
        projectId,
        actorUserId,
        provider,
        format: request.format,
        file,
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

  return startExportForAction({
    action,
    requestId,
    workspaceId: scope.workspaceId,
    projectId,
    actorUserId,
    provider,
    format: request.format,
    file,
    event,
    repo,
    options,
  });
}

async function startExportForAction(input: {
  action: AgentAction;
  requestId: string;
  workspaceId: string;
  projectId: string;
  actorUserId: string;
  provider: GoogleExportProvider;
  format?: ExportFormat;
  file: AgentFileRecord;
  event: ProjectObjectActionEvent;
  repo: AgentActionRepository;
  options?: GoogleWorkspaceExportActionServiceOptions;
}): Promise<RequestGoogleWorkspaceExportResult> {
  const start =
    input.options?.startGoogleWorkspaceExport ?? startGoogleWorkspaceExportWithClient;
  try {
    const { workflowId } = await start({
      actionId: input.action.id,
      requestId: input.requestId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      userId: input.actorUserId,
      provider: input.provider,
      ...(input.format !== undefined ? { format: input.format } : {}),
      file: {
        ...toSummary(input.file),
        objectKey: input.file.objectKey,
      },
    });
    const updated = await input.repo.updateStatus(input.action.id, {
      status: "queued",
      result: {
        workflowId,
        workflowHint: "google_workspace_export",
      },
      errorCode: null,
    });
    if (!updated) throw new AgentActionError("action_not_found", 404);
    return {
      action: updated,
      event: input.event,
      idempotent: false,
      workflowId,
    };
  } catch (err) {
    await input.repo.updateStatus(input.action.id, {
      status: "failed",
      result: {
        ok: false,
        requestId: input.requestId,
        objectId: input.file.id,
        provider: input.provider,
        exportStatus: "failed",
        errorCode: "google_workspace_export_start_failed",
        retryable: true,
      },
      errorCode: "google_workspace_export_start_failed",
    });
    throw err;
  }
}

async function startGoogleWorkspaceExportWithClient(
  params: StartGoogleWorkspaceExportParams,
): Promise<{ workflowId: string }> {
  const client = await getTemporalClient();
  return startGoogleWorkspaceExportWorkflow(client, params);
}

function asGoogleExportProvider(provider: string): GoogleExportProvider | null {
  return GOOGLE_EXPORT_PROVIDERS.has(provider as GoogleExportProvider)
    ? provider as GoogleExportProvider
    : null;
}

function assertProviderCompatibility(provider: GoogleExportProvider, kind: AgentFileKind): void {
  if (provider === "google_drive") return;
  const expected: Record<Exclude<GoogleExportProvider, "google_drive">, AgentFileKind> = {
    google_docs: "docx",
    google_sheets: "xlsx",
    google_slides: "pptx",
  };
  if (kind !== expected[provider]) {
    throw new AgentActionError("google_export_incompatible_file_type", 409);
  }
}

function assertDriveFileScope(scopes: string[]): void {
  if (
    scopes.includes(DRIVE_FILE_SCOPE) ||
    scopes.includes("drive.file")
  ) {
    return;
  }
  throw new AgentActionError("google_drive_file_scope_required", 409);
}

function exportRequestedEvent(
  requestId: string,
  objectId: string,
  provider: GoogleExportProvider,
  format?: ExportFormat,
): ProjectObjectActionEvent {
  return {
    type: "project_object_export_requested",
    requestId,
    objectId,
    provider,
    ...(format !== undefined ? { format } : {}),
    workflowHint: "google_workspace_export",
  };
}

function workflowIdFromAction(action: AgentAction): string | undefined {
  const workflowId = action.result?.workflowId;
  return typeof workflowId === "string" ? workflowId : undefined;
}

function canRestartExistingExport(action: AgentAction): boolean {
  if (action.kind !== "file.export") return false;
  const workflowId = workflowIdFromAction(action);
  if (action.status === "queued" && !workflowId) return true;
  if (action.status !== "failed") return false;
  return action.result?.ok === false && action.result.retryable === true;
}

async function findUserIntegrationGoogleWorkspaceGrant(
  userId: string,
  workspaceId: string,
): Promise<GoogleWorkspaceGrant | null> {
  const [row] = await db
    .select({
      accountEmail: userIntegrations.accountEmail,
      scopes: userIntegrations.scopes,
    })
    .from(userIntegrations)
    .where(
      and(
        eq(userIntegrations.userId, userId),
        eq(userIntegrations.workspaceId, workspaceId),
        eq(userIntegrations.provider, "google_drive"),
      ),
    )
    .limit(1);
  return row ?? null;
}

function googleWorkspaceExportFeatureEnabled(): boolean {
  return (process.env.FEATURE_GOOGLE_WORKSPACE_EXPORT ?? "false").toLowerCase() === "true";
}
