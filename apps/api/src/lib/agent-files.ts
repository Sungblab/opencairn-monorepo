import crypto from "node:crypto";
import {
  agentFiles,
  and,
  db,
  desc,
  eq,
  folders,
  ingestJobs,
  isNull,
  notes,
  projects,
} from "@opencairn/db";
import {
  type AgentFileKind,
  type AgentFileSource,
  type AgentFileSummary,
  type CreateAgentFilePayload,
  inferAgentFileKind,
  inferAgentFileMimeType,
} from "@opencairn/shared";
import { canRead, canWrite } from "./permissions";
import { uploadObject } from "./s3";
import { streamObject } from "./s3-get";
import { getTemporalClient } from "./temporal-client";

const TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE ?? "ingest";
const TECTONIC_URL = process.env.TECTONIC_URL ?? "http://tectonic:8888";
const TECTONIC_TIMEOUT_MS = Number(process.env.TECTONIC_TIMEOUT_MS ?? 120_000);

export class AgentFileError extends Error {
  constructor(
    public readonly code:
      | "bad_request"
      | "forbidden"
      | "not_found"
      | "unsupported_kind"
      | "compile_disabled"
      | "compile_failed",
    message: string = code,
    public readonly status: number = statusForCode(code),
  ) {
    super(message);
  }
}

function statusForCode(code: AgentFileError["code"]): number {
  switch (code) {
    case "bad_request":
      return 400;
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    case "unsupported_kind":
      return 415;
    case "compile_disabled":
    case "compile_failed":
      return 409;
  }
}

export interface CreateAgentFileInput {
  userId: string;
  projectId: string;
  file: CreateAgentFilePayload;
  source?: AgentFileSource;
  chatThreadId?: string | null;
  chatMessageId?: string | null;
  parentFileId?: string | null;
  versionGroupId?: string;
  version?: number;
  skipPermissionCheck?: boolean;
}

export interface RegisterExistingObjectInput {
  userId: string;
  workspaceId: string;
  projectId: string;
  filename: string;
  title?: string;
  kind?: AgentFileKind;
  mimeType?: string;
  objectKey: string;
  bytes: number;
  contentHash?: string;
  source: AgentFileSource;
  folderId?: string | null;
}

export type AgentFileRecord = typeof agentFiles.$inferSelect;

export interface AgentFileDownloadExport {
  file: AgentFileSummary;
  downloadUrl: string;
  filename: string;
  mimeType: string;
  bytes: number;
}

export async function createAgentFile(input: CreateAgentFileInput): Promise<AgentFileSummary> {
  if (!input.skipPermissionCheck && !(await canWrite(input.userId, { type: "project", id: input.projectId }))) {
    throw new AgentFileError("forbidden");
  }

  const project = await getProject(input.projectId);
  if (!project) throw new AgentFileError("not_found");

  if (input.file.folderId) {
    await assertFolderInProject(input.file.folderId, input.projectId);
  }

  const fileId = crypto.randomUUID();
  const filename = normalizeFilename(input.file.filename);
  const extension = extensionFor(filename);
  const kind = input.file.kind ?? inferAgentFileKind(filename, input.file.mimeType);
  const mimeType = input.file.mimeType ?? inferAgentFileMimeType(filename, kind);
  const bytes = decodePayload(input.file);
  const contentHash = crypto.createHash("sha256").update(bytes).digest("hex");
  const versionGroupId = input.versionGroupId ?? crypto.randomUUID();
  const version = input.version ?? 1;
  const objectKey = objectKeyFor({
    workspaceId: project.workspaceId,
    projectId: input.projectId,
    fileId,
    version,
    filename,
  });

  await uploadObject(objectKey, bytes, mimeType);

  const [row] = await db
    .insert(agentFiles)
    .values({
      id: fileId,
      workspaceId: project.workspaceId,
      projectId: input.projectId,
      folderId: input.file.folderId ?? null,
      createdBy: input.userId,
      title: input.file.title?.trim() || titleFromFilename(filename),
      filename,
      extension,
      kind,
      mimeType,
      objectKey,
      bytes: bytes.length,
      contentHash,
      source: input.source ?? "agent_chat",
      chatThreadId: input.chatThreadId ?? null,
      chatMessageId: input.chatMessageId ?? null,
      parentFileId: input.parentFileId ?? null,
      versionGroupId,
      version,
      ingestStatus: input.file.startIngest === false ? "not_started" : "queued",
    })
    .returning();

  if (!row) throw new AgentFileError("bad_request", "agent_file_insert_failed");

  if (input.file.startIngest !== false && isIngestible(kind, mimeType)) {
    const workflowId = await dispatchIngest({
      row,
      userId: input.userId,
      ingestMimeType: ingestMimeFor(kind, mimeType),
    });
    const [updated] = await db
      .update(agentFiles)
      .set({ ingestWorkflowId: workflowId, ingestStatus: "queued" })
      .where(eq(agentFiles.id, row.id))
      .returning();
    return toSummary(updated ?? row);
  }

  return toSummary(row);
}

