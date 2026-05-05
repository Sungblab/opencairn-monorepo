import { z } from "zod";
import {
  agentActionRiskSchema,
  agentActionEventSchema,
  agentActionSchema,
  type AgentAction,
  type AgentActionEvent,
} from "./agent-actions";
import {
  projectObjectActionEventSchema,
  type ProjectObjectActionEvent,
} from "./project-object-actions";

export const workflowConsoleStatusSchema = z.enum([
  "draft",
  "approval_required",
  "queued",
  "running",
  "blocked",
  "completed",
  "failed",
  "cancelled",
  "reverted",
]);

export const workflowConsoleRunTypeSchema = z.enum([
  "chat",
  "agent_action",
  "plan8_agent",
  "document_generation",
  "import",
  "export",
  "code_agent",
  "system_workflow",
]);

export const workflowConsoleOutputTypeSchema = z.enum([
  "note",
  "agent_file",
  "import",
  "export",
  "code_project",
  "log",
  "preview",
  "provider_url",
]);

export const workflowConsoleApprovalStatusSchema = z.enum([
  "requested",
  "accepted",
  "rejected",
  "expired",
  "superseded",
]);

export const workflowConsoleEventTypeSchema = z.enum([
  "run.created",
  "run.status_changed",
  "run.progress",
  "run.thought",
  "run.output_added",
  "run.approval_requested",
  "run.approval_resolved",
  "run.error",
  "run.log_appended",
]);

export const workflowConsoleOutputSchema = z
  .object({
    outputType: workflowConsoleOutputTypeSchema,
    id: z.string().min(1),
    label: z.string().min(1),
    url: z.string().min(1).optional(),
    mimeType: z.string().min(1).optional(),
    bytes: z.number().int().nonnegative().optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

export const workflowConsoleApprovalSchema = z
  .object({
    approvalId: z.string().min(1),
    status: workflowConsoleApprovalStatusSchema,
    risk: agentActionRiskSchema,
    requestedAt: z.string().datetime().optional(),
    resolvedAt: z.string().datetime().nullable().optional(),
    summary: z.string().min(1).optional(),
  })
  .strict();

export const workflowConsoleErrorSchema = z
  .object({
    code: z.string().min(1),
    retryable: z.boolean(),
    message: z.string().min(1).optional(),
    diagnostics: z.record(z.unknown()).optional(),
  })
  .strict();

export const workflowConsoleCostSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    cachedTokens: z.number().int().nonnegative().optional(),
    provider: z.string().min(1).optional(),
    wallClockMs: z.number().int().nonnegative().optional(),
    krw: z.number().int().nonnegative().optional(),
  })
  .strict();

export const workflowConsoleProgressSchema = z
  .object({
    step: z.string().min(1).optional(),
    current: z.number().int().nonnegative().optional(),
    total: z.number().int().positive().optional(),
    percent: z.number().min(0).max(100).optional(),
  })
  .strict();

export const workflowConsoleRunSchema = z
  .object({
    runId: z.string().min(1),
    runType: workflowConsoleRunTypeSchema,
    sourceId: z.string().min(1),
    sourceStatus: z.string().min(1).optional(),
    workspaceId: z.string().min(1),
    projectId: z.string().min(1).nullable().optional(),
    threadId: z.string().min(1).nullable().optional(),
    messageId: z.string().min(1).nullable().optional(),
    actorUserId: z.string().min(1).nullable().optional(),
    title: z.string().min(1),
    status: workflowConsoleStatusSchema,
    risk: agentActionRiskSchema,
    progress: workflowConsoleProgressSchema.nullable().optional(),
    cost: workflowConsoleCostSchema.nullable().optional(),
    outputs: z.array(workflowConsoleOutputSchema).default([]),
    approvals: z.array(workflowConsoleApprovalSchema).default([]),
    error: workflowConsoleErrorSchema.nullable().optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable().optional(),
  })
  .strict();

export const workflowConsoleEventSchema = z
  .object({
    runId: z.string().min(1),
    seq: z.number().int().nonnegative().optional(),
    eventType: workflowConsoleEventTypeSchema,
    sourceEventType: z.string().min(1).optional(),
    sourceStatus: z.string().min(1).optional(),
    status: workflowConsoleStatusSchema.optional(),
    output: workflowConsoleOutputSchema.optional(),
    approval: workflowConsoleApprovalSchema.optional(),
    error: workflowConsoleErrorSchema.optional(),
    payload: z.record(z.unknown()).optional(),
    createdAt: z.string().datetime().optional(),
  })
  .strict();

