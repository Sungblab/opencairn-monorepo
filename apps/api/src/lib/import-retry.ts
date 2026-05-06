import { randomUUID } from "node:crypto";
import {
  and,
  db as defaultDb,
  eq,
  importJobs,
  inArray,
  type DB,
} from "@opencairn/db";
import type { AgentAction, AgentActionRisk, AgentActionKind } from "@opencairn/shared";
import {
  createQueuedWorkflowAgentAction,
  markWorkflowAgentActionFailed,
} from "./agent-actions";
import { canWrite } from "./permissions";
import { getTemporalClient, taskQueue } from "./temporal-client";

export const MAX_CONCURRENT_IMPORTS = 2;

type ImportWorkflowSource = "google_drive" | "notion_zip" | "markdown_zip";
type RawSourceMeta = Record<string, unknown>;

interface ImportJobRecord {
  id: string;
  workspaceId: string;
  userId: string;
  source: string;
  targetProjectId: string | null;
  targetParentNoteId: string | null;
  workflowId: string;
  status: string;
  sourceMetadata: Record<string, unknown>;
}

export class ImportRetryError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: 400 | 403 | 404 | 409 | 429,
    message = code,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export interface ImportRetryRepository {
  findJobById(id: string): Promise<ImportJobRecord | null>;
  countRunningJobs(userId: string): Promise<number>;
  insertRetryJob(values: {
    workspaceId: string;
    userId: string;
    source: ImportWorkflowSource;
    targetProjectId: string | null;
    targetParentNoteId: string | null;
    workflowId: string;
    sourceMetadata: Record<string, unknown>;
  }): Promise<{ id: string }>;
  markFailed(jobId: string, errorSummary: string): Promise<void>;
}

export interface ImportRetryServiceOptions {
  repo?: ImportRetryRepository;
  canWriteWorkspace?: (userId: string, workspaceId: string) => Promise<boolean>;
  canWriteProject?: (userId: string, projectId: string) => Promise<boolean>;
  createWorkflowAction?: (args: StartImportJobArgs) => Promise<{
    action: AgentAction;
    idempotent: boolean;
  } | null>;
  startWorkflow?: (args: StartImportWorkflowArgs) => Promise<void>;
  newWorkflowId?: () => string;
}

export interface RetryImportJobResult {
  jobId: string;
  action: AgentAction | null;
}

interface StartImportWorkflowArgs {
  jobId: string;
  workflowId: string;
  userId: string;
  workspaceId: string;
  source: ImportWorkflowSource;
  sourceMetadata: Record<string, unknown>;
  actionId?: string | null;
}

interface StartImportJobArgs {
  workspaceId: string;
  userId: string;
  source: ImportWorkflowSource;
  targetProjectId: string | null;
  jobId: string;
  workflowId: string;
  sourceMetadata: Record<string, unknown>;
}

export function createDrizzleImportRetryRepository(conn: DB = defaultDb): ImportRetryRepository {
  return {
    async findJobById(id) {
      const [job] = await conn
        .select()
        .from(importJobs)
        .where(eq(importJobs.id, id))
        .limit(1);
      return job ? {
        id: job.id,
        workspaceId: job.workspaceId,
        userId: job.userId,
        source: job.source,
        targetProjectId: job.targetProjectId,
        targetParentNoteId: job.targetParentNoteId,
        workflowId: job.workflowId,
        status: job.status,
        sourceMetadata: (job.sourceMetadata ?? {}) as Record<string, unknown>,
      } : null;
    },
    async countRunningJobs(userId) {
      const rows = await conn
        .select({ id: importJobs.id })
        .from(importJobs)
        .where(
          and(
            eq(importJobs.userId, userId),
            inArray(importJobs.status, ["queued", "running"]),
          ),
        );
      return rows.length;
    },
    async insertRetryJob(values) {
      const [retryJob] = await conn
        .insert(importJobs)
        .values({
          workspaceId: values.workspaceId,
          userId: values.userId,
          source: values.source,
          targetProjectId: values.targetProjectId,
          targetParentNoteId: values.targetParentNoteId,
          workflowId: values.workflowId,
          status: "queued",
          sourceMetadata: values.sourceMetadata,
        })
        .returning({ id: importJobs.id });
      if (!retryJob) throw new ImportRetryError("import_retry_create_failed", 409);
      return retryJob;
    },
    async markFailed(jobId, errorSummary) {
      await conn
        .update(importJobs)
        .set({
          status: "failed",
          errorSummary,
          finishedAt: new Date(),
        })
        .where(eq(importJobs.id, jobId));
    },
  };
}

export async function runningImportCount(
  userId: string,
  options?: Pick<ImportRetryServiceOptions, "repo">,
): Promise<number> {
  const repo = options?.repo ?? createDrizzleImportRetryRepository();
  return repo.countRunningJobs(userId);
}