export async function createAgentFileVersion(input: {
  userId: string;
  id: string;
  file: {
    filename?: string;
    title?: string;
    content?: string;
    base64?: string;
    startIngest?: boolean;
  };
}): Promise<AgentFileSummary> {
  const current = await getAgentFileForWrite(input.id, input.userId);
  const [latest] = await db
    .select({ version: agentFiles.version })
    .from(agentFiles)
    .where(eq(agentFiles.versionGroupId, current.versionGroupId))
    .orderBy(desc(agentFiles.version))
    .limit(1);

  return createAgentFile({
    userId: input.userId,
    projectId: current.projectId,
    source: current.source as AgentFileSource,
    parentFileId: current.id,
    versionGroupId: current.versionGroupId,
    version: (latest?.version ?? current.version) + 1,
    file: {
      filename: input.file.filename ?? current.filename,
      title: input.file.title ?? current.title,
      kind: current.kind as AgentFileKind,
      mimeType: current.mimeType,
      folderId: current.folderId,
      content: input.file.content,
      base64: input.file.base64,
      startIngest: input.file.startIngest,
    },
    skipPermissionCheck: true,
  });
}

export async function getAgentFileForRead(id: string, userId: string): Promise<AgentFileRecord> {
  const row = await findLiveAgentFile(id);
  if (!row) throw new AgentFileError("not_found");
  if (!(await canRead(userId, { type: "project", id: row.projectId }))) {
    throw new AgentFileError("forbidden");
  }
  return row;
}

export async function getAgentFileForWrite(id: string, userId: string): Promise<AgentFileRecord> {
  const row = await findLiveAgentFile(id);
  if (!row) throw new AgentFileError("not_found");
  if (!(await canWrite(userId, { type: "project", id: row.projectId }))) {
    throw new AgentFileError("forbidden");
  }
  return row;
}

export async function streamAgentFile(id: string, userId: string): Promise<Response> {
  const row = await getAgentFileForRead(id, userId);
  const obj = await streamObject(row.objectKey);
  return new Response(obj.stream, {
    headers: downloadHeaders({
      filename: row.filename,
      contentType: row.mimeType,
      contentLength: obj.contentLength,
      disposition: inlineDisposition(row.kind as AgentFileKind) ? "inline" : "attachment",
    }),
  });
}

export async function exportAgentFileForDownload(
  id: string,
  userId: string,
): Promise<AgentFileDownloadExport> {
  const row = await getAgentFileForRead(id, userId);
  return {
    file: toSummary(row),
    downloadUrl: `/api/agent-files/${row.id}/file`,
    filename: row.filename,
    mimeType: row.mimeType,
    bytes: row.bytes,
  };
}

export async function streamCompiledAgentFile(id: string, userId: string): Promise<Response> {
  const row = await getAgentFileForRead(id, userId);
  if (!row.compiledObjectKey) throw new AgentFileError("not_found");
  const obj = await streamObject(row.compiledObjectKey);
  return new Response(obj.stream, {
    headers: downloadHeaders({
      filename: compiledFilename(row.filename),
      contentType: row.compiledMimeType ?? obj.contentType,
      contentLength: obj.contentLength,
      disposition: "inline",
    }),
  });
}