export type WorkflowConsoleStatus = z.infer<typeof workflowConsoleStatusSchema>;
export type WorkflowConsoleRunType = z.infer<typeof workflowConsoleRunTypeSchema>;
export type WorkflowConsoleRun = z.infer<typeof workflowConsoleRunSchema>;
export type WorkflowConsoleEvent = z.infer<typeof workflowConsoleEventSchema>;
export type WorkflowConsoleOutput = z.infer<typeof workflowConsoleOutputSchema>;

export type ChatRunProjectionSource = {
  id: string;
  threadId: string;
  userMessageId?: string | null;
  agentMessageId?: string | null;
  workspaceId: string;
  projectId?: string | null;
  userId: string;
  workflowId?: string | null;
  status: string;
  mode?: string | null;
  error?: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
  completedAt?: Date | string | null;
};

export type Plan8AgentRunProjectionSource = {
  runId: string;
  workspaceId: string;
  projectId?: string | null;
  userId: string;
  agentName: string;
  workflowId: string;
  status: string;
  startedAt: Date | string;
  endedAt?: Date | string | null;
  totalCostKrw?: number | null;
  errorMessage?: string | null;
};

export type ImportJobProjectionSource = {
  id: string;
  workspaceId: string;
  projectId: string;
  userId: string;
  source: string;
  workflowId: string;
  status: string;
  totalItems: number;
  completedItems: number;
  failedItems: number;
  sourceMetadata?: Record<string, unknown> | null;
  errorSummary?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  completedAt?: Date | string | null;
};

export type SynthesisExportDocumentProjectionSource = {
  id: string;
  format: string;
  bytes?: number | null;
  url?: string;
};

export type SynthesisExportRunProjectionSource = {
  runId: string;
  workspaceId: string;
  projectId: string;
  userId: string;
  workflowId?: string | null;
  status: string;
  format: string;
  template: string;
  userPrompt: string;
  tokensUsed?: number | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  documents?: SynthesisExportDocumentProjectionSource[];
};

export type ChatRunEventProjectionSource = {
  runId: string;
  seq: number;
  event: string;
  payload: Record<string, unknown>;
  createdAt?: Date | string;
};

export function workflowConsoleRunFromChatRun(
  run: ChatRunProjectionSource,
): WorkflowConsoleRun {
  const normalizedStatus = normalizeChatStatus(run.status);
  return workflowConsoleRunSchema.parse({
    runId: prefixedRunId("chat", run.id),
    runType: "chat",
    sourceId: run.id,
    sourceStatus: run.status,
    workspaceId: run.workspaceId,
    projectId: run.projectId ?? null,
    threadId: run.threadId,
    messageId: run.agentMessageId ?? run.userMessageId ?? null,
    actorUserId: run.userId,
    title: "Chat run",
    status: normalizedStatus,
    risk: "low",
    outputs: [],
    approvals: [],
    error: normalizedStatus === "failed" ? errorFromUnknown(run.error, "chat_run_failed") : null,
    createdAt: toIso(run.createdAt),
    updatedAt: toIso(run.updatedAt),
    completedAt: toIsoOrNull(run.completedAt),
  });
}

export function chatConsoleEventFromChatRunEvent(
  event: ChatRunEventProjectionSource,
): WorkflowConsoleEvent {
  return workflowConsoleEventSchema.parse({
    runId: prefixedRunId("chat", event.runId),
    seq: event.seq,
    eventType: consoleEventTypeFromChatEvent(event.event),
    sourceEventType: event.event,
    sourceStatus: sourceStatusFromChatEvent(event),
    status: statusFromChatDoneEvent(event),
    payload: event.payload,
    createdAt: event.createdAt ? toIso(event.createdAt) : undefined,
  });
}

export function workflowConsoleRunFromAgentAction(action: AgentAction): WorkflowConsoleRun {
  const parsed = agentActionSchema.parse(action);
  const status = normalizeAgentActionStatus(parsed.status);
  return workflowConsoleRunSchema.parse({
    runId: prefixedRunId("agent_action", parsed.id),
    runType: "agent_action",
    sourceId: parsed.id,
    sourceStatus: parsed.status,
    workspaceId: parsed.workspaceId,
    projectId: parsed.projectId,
    actorUserId: parsed.actorUserId,
    title: parsed.kind,
    status,
    risk: parsed.risk,
    outputs: outputsFromAgentAction(parsed),
    approvals: approvalFromAgentAction(parsed),
    error: parsed.errorCode
      ? {
          code: parsed.errorCode,
          retryable: false,
        }
      : null,
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt,
    completedAt: terminalStatus(status) ? parsed.updatedAt : null,
  });
}

