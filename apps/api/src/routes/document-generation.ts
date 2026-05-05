import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import {
  agentFiles,
  chatThreads,
  db,
  desc,
  eq,
  and,
  inArray,
  isNull,
  notes,
  or,
  projects,
  researchRuns,
  synthesisDocuments,
  synthesisRuns,
} from "@opencairn/db";
import {
  generateProjectObjectActionSchema,
  type DocumentGenerationSource,
} from "@opencairn/shared";
import { requireAuth } from "../middleware/auth";
import { AgentActionError } from "../lib/agent-actions";
import {
  requestDocumentGenerationProjectObject,
  type DocumentGenerationActionServiceOptions,
} from "../lib/document-generation-actions";
import { canWrite } from "../lib/permissions";
import type { AppEnv } from "../lib/types";

const projectParamSchema = z.object({ projectId: z.string().uuid() });
const SOURCE_LIST_LIMIT = 25;
const TEXT_LIKE_AGENT_FILE_KINDS = new Set([
  "markdown",
  "text",
  "latex",
  "html",
  "code",
  "json",
  "csv",
]);
const EXTRACTABLE_AGENT_FILE_KINDS = new Set(["pdf", "docx", "pptx", "xlsx"]);
const SOURCE_EXTRACTION_MAX_BYTES = 25 * 1024 * 1024;

type DocumentGenerationSourceType = DocumentGenerationSource["type"];
type SourceQualitySignal =
  | "metadata_fallback"
  | "unsupported_source"
  | "source_oversized";

export interface DocumentGenerationSourceOption {
  id: string;
  type: DocumentGenerationSourceType;
  title: string;
  subtitle?: string;
  source: DocumentGenerationSource;
  qualitySignals?: SourceQualitySignal[];
}

export type ListDocumentGenerationSourceOptions = (
  projectId: string,
  userId: string,
) => Promise<DocumentGenerationSourceOption[]>;

export interface DocumentGenerationRouteOptions extends DocumentGenerationActionServiceOptions {
  auth?: MiddlewareHandler<AppEnv>;
  listSourceOptions?: ListDocumentGenerationSourceOptions;
}

export function createDocumentGenerationRoutes(options?: DocumentGenerationRouteOptions) {
  const auth = options?.auth ?? requireAuth;
  const serviceOptions: DocumentGenerationActionServiceOptions = {
    ...(options?.repo ? { repo: options.repo } : {}),
    ...(options?.canWriteProject ? { canWriteProject: options.canWriteProject } : {}),
    ...(options?.startDocumentGeneration ? { startDocumentGeneration: options.startDocumentGeneration } : {}),
  };

  const listSourceOptions =
    options?.listSourceOptions ?? listDocumentGenerationSourceOptions;

  return new Hono<AppEnv>()
    .get(
      "/projects/:projectId/document-generation/sources",
      auth,
      zValidator("param", projectParamSchema),
      async (c) => {
        const { projectId } = c.req.valid("param");
        const userId = c.get("userId");
        const canWriteProject =
          options?.canWriteProject ??
          ((actorUserId: string, id: string) =>
            canWrite(actorUserId, { type: "project", id }));
        if (!(await canWriteProject(userId, projectId))) {
          return c.json({ error: "forbidden" }, 403);
        }
        const sources = await listSourceOptions(projectId, userId);
        return c.json({ sources });
      },
    )
    .post(
      "/projects/:projectId/project-object-actions/generate",
      auth,
      zValidator("param", projectParamSchema),
      zValidator("json", generateProjectObjectActionSchema),
      async (c) => {
        try {
          const result = await requestDocumentGenerationProjectObject(
            c.req.valid("param").projectId,
            c.get("userId"),
            c.req.valid("json"),
            serviceOptions,
          );
          return c.json(result, result.idempotent ? 200 : 202);
        } catch (err) {
          return documentGenerationError(c, err);
        }
      },
    );
}

export const documentGenerationRoutes = createDocumentGenerationRoutes();

function documentGenerationError(c: import("hono").Context<AppEnv>, err: unknown): Response {
  if (err instanceof AgentActionError) {
    return c.json({ error: err.code, message: err.message }, err.status);
  }
  console.error("[document-generation] unhandled error", err);
  return c.json({ error: "document_generation_start_failed" }, 503);
}