export async function retryImportJob(
  failedJobId: string,
  userId: string,
  options?: ImportRetryServiceOptions,
): Promise<RetryImportJobResult> {
  const repo = options?.repo ?? createDrizzleImportRetryRepository();
  const job = await repo.findJobById(failedJobId);
  if (!job) throw new ImportRetryError("not_found", 404);
  if (job.status !== "failed") {
    throw new ImportRetryError("retry_requires_failed_job", 409);
  }
  if (!(await canWriteWorkspace(userId, job.workspaceId, options))) {
    throw new ImportRetryError("Forbidden", 403);
  }
  if (!isRetryableImportSource(job.source)) {
    throw new ImportRetryError("retry_not_supported", 409);
  }
  if ((await repo.countRunningJobs(userId)) >= MAX_CONCURRENT_IMPORTS) {
    throw new ImportRetryError("import_limit_exceeded", 429, "import_limit_exceeded", {
      limit: MAX_CONCURRENT_IMPORTS,
    });
  }
  if (
    job.targetProjectId
    && !(await canWriteProject(userId, job.targetProjectId, options))
  ) {
    throw new ImportRetryError("Forbidden", 403);
  }

  const workflowId = options?.newWorkflowId?.() ?? `import-${randomUUID()}`;
  const sourceMetadata = job.sourceMetadata ?? {};
  const retryJob = await repo.insertRetryJob({
    workspaceId: job.workspaceId,
    userId,
    source: job.source,
    targetProjectId: job.targetProjectId,
    targetParentNoteId: job.targetParentNoteId,
    workflowId,
    sourceMetadata,
  });
  const action = await startImportJobWithAction({
    workspaceId: job.workspaceId,
    userId,
    source: job.source,
    targetProjectId: job.targetProjectId,
    jobId: retryJob.id,
    workflowId,
    sourceMetadata,
  }, {
    ...options,
    repo,
  });
  return { jobId: retryJob.id, action: action?.action ?? null };
}

export async function startImportJobWithAction(
  args: StartImportJobArgs,
  options?: ImportRetryServiceOptions,
): Promise<{ action: AgentAction; idempotent: boolean } | null> {
  const repo = options?.repo ?? createDrizzleImportRetryRepository();
  let action: { action: AgentAction; idempotent: boolean } | null = null;
  try {
    action = await (options?.createWorkflowAction ?? createImportWorkflowAction)(args);
  } catch (err) {
    await repo.markFailed(
      args.jobId,
      "Import action could not be queued. Please try again.",
    );
    throw err;
  }

  await (options?.startWorkflow ?? startImportWorkflow)({
    jobId: args.jobId,
    workflowId: args.workflowId,
    userId: args.userId,
    workspaceId: args.workspaceId,
    source: args.source,
    sourceMetadata: args.sourceMetadata,
    actionId: action?.action.id,
  });
  return action;
}

export async function startImportWorkflow(args: StartImportWorkflowArgs): Promise<void> {
  const client = await getTemporalClient();
  try {
    await client.workflow.start("ImportWorkflow", {
      workflowId: args.workflowId,
      taskQueue: taskQueue(),
      args: [
        {
          job_id: args.jobId,
          user_id: args.userId,
          workspace_id: args.workspaceId,
          source: args.source,
          source_metadata: args.sourceMetadata,
        },
      ],
    });
  } catch (err) {
    const repo = createDrizzleImportRetryRepository();
    await repo.markFailed(
      args.jobId,
      "Import could not be started. Please try again.",
    );
    await markWorkflowAgentActionFailed(args.actionId, "import_start_failed", {
      ok: false,
      jobId: args.jobId,
      workflowId: args.workflowId,
      errorCode: "import_start_failed",
      retryable: true,
    });
    throw err;
  }
}

export async function createImportWorkflowAction(
  args: StartImportJobArgs,
): Promise<{ action: AgentAction; idempotent: boolean } | null> {
  if (!args.targetProjectId) return null;
  const kind = importActionKind(args.source);
  return createQueuedWorkflowAgentAction({
    workspaceId: args.workspaceId,
    projectId: args.targetProjectId,
    actorUserId: args.userId,
    requestId: args.jobId,
    sourceRunId: args.jobId,
    kind,
    risk: importActionRisk(args.source),
    input: {
      source: args.source,
      target: "existing_project",
      sourceMetadata: safeSourceMetadata(args.source, args.sourceMetadata),
    },
    preview: {
      summary: "Import workflow queued through the unified action ledger.",
      workflowHint: "import",
      jobId: args.jobId,
      workflowId: args.workflowId,
    },
    result: {
      workflowId: args.workflowId,
      jobId: args.jobId,
      workflowHint: "import",
    },
  });
}

export function safeSourceMetadata(source: string, meta: unknown): RawSourceMeta {
  const m = (meta ?? {}) as RawSourceMeta;
  if (source === "notion_zip") {
    return {
      originalName: typeof m.original_name === "string" ? m.original_name : null,
    };
  }
  if (source === "markdown_zip") {
    return {
      originalName: typeof m.original_name === "string" ? m.original_name : null,
    };
  }
  if (source === "google_drive") {
    const fileIds = Array.isArray(m.file_ids) ? m.file_ids : [];
    return { fileCount: fileIds.length };
  }
  return {};
}

function isRetryableImportSource(source: string): source is ImportWorkflowSource {
  return source === "google_drive" || source === "notion_zip" || source === "markdown_zip";
}

function importActionKind(source: ImportWorkflowSource): Extract<
  AgentActionKind,
  "import.drive" | "import.notion" | "import.markdown_zip"
> {
  if (source === "google_drive") return "import.drive";
  if (source === "notion_zip") return "import.notion";
  return "import.markdown_zip";
}

function importActionRisk(source: ImportWorkflowSource): AgentActionRisk {
  return source === "google_drive" ? "external" : "write";
}

async function canWriteWorkspace(
  userId: string,
  workspaceId: string,
  options?: ImportRetryServiceOptions,
): Promise<boolean> {
  const check = options?.canWriteWorkspace
    ?? ((uid, wid) => canWrite(uid, { type: "workspace", id: wid }));
  return check(userId, workspaceId);
}

async function canWriteProject(
  userId: string,
  projectId: string,
  options?: ImportRetryServiceOptions,
): Promise<boolean> {
  const check = options?.canWriteProject
    ?? ((uid, pid) => canWrite(uid, { type: "project", id: pid }));
  return check(userId, projectId);
}