export function consoleEventFromAgentActionEvent(
  event: AgentActionEvent,
): WorkflowConsoleEvent {
  const parsed = agentActionEventSchema.parse(event);
  const status = normalizeAgentActionStatus(parsed.action.status);
  return workflowConsoleEventSchema.parse({
    runId: prefixedRunId("agent_action", parsed.action.id),
    eventType: parsed.action.errorCode ? "run.error" : "run.status_changed",
    sourceEventType: parsed.type,
    sourceStatus: parsed.action.status,
    status,
    error: parsed.action.errorCode
      ? {
          code: parsed.action.errorCode,
          retryable: false,
        }
      : undefined,
    payload: { action: parsed.action },
    createdAt: parsed.action.updatedAt,
  });
}

export function workflowConsoleRunFromPlan8AgentRun(
  run: Plan8AgentRunProjectionSource,
): WorkflowConsoleRun {
  const status = normalizePlan8Status(run.status);
  return workflowConsoleRunSchema.parse({
    runId: prefixedRunId("plan8_agent", run.runId),
    runType: "plan8_agent",
    sourceId: run.runId,
    sourceStatus: run.status,
    workspaceId: run.workspaceId,
    projectId: run.projectId ?? null,
    actorUserId: run.userId,
    title: `Plan8 ${run.agentName}`,
    status,
    risk: "low",
    outputs: [],
    approvals: [],
    cost: {
      krw: run.totalCostKrw ?? 0,
    },
    error: run.errorMessage
      ? {
          code: "plan8_agent_failed",
          message: run.errorMessage,
          retryable: true,
        }
      : null,
    createdAt: toIso(run.startedAt),
    updatedAt: toIso(run.endedAt ?? run.startedAt),
    completedAt: toIsoOrNull(run.endedAt),
  });
}

export function workflowConsoleRunFromImportJob(
  job: ImportJobProjectionSource,
): WorkflowConsoleRun {
  const status = normalizeImportStatus(job.status);
  const total = job.totalItems > 0 ? job.totalItems : undefined;
  const current = job.completedItems + job.failedItems;
  return workflowConsoleRunSchema.parse({
    runId: prefixedRunId("import", job.id),
    runType: "import",
    sourceId: job.id,
    sourceStatus: job.status,
    workspaceId: job.workspaceId,
    projectId: job.projectId,
    actorUserId: job.userId,
    title: `Import ${job.source}`,
    status,
    risk: job.source === "google_drive" ? "external" : "write",
    progress: total
      ? {
          current,
          total,
          percent: Math.min(100, Math.round((current / total) * 100)),
        }
      : null,
    outputs: [
      {
        outputType: "import",
        id: job.id,
        label: importLabel(job),
        metadata: {
          source: job.source,
          workflowId: job.workflowId,
          completedItems: job.completedItems,
          failedItems: job.failedItems,
        },
      },
    ],
    approvals: [],
    error: status === "failed"
      ? {
          code: "import_failed",
          message: job.errorSummary ?? "Import failed",
          retryable: true,
        }
      : null,
    createdAt: toIso(job.createdAt),
    updatedAt: toIso(job.updatedAt),
    completedAt: toIsoOrNull(job.completedAt),
  });
}

export function workflowConsoleRunFromSynthesisExportRun(
  run: SynthesisExportRunProjectionSource,
): WorkflowConsoleRun {
  const status = normalizeSynthesisExportStatus(run.status);
  return workflowConsoleRunSchema.parse({
    runId: prefixedRunId("export", run.runId),
    runType: "export",
    sourceId: run.runId,
    sourceStatus: run.status,
    workspaceId: run.workspaceId,
    projectId: run.projectId,
    actorUserId: run.userId,
    title: `Export ${run.format}`,
    status,
    risk: "expensive",
    cost: {
      outputTokens: run.tokensUsed ?? 0,
    },
    outputs: (run.documents ?? []).map((document) => ({
      outputType: "export" as const,
      id: document.id,
      label: `${document.format} export`,
      ...(document.url ? { url: document.url } : {}),
      ...(document.bytes != null ? { bytes: document.bytes } : {}),
      metadata: {
        format: document.format,
        template: run.template,
        workflowId: run.workflowId ?? null,
      },
    })),
    approvals: [],
    error: status === "failed"
      ? {
          code: "synthesis_export_failed",
          retryable: true,
        }
      : null,
    createdAt: toIso(run.createdAt),
    updatedAt: toIso(run.updatedAt),
    completedAt: terminalStatus(status) ? toIso(run.updatedAt) : null,
  });
}