export async function updateAgentFile(input: {
  id: string;
  userId: string;
  filename?: string;
  title?: string;
  folderId?: string | null;
}): Promise<AgentFileSummary> {
  const current = await getAgentFileForWrite(input.id, input.userId);
  if (input.folderId) await assertFolderInProject(input.folderId, current.projectId);

  const filename = input.filename ? normalizeFilename(input.filename) : undefined;
  const [row] = await db
    .update(agentFiles)
    .set({
      ...(filename
        ? {
            filename,
            extension: extensionFor(filename),
            title: input.title ?? titleFromFilename(filename),
          }
        : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.folderId !== undefined ? { folderId: input.folderId } : {}),
    })
    .where(and(eq(agentFiles.id, input.id), isNull(agentFiles.deletedAt)))
    .returning();
  if (!row) throw new AgentFileError("not_found");
  return toSummary(row);
}

export async function deleteAgentFile(id: string, userId: string): Promise<AgentFileSummary> {
  await getAgentFileForWrite(id, userId);
  const [row] = await db
    .update(agentFiles)
    .set({ deletedAt: new Date() })
    .where(and(eq(agentFiles.id, id), isNull(agentFiles.deletedAt)))
    .returning();
  if (!row) throw new AgentFileError("not_found");
  return toSummary(row);
}

export async function startAgentFileIngest(id: string, userId: string): Promise<AgentFileSummary> {
  const row = await getAgentFileForWrite(id, userId);
  if (!isIngestible(row.kind as AgentFileKind, row.mimeType)) {
    throw new AgentFileError("unsupported_kind");
  }
  const workflowId = await dispatchIngest({
    row,
    userId,
    ingestMimeType: ingestMimeFor(row.kind as AgentFileKind, row.mimeType),
  });
  const [updated] = await db
    .update(agentFiles)
    .set({ ingestWorkflowId: workflowId, ingestStatus: "queued" })
    .where(eq(agentFiles.id, id))
    .returning();
  return toSummary(updated ?? row);
}

export async function compileAgentFile(id: string, userId: string): Promise<AgentFileSummary> {
  const row = await getAgentFileForWrite(id, userId);
  if (row.kind !== "latex") throw new AgentFileError("unsupported_kind");
  if ((process.env.FEATURE_TECTONIC_COMPILE ?? "false").toLowerCase() !== "true") {
    const [updated] = await db
      .update(agentFiles)
      .set({ compileStatus: "disabled" })
      .where(eq(agentFiles.id, row.id))
      .returning();
    throw new AgentFileError("compile_disabled", "compile_disabled", 409);
  }

  await db
    .update(agentFiles)
    .set({ compileStatus: "running" })
    .where(eq(agentFiles.id, row.id));

  const sourceResponse = await streamObject(row.objectKey);
  const source = await new Response(sourceResponse.stream).text();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TECTONIC_TIMEOUT_MS);
  try {
    const res = await fetch(`${TECTONIC_URL}/compile`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filename: row.filename,
        source,
        timeout_ms: TECTONIC_TIMEOUT_MS,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = sanitizeCompileError(await res.text());
      await db.update(agentFiles).set({ compileStatus: "failed" }).where(eq(agentFiles.id, row.id));
      throw new AgentFileError("compile_failed", text);
    }
    const pdf = Buffer.from(await res.arrayBuffer());
    const objectKey = `agent-files/${row.workspaceId}/${row.projectId}/${row.id}/compiled/v${row.version}/${row.id}.pdf`;
    await uploadObject(objectKey, pdf, "application/pdf");
    const [updated] = await db
      .update(agentFiles)
      .set({
        compileStatus: "completed",
        compiledObjectKey: objectKey,
        compiledMimeType: "application/pdf",
      })
      .where(eq(agentFiles.id, row.id))
      .returning();
    return toSummary(updated ?? row);
  } finally {
    clearTimeout(timeout);
  }
}