async function listDocumentGenerationSourceOptions(
  projectId: string,
  userId: string,
): Promise<DocumentGenerationSourceOption[]> {
  const [project] = await db
    .select({ workspaceId: projects.workspaceId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) return [];

  // These are independent project-object families, each with its own scope and
  // per-type newest-first limit. A join would either multiply unrelated rows or
  // lose the per-source-family limit semantics, so keep the reads separate and
  // parallelize the round-trips.
  const [noteRows, fileRows, threadRows, researchRows, synthesisRows] =
    await Promise.all([
      db
        .select({
          id: notes.id,
          title: notes.title,
          type: notes.type,
          sourceType: notes.sourceType,
          updatedAt: notes.updatedAt,
        })
        .from(notes)
        .where(and(eq(notes.projectId, projectId), isNull(notes.deletedAt)))
        .orderBy(desc(notes.updatedAt))
        .limit(SOURCE_LIST_LIMIT),
      db
        .select({
          id: agentFiles.id,
          title: agentFiles.title,
          filename: agentFiles.filename,
          kind: agentFiles.kind,
          mimeType: agentFiles.mimeType,
          bytes: agentFiles.bytes,
          updatedAt: agentFiles.updatedAt,
        })
        .from(agentFiles)
        .where(and(eq(agentFiles.projectId, projectId), isNull(agentFiles.deletedAt)))
        .orderBy(desc(agentFiles.updatedAt))
        .limit(SOURCE_LIST_LIMIT),
      db
        .select({
          id: chatThreads.id,
          title: chatThreads.title,
          updatedAt: chatThreads.updatedAt,
        })
        .from(chatThreads)
        .where(
          and(
            eq(chatThreads.workspaceId, project.workspaceId),
            eq(chatThreads.userId, userId),
            isNull(chatThreads.archivedAt),
          ),
        )
        .orderBy(desc(chatThreads.updatedAt))
        .limit(SOURCE_LIST_LIMIT),
      db
        .select({
          id: researchRuns.id,
          topic: researchRuns.topic,
          status: researchRuns.status,
          updatedAt: researchRuns.updatedAt,
        })
        .from(researchRuns)
        .where(eq(researchRuns.projectId, projectId))
        .orderBy(desc(researchRuns.updatedAt))
        .limit(SOURCE_LIST_LIMIT),
      db
        .select({
          id: synthesisRuns.id,
          userPrompt: synthesisRuns.userPrompt,
          status: synthesisRuns.status,
          format: synthesisRuns.format,
          updatedAt: synthesisRuns.updatedAt,
        })
        .from(synthesisRuns)
        .where(
          and(
            eq(synthesisRuns.workspaceId, project.workspaceId),
            or(eq(synthesisRuns.projectId, projectId), isNull(synthesisRuns.projectId)),
          ),
        )
        .orderBy(desc(synthesisRuns.updatedAt))
        .limit(SOURCE_LIST_LIMIT),
    ]);

  const synthesisRunIds = synthesisRows.map((row) => row.id);
  const documentRows = synthesisRunIds.length
    ? await db
        .select({
          id: synthesisDocuments.id,
          runId: synthesisDocuments.runId,
          format: synthesisDocuments.format,
          bytes: synthesisDocuments.bytes,
          createdAt: synthesisDocuments.createdAt,
        })
        .from(synthesisDocuments)
        .where(inArray(synthesisDocuments.runId, synthesisRunIds))
        .orderBy(desc(synthesisDocuments.createdAt))
    : [];
  const latestDocumentByRun = new Map<string, typeof documentRows[number]>();
  for (const row of documentRows) {
    if (!latestDocumentByRun.has(row.runId)) latestDocumentByRun.set(row.runId, row);
  }

  return [
    ...noteRows.map((row): DocumentGenerationSourceOption => ({
      id: `note:${row.id}`,
      type: "note",
      title: row.title || "Untitled",
      subtitle: row.sourceType ?? row.type,
      source: { type: "note", noteId: row.id },
    })),
    ...fileRows.map((row): DocumentGenerationSourceOption => ({
      id: `agent_file:${row.id}`,
      type: "agent_file",
      title: row.title || row.filename,
      subtitle: `${row.filename} · ${row.kind}`,
      source: { type: "agent_file", objectId: row.id },
      ...qualityForAgentFile(row.kind, row.bytes),
    })),
    ...threadRows.map((row): DocumentGenerationSourceOption => ({
      id: `chat_thread:${row.id}`,
      type: "chat_thread",
      title: row.title || "Chat thread",
      subtitle: "chat_thread",
      source: { type: "chat_thread", threadId: row.id },
    })),
    ...researchRows.map((row): DocumentGenerationSourceOption => ({
      id: `research_run:${row.id}`,
      type: "research_run",
      title: row.topic,
      subtitle: `research_run · ${row.status}`,
      source: { type: "research_run", runId: row.id },
    })),
    ...synthesisRows.map((row): DocumentGenerationSourceOption => {
      const document = latestDocumentByRun.get(row.id);
      return {
        id: `synthesis_run:${row.id}`,
        type: "synthesis_run",
        title: row.userPrompt.slice(0, 96) || "Synthesis run",
        subtitle: `synthesis_run · ${row.status} · ${row.format}`,
        source: {
          type: "synthesis_run",
          runId: row.id,
          ...(document ? { documentId: document.id } : {}),
        },
        ...(document && document.bytes && document.bytes > SOURCE_EXTRACTION_MAX_BYTES
          ? { qualitySignals: ["source_oversized", "metadata_fallback"] as SourceQualitySignal[] }
          : {}),
      };
    }),
  ];
}

function qualityForAgentFile(kind: string, bytes: number | null) {
  const signals: SourceQualitySignal[] = [];
  if (bytes !== null && bytes > SOURCE_EXTRACTION_MAX_BYTES) {
    signals.push("source_oversized", "metadata_fallback");
  } else if (!TEXT_LIKE_AGENT_FILE_KINDS.has(kind) && !EXTRACTABLE_AGENT_FILE_KINDS.has(kind)) {
    signals.push("unsupported_source", "metadata_fallback");
  }
  return signals.length ? { qualitySignals: signals } : {};
}