export function projectConsoleEventFromProjectObjectEvent(
  event: ProjectObjectActionEvent,
): WorkflowConsoleEvent {
  const parsed = projectObjectActionEventSchema.parse(event);

  if (parsed.type === "project_object_generation_requested") {
    return workflowConsoleEventSchema.parse({
      runId: prefixedRunId("document_generation", parsed.requestId),
      eventType: "run.status_changed",
      sourceEventType: parsed.type,
      sourceStatus: "queued",
      status: "queued",
      payload: { generation: parsed.generation },
    });
  }

  if (parsed.type === "project_object_generation_completed") {
    return workflowConsoleEventSchema.parse({
      runId: prefixedRunId("document_generation", parsed.result.requestId),
      eventType: "run.output_added",
      sourceEventType: parsed.type,
      sourceStatus: "completed",
      status: "completed",
      output: {
        outputType: "agent_file",
        id: parsed.result.object.id,
        label: parsed.result.object.title || parsed.result.object.filename,
        mimeType: parsed.result.artifact.mimeType,
        bytes: parsed.result.artifact.bytes,
        metadata: {
          format: parsed.result.format,
          objectKey: parsed.result.artifact.objectKey,
        },
      },
      payload: { result: parsed.result },
    });
  }

  if (parsed.type === "project_object_generation_failed") {
    return workflowConsoleEventSchema.parse({
      runId: prefixedRunId("document_generation", parsed.result.requestId),
      eventType: "run.error",
      sourceEventType: parsed.type,
      sourceStatus: "failed",
      status: "failed",
      error: {
        code: parsed.result.errorCode,
        retryable: parsed.result.retryable,
      },
      payload: { result: parsed.result },
    });
  }

  if (parsed.type === "project_object_export_requested") {
    return workflowConsoleEventSchema.parse({
      runId: prefixedRunId("export", parsed.requestId ?? parsed.objectId),
      eventType: "run.status_changed",
      sourceEventType: parsed.type,
      sourceStatus: "queued",
      status: "queued",
      payload: parsed,
    });
  }

  if (parsed.type === "project_object_export_ready") {
    return workflowConsoleEventSchema.parse({
      runId: prefixedRunId("export", parsed.object.id),
      eventType: "run.output_added",
      sourceEventType: parsed.type,
      sourceStatus: "completed",
      status: "completed",
      output: {
        outputType: "export",
        id: parsed.object.id,
        label: parsed.filename,
        url: parsed.downloadUrl,
        mimeType: parsed.mimeType,
        bytes: parsed.bytes,
      },
      payload: parsed,
    });
  }

  if (parsed.type === "project_object_export_completed") {
    return workflowConsoleEventSchema.parse({
      runId: prefixedRunId("export", parsed.result.requestId),
      eventType: "run.output_added",
      sourceEventType: parsed.type,
      sourceStatus: "completed",
      status: "completed",
      output: {
        outputType: "provider_url",
        id: parsed.result.externalObjectId,
        label: parsed.result.provider,
        url: parsed.result.externalUrl,
        mimeType: parsed.result.exportedMimeType,
        metadata: {
          provider: parsed.result.provider,
          objectId: parsed.result.objectId,
        },
      },
      payload: { result: parsed.result },
    });
  }

  if (parsed.type === "project_object_export_failed") {
    return workflowConsoleEventSchema.parse({
      runId: prefixedRunId("export", parsed.result.requestId),
      eventType: "run.error",
      sourceEventType: parsed.type,
      sourceStatus: "failed",
      status: "failed",
      error: {
        code: parsed.result.errorCode,
        retryable: parsed.result.retryable,
      },
      payload: { result: parsed.result },
    });
  }

  return workflowConsoleEventSchema.parse({
    runId: prefixedRunId("system_workflow", "project-object"),
    eventType: "run.progress",
    sourceEventType: parsed.type,
    payload: parsed,
  });
}

function prefixedRunId(type: WorkflowConsoleRunType, id: string): string {
  return `${type}:${id}`;
}