export async function createCanvasFromAgentFile(id: string, userId: string): Promise<{ noteId: string }> {
  const row = await getAgentFileForWrite(id, userId);
  if (row.kind !== "code" && row.kind !== "html") throw new AgentFileError("unsupported_kind");
  const obj = await streamObject(row.objectKey);
  const source = await new Response(obj.stream).text();
  const language = canvasLanguageFor(row.filename);

  if (row.canvasNoteId) {
    const [updated] = await db
      .update(notes)
      .set({
        title: row.title,
        contentText: source,
        canvasLanguage: language,
        mimeType: row.mimeType,
        deletedAt: null,
      })
      .where(eq(notes.id, row.canvasNoteId))
      .returning({ id: notes.id });
    if (updated) return { noteId: updated.id };
  }

  const [note] = await db
    .insert(notes)
    .values({
      projectId: row.projectId,
      workspaceId: row.workspaceId,
      folderId: row.folderId,
      title: row.title,
      contentText: source,
      sourceType: "canvas",
      canvasLanguage: language,
      isAuto: false,
      mimeType: row.mimeType,
    })
    .returning({ id: notes.id });
  if (!note) throw new AgentFileError("bad_request", "canvas_note_insert_failed");
  await db.update(agentFiles).set({ canvasNoteId: note.id }).where(eq(agentFiles.id, row.id));
  return { noteId: note.id };
}

export async function registerExistingObjectAsAgentFile(input: RegisterExistingObjectInput): Promise<AgentFileSummary> {
  if (!(await canWrite(input.userId, { type: "project", id: input.projectId }))) {
    throw new AgentFileError("forbidden");
  }
  const filename = normalizeFilename(input.filename);
  const kind = input.kind ?? inferAgentFileKind(filename, input.mimeType);
  const mimeType = input.mimeType ?? inferAgentFileMimeType(filename, kind);
  const contentHash = input.contentHash ?? (await hashObject(input.objectKey));
  const [row] = await db
    .insert(agentFiles)
    .values({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      folderId: input.folderId ?? null,
      createdBy: input.userId,
      title: input.title?.trim() || titleFromFilename(filename),
      filename,
      extension: extensionFor(filename),
      kind,
      mimeType,
      objectKey: input.objectKey,
      bytes: input.bytes,
      contentHash,
      source: input.source,
      versionGroupId: crypto.randomUUID(),
      version: 1,
    })
    .returning();
  if (!row) throw new AgentFileError("bad_request", "agent_file_insert_failed");
  return toSummary(row);
}