function normalizeChatStatus(status: string): WorkflowConsoleStatus {
  if (status === "complete" || status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  if (status === "running") return "running";
  return "queued";
}

function consoleEventTypeFromChatEvent(event: string): WorkflowConsoleEvent["eventType"] {
  if (event === "status") return "run.progress";
  if (event === "thought") return "run.thought";
  if (event === "error") return "run.error";
  if (event === "done") return "run.status_changed";
  if (event === "agent_file" || event.startsWith("project_object_")) {
    return "run.output_added";
  }
  return "run.progress";
}

function sourceStatusFromChatEvent(event: ChatRunEventProjectionSource): string | undefined {
  if (event.event !== "done") return undefined;
  const status = event.payload.status;
  return typeof status === "string" ? status : undefined;
}

function statusFromChatDoneEvent(
  event: ChatRunEventProjectionSource,
): WorkflowConsoleStatus | undefined {
  const sourceStatus = sourceStatusFromChatEvent(event);
  return sourceStatus ? normalizeChatStatus(sourceStatus) : undefined;
}

function normalizeAgentActionStatus(status: AgentAction["status"]): WorkflowConsoleStatus {
  return status;
}

function normalizePlan8Status(status: string): WorkflowConsoleStatus {
  if (status === "completed" || status === "complete") return "completed";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  if (status === "awaiting_input" || status === "blocked") return "blocked";
  if (status === "queued") return "queued";
  return "running";
}

function normalizeImportStatus(status: string): WorkflowConsoleStatus {
  if (status === "completed" || status === "complete") return "completed";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  if (status === "running" || status === "processing") return "running";
  return "queued";
}

function normalizeSynthesisExportStatus(status: string): WorkflowConsoleStatus {
  if (status === "completed" || status === "complete") return "completed";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  if (status === "pending" || status === "queued") return "queued";
  return "running";
}

function terminalStatus(status: WorkflowConsoleStatus): boolean {
  return ["completed", "failed", "cancelled", "reverted"].includes(status);
}

function importLabel(job: ImportJobProjectionSource): string {
  const metadata = job.sourceMetadata ?? {};
  const filename = stringField(metadata, "filename")
    ?? stringField(metadata, "fileName")
    ?? stringField(metadata, "name");
  return filename ?? job.source;
}

function outputsFromAgentAction(action: AgentAction): WorkflowConsoleOutput[] {
  if (!action.result) return [];
  if (action.kind === "code_project.preview") {
    const previewUrl = stringField(action.result, "previewUrl");
    if (previewUrl) {
      return [
        {
          outputType: "preview",
          id: action.id,
          label: "Static preview",
          url: previewUrl,
          metadata: {
            codeWorkspaceId: stringField(action.result, "codeWorkspaceId"),
            snapshotId: stringField(action.result, "snapshotId"),
            entryPath: stringField(action.result, "entryPath"),
            expiresAt: stringField(action.result, "expiresAt"),
          },
        },
      ];
    }
  }
  if (action.kind === "file.export") {
    const externalUrl = stringField(action.result, "externalUrl");
    const provider = stringField(action.result, "provider");
    const externalObjectId = stringField(action.result, "externalObjectId");
    const exportedMimeType = stringField(action.result, "exportedMimeType");
    if (externalUrl && provider && externalObjectId) {
      return [
        {
          outputType: "provider_url",
          id: externalObjectId,
          label: provider,
          url: externalUrl,
          ...(exportedMimeType ? { mimeType: exportedMimeType } : {}),
          metadata: {
            provider,
            objectId: stringField(action.result, "objectId"),
            exportStatus: stringField(action.result, "exportStatus"),
          },
        },
      ];
    }
  }
  const noteId = stringField(action.result, "noteId");
  if (noteId) {
    return [
      {
        outputType: "note",
        id: noteId,
        label: stringField(action.result, "title") ?? action.kind,
      },
    ];
  }
  const objectId = stringField(action.result, "objectId") ?? stringField(action.result, "fileId");
  if (objectId) {
    return [
      {
        outputType: "agent_file",
        id: objectId,
        label: stringField(action.result, "filename") ?? action.kind,
      },
    ];
  }
  return [];
}

function approvalFromAgentAction(action: AgentAction): WorkflowConsoleRun["approvals"] {
  if (action.status !== "approval_required" && action.status !== "draft") return [];
  return [
    {
      approvalId: `${prefixedRunId("agent_action", action.id)}:approval`,
      status: action.status === "approval_required" ? "requested" : "superseded",
      risk: action.risk,
      requestedAt: action.createdAt,
      summary: action.kind,
    },
  ];
}

function errorFromUnknown(value: unknown, fallbackCode: string): z.infer<typeof workflowConsoleErrorSchema> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return {
      code: typeof record.code === "string" ? record.code : fallbackCode,
      message: typeof record.message === "string" ? record.message : undefined,
      retryable: Boolean(record.retryable),
    };
  }
  return { code: fallbackCode, retryable: true };
}

function stringField(value: Record<string, unknown>, key: string): string | null {
  const field = value[key];
  return typeof field === "string" && field.length > 0 ? field : null;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toIsoOrNull(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return toIso(value);
}