async function hashObject(objectKey: string): Promise<string> {
  const obj = await streamObject(objectKey);
  const bytes = Buffer.from(await new Response(obj.stream).arrayBuffer());
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function toSummary(row: AgentFileRecord): AgentFileSummary {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    folderId: row.folderId,
    title: row.title,
    filename: row.filename,
    extension: row.extension,
    kind: row.kind as AgentFileKind,
    mimeType: row.mimeType,
    bytes: row.bytes,
    source: row.source as AgentFileSource,
    versionGroupId: row.versionGroupId,
    version: row.version,
    ingestWorkflowId: row.ingestWorkflowId,
    ingestStatus: row.ingestStatus as AgentFileSummary["ingestStatus"],
    sourceNoteId: row.sourceNoteId,
    canvasNoteId: row.canvasNoteId,
    compileStatus: row.compileStatus as AgentFileSummary["compileStatus"],
    compiledMimeType: row.compiledMimeType,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function decodePayload(file: Pick<CreateAgentFilePayload, "content" | "base64">): Buffer {
  if (file.content !== undefined) return Buffer.from(file.content, "utf8");
  if (file.base64 !== undefined) return Buffer.from(file.base64, "base64");
  throw new AgentFileError("bad_request", "missing_file_content");
}

function normalizeFilename(filename: string): string {
  const safe = filename.trim().replace(/[\r\n"\\]/g, "_");
  if (!safe || safe.includes("/") || safe.includes("..")) {
    throw new AgentFileError("bad_request", "invalid_filename");
  }
  return safe.slice(0, 180);
}

function extensionFor(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > -1 ? filename.slice(dot + 1).toLowerCase() : "bin";
}

function titleFromFilename(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(0, dot) : filename;
}

function objectKeyFor(input: {
  workspaceId: string;
  projectId: string;
  fileId: string;
  version: number;
  filename: string;
}): string {
  return `agent-files/${input.workspaceId}/${input.projectId}/${input.fileId}/v${input.version}/${encodeURIComponent(input.filename)}`;
}

async function getProject(projectId: string): Promise<{ workspaceId: string } | null> {
  const [project] = await db
    .select({ workspaceId: projects.workspaceId })
    .from(projects)
    .where(eq(projects.id, projectId));
  return project ?? null;
}

async function assertFolderInProject(folderId: string, projectId: string): Promise<void> {
  const [folder] = await db
    .select({ id: folders.id })
    .from(folders)
    .where(and(eq(folders.id, folderId), eq(folders.projectId, projectId)));
  if (!folder) throw new AgentFileError("bad_request", "folder_not_in_project");
}

async function findLiveAgentFile(id: string): Promise<AgentFileRecord | null> {
  const [row] = await db
    .select()
    .from(agentFiles)
    .where(and(eq(agentFiles.id, id), isNull(agentFiles.deletedAt)))
    .limit(1);
  return row ?? null;
}

function isIngestible(kind: AgentFileKind, mimeType: string): boolean {
  if (kind === "binary") return false;
  if (mimeType.startsWith("image/")) return true;
  return [
    "markdown",
    "text",
    "latex",
    "html",
    "code",
    "json",
    "csv",
    "xlsx",
    "pdf",
    "docx",
    "pptx",
  ].includes(kind);
}

function ingestMimeFor(kind: AgentFileKind, mimeType: string): string {
  if (kind === "markdown") return "text/markdown";
  if (kind === "pdf" || kind === "docx" || kind === "pptx" || kind === "xlsx" || mimeType.startsWith("image/")) {
    return mimeType;
  }
  return "text/plain";
}

async function dispatchIngest(input: {
  row: AgentFileRecord;
  userId: string;
  ingestMimeType: string;
}): Promise<string> {
  const workflowId = `ingest-agent-file-${crypto.randomUUID()}`;
  await db.insert(ingestJobs).values({
    workflowId,
    userId: input.userId,
    workspaceId: input.row.workspaceId,
    projectId: input.row.projectId,
    source: "agent-file",
  });
  const client = await getTemporalClient();
  await client.workflow.start("IngestWorkflow", {
    taskQueue: TASK_QUEUE,
    workflowId,
    args: [
      {
        objectKey: input.row.objectKey,
        fileName: input.row.filename,
        mimeType: input.ingestMimeType,
        userId: input.userId,
        projectId: input.row.projectId,
        noteId: null,
        workspace_id: input.row.workspaceId,
      },
    ],
  });
  return workflowId;
}

function downloadHeaders(input: {
  filename: string;
  contentType: string;
  contentLength: number;
  disposition: "inline" | "attachment";
}): Headers {
  const safeName = input.filename.replace(/[\r\n"\\]/g, "_");
  const asciiName = safeName.replace(/[^\x20-\x7e]/g, "_");
  const starName = encodeURIComponent(safeName).replace(
    /[!'()*]/g,
    (ch) => "%" + ch.charCodeAt(0).toString(16).toUpperCase(),
  );
  return new Headers({
    "Content-Type": input.contentType,
    "Content-Length": String(input.contentLength),
    "Content-Disposition": `${input.disposition}; filename="${asciiName}"; filename*=UTF-8''${starName}`,
    "Cache-Control": "private, max-age=60",
  });
}

function inlineDisposition(kind: AgentFileKind): boolean {
  return ["markdown", "text", "latex", "html", "code", "json", "csv", "pdf", "image"].includes(kind);
}

function compiledFilename(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return `${dot > 0 ? filename.slice(0, dot) : filename}.pdf`;
}

function sanitizeCompileError(text: string): string {
  return text.replace(/[A-Za-z]:\\[^\s]+|\/[^\s]+/g, "[path]").slice(0, 2000);
}

function canvasLanguageFor(filename: string): "python" | "javascript" | "html" {
  const ext = extensionFor(filename);
  if (ext === "py") return "python";
  if (ext === "html" || ext === "htm") return "html";
  return "javascript";
}
