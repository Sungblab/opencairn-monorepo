import { randomUUID } from "node:crypto";
import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import {
  createStudySessionRequestSchema,
  listStudySessionsQuerySchema,
  type SessionRecording,
  type StudySession,
  type StudySessionSource,
  type TranscriptSegment,
} from "@opencairn/shared";
import {
  and,
  asc,
  db,
  desc,
  eq,
  inArray,
  notes,
  projects,
  sessionRecordings,
  studySessionSources,
  studySessions,
  transcriptSegments,
  type DB,
} from "@opencairn/db";
import { requireAuth } from "../middleware/auth";
import { canRead, canWrite } from "../lib/permissions";
import { uploadObject as defaultUploadObject } from "../lib/s3";
import { getTemporalClient, taskQueue } from "../lib/temporal-client";
import type { AppEnv } from "../lib/types";

interface ProjectScope {
  workspaceId: string;
  projectId: string;
}

interface CreateSessionInput extends ProjectScope {
  actorUserId: string;
  title?: string;
  sourceNoteId?: string;
}

interface CreateRecordingInput {
  sessionId: string;
  objectKey: string;
  mimeType: string;
  durationSec?: number | null;
  createdBy: string;
}

interface RecordingScope {
  recording: SessionRecording;
  session: StudySession;
}

interface CompleteTranscriptInput {
  recordingId: string;
  durationSec?: number | null;
  status: "ready" | "failed";
  segments?: Array<{
    index: number;
    startSec: number;
    endSec: number;
    text: string;
    speaker?: string | null;
    language?: string | null;
    confidence?: number | null;
  }>;
}

export interface StudySessionRepository {
  listSessionsByProject(
    scope: ProjectScope,
    filters?: { sourceNoteId?: string },
  ): Promise<StudySession[]>;
  createSession(input: CreateSessionInput): Promise<StudySession>;
  findSessionById(id: string): Promise<StudySession | null>;
  listRecordings(sessionId: string): Promise<SessionRecording[]>;
  listTranscriptSegments(sessionId: string): Promise<TranscriptSegment[]>;
  createRecording(input: CreateRecordingInput): Promise<SessionRecording>;
  markRecordingFailed(recordingId: string): Promise<void>;
  findRecordingScope(recordingId: string): Promise<RecordingScope | null>;
  completeTranscript(input: CompleteTranscriptInput): Promise<SessionRecording | null>;
}

export class StudySessionError extends Error {
  constructor(
    public code: string,
    public status = 400,
    message = code,
  ) {
    super(message);
    this.name = "StudySessionError";
  }
}

export interface StudySessionRouteOptions {
  repo?: StudySessionRepository;
  auth?: MiddlewareHandler<AppEnv>;
  canReadWorkspace?: (userId: string, workspaceId: string) => Promise<boolean>;
  canReadProject?: (userId: string, projectId: string) => Promise<boolean>;
  canWriteProject?: (userId: string, projectId: string) => Promise<boolean>;
  projectScope?: (projectId: string) => Promise<ProjectScope | null>;
  uploadObject?: (key: string, data: Buffer, contentType: string) => Promise<string>;
  startRecordingWorkflow?: (input: RecordingWorkflowInput) => Promise<string>;
}

const projectParamSchema = z.object({ projectId: z.string().uuid() });
const sessionParamSchema = z.object({ id: z.string().uuid() });
const recordingParamSchema = z.object({ recordingId: z.string().uuid() });
const MAX_RECORDING_UPLOAD = parsePositiveInt(
  process.env.MAX_STUDY_RECORDING_BYTES,
  parsePositiveInt(process.env.MAX_AUDIO_VIDEO_BYTES, 500 * 1024 * 1024),
);

interface RecordingWorkflowInput {
  recordingId: string;
  sessionId: string;
  workspaceId: string;
  projectId: string;
  userId: string;
  objectKey: string;
  mimeType: string;
}

const transcriptCallbackSchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid(),
  sessionId: z.string().uuid(),
  durationSec: z.number().nonnegative().nullable().optional(),
  status: z.enum(["ready", "failed"]),
  error: z.string().max(1000).optional(),
  segments: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        startSec: z.number().nonnegative(),
        endSec: z.number().nonnegative(),
        text: z.string().trim().min(1),
        speaker: z.string().nullable().optional(),
        language: z.string().nullable().optional(),
        confidence: z.number().nullable().optional(),
      }),
    )
    .default([]),
});

export function createStudySessionRoutes(options: StudySessionRouteOptions = {}) {
  const repo = options.repo ?? createDrizzleStudySessionRepository();
  const auth = options.auth ?? requireAuth;
  const uploadObject = options.uploadObject ?? defaultUploadObject;
  const startRecordingWorkflow = options.startRecordingWorkflow ?? startStudyRecordingWorkflow;
  const canReadWorkspace = options.canReadWorkspace ?? ((userId, workspaceId) =>
    canRead(userId, { type: "workspace", id: workspaceId }));
  const canReadProject = options.canReadProject ?? ((userId, projectId) =>
    canRead(userId, { type: "project", id: projectId }));
  const canWriteProject = options.canWriteProject ?? ((userId, projectId) =>
    canWrite(userId, { type: "project", id: projectId }));
  const projectScope = options.projectScope ?? readProjectScope;

  return new Hono<AppEnv>()
    .get(
      "/projects/:projectId/study-sessions",
      auth,
      zValidator("param", projectParamSchema),
      zValidator("query", listStudySessionsQuerySchema),
      async (c) => {
        const userId = c.get("userId");
        const projectId = c.req.valid("param").projectId;
        const scope = await projectScope(projectId);
        if (!scope || !(await canReadWorkspace(userId, scope.workspaceId))) {
          return c.json({ error: "project_not_found" }, 404);
        }
        if (!(await canReadProject(userId, projectId))) {
          return c.json({ error: "Forbidden" }, 403);
        }
        const sessions = await repo.listSessionsByProject(
          scope,
          c.req.valid("query"),
        );
        return c.json({ sessions });
      },
    )
    .post(
      "/study-sessions",
      auth,
      zValidator("json", createStudySessionRequestSchema),
      async (c) => {
        const userId = c.get("userId");
        const body = c.req.valid("json");
        const scope = await projectScope(body.projectId);
        if (!scope || !(await canReadWorkspace(userId, scope.workspaceId))) {
          return c.json({ error: "project_not_found" }, 404);
        }
        if (!(await canWriteProject(userId, body.projectId))) {
          return c.json({ error: "Forbidden" }, 403);
        }
        try {
          const session = await repo.createSession({
            ...scope,
            actorUserId: userId,
            title: body.title,
            sourceNoteId: body.sourceNoteId,
          });
          return c.json({ session }, 201);
        } catch (err) {
          return studySessionError(c, err);
        }
      },
    )
    .get(
      "/study-sessions/:id",
      auth,
      zValidator("param", sessionParamSchema),
      async (c) => {
        const session = await repo.findSessionById(c.req.valid("param").id);
        if (!session) return c.json({ error: "study_session_not_found" }, 404);
        const userId = c.get("userId");
        if (!(await canReadWorkspace(userId, session.workspaceId))) {
          return c.json({ error: "study_session_not_found" }, 404);
        }
        if (!(await canReadProject(userId, session.projectId))) {
          return c.json({ error: "Forbidden" }, 403);
        }
        return c.json({ session });
      },
    )
    .get(
      "/study-sessions/:id/recordings",
      auth,
      zValidator("param", sessionParamSchema),
      async (c) => {
        const session = await repo.findSessionById(c.req.valid("param").id);
        if (!session) return c.json({ error: "study_session_not_found" }, 404);
        const userId = c.get("userId");
        if (!(await canReadWorkspace(userId, session.workspaceId))) {
          return c.json({ error: "study_session_not_found" }, 404);
        }
        if (!(await canReadProject(userId, session.projectId))) {
          return c.json({ error: "Forbidden" }, 403);
        }
        return c.json({ recordings: await repo.listRecordings(session.id) });
      },
    )
    .post(
      "/study-sessions/:id/recordings/upload",
      auth,
      zValidator("param", sessionParamSchema),
      bodyLimit({
        maxSize: MAX_RECORDING_UPLOAD,
        onError: (c) => c.json({ error: "recording_too_large" }, 413),
      }),
      async (c) => {
        const session = await repo.findSessionById(c.req.valid("param").id);
        if (!session) return c.json({ error: "study_session_not_found" }, 404);
        const userId = c.get("userId");
        if (!(await canReadWorkspace(userId, session.workspaceId))) {
          return c.json({ error: "study_session_not_found" }, 404);
        }
        if (!(await canWriteProject(userId, session.projectId))) {
          return c.json({ error: "Forbidden" }, 403);
        }

        const body = await c.req.parseBody();
        const file = body["file"];
        if (!(file instanceof File)) return c.json({ error: "file_required" }, 400);
        const mimeType = file.type || "";
        if (!isRecordingMime(mimeType)) {
          return c.json({ error: "unsupported_recording_type" }, 415);
        }
        if (file.size > MAX_RECORDING_UPLOAD) {
          return c.json({ error: "recording_too_large" }, 413);
        }

        const durationSec = parseOptionalDuration(body["durationSec"]);
        if (durationSec === false) {
          return c.json({ error: "durationSec must be a nonnegative number" }, 400);
        }
        const objectKey = `study-sessions/${session.id}/recordings/${userId}/${randomUUID()}.${safeExtension(file.name)}`;
        const buffer = Buffer.from(await file.arrayBuffer());
        await uploadObject(objectKey, buffer, mimeType);

        const recording = await repo.createRecording({
          sessionId: session.id,
          objectKey,
          mimeType,
          durationSec,
          createdBy: userId,
        });

        try {
          const workflowId = await startRecordingWorkflow({
            recordingId: recording.id,
            sessionId: session.id,
            workspaceId: session.workspaceId,
            projectId: session.projectId,
            userId,
            objectKey,
            mimeType,
          });
          return c.json({ recording, workflowId }, 202);
        } catch (err) {
          await repo.markRecordingFailed(recording.id);
          console.error("[study-sessions] recording workflow start failed", err);
          return c.json({ error: "recording_processing_start_failed" }, 503);
        }
      },
    )
    .get(
      "/study-sessions/:id/transcript",
      auth,
      zValidator("param", sessionParamSchema),
      async (c) => {
        const session = await repo.findSessionById(c.req.valid("param").id);
        if (!session) return c.json({ error: "study_session_not_found" }, 404);
        const userId = c.get("userId");
        if (!(await canReadWorkspace(userId, session.workspaceId))) {
          return c.json({ error: "study_session_not_found" }, 404);
        }
        if (!(await canReadProject(userId, session.projectId))) {
          return c.json({ error: "Forbidden" }, 403);
        }
        const segments = await repo.listTranscriptSegments(session.id);
        return c.json({
          sessionId: session.id,
          text: segments.map((segment) => segment.text).join(" "),
          segments,
        });
      },
    );
}

export const studySessionRoutes = createStudySessionRoutes();

export function createStudySessionInternalRoutes(
  options: { repo?: StudySessionRepository } = {},
) {
  const repo = options.repo ?? createDrizzleStudySessionRepository();
  return new Hono<AppEnv>().post(
    "/study-sessions/recordings/:recordingId/transcript",
    zValidator("param", recordingParamSchema),
    zValidator("json", transcriptCallbackSchema),
    async (c) => {
      const recordingId = c.req.valid("param").recordingId;
      const body = c.req.valid("json");
      const scope = await repo.findRecordingScope(recordingId);
      if (!scope) return c.json({ error: "recording_not_found" }, 404);
      if (
        scope.session.workspaceId !== body.workspaceId
        || scope.session.projectId !== body.projectId
        || scope.session.id !== body.sessionId
      ) {
        return c.json({ error: "recording_scope_mismatch" }, 403);
      }
      const recording = await repo.completeTranscript({
        recordingId,
        durationSec: body.durationSec,
        status: body.status,
        segments: body.status === "ready" ? body.segments : [],
      });
      if (!recording) return c.json({ error: "recording_not_found" }, 404);
      return c.json({ ok: true, recording });
    },
  );
}

export function createDrizzleStudySessionRepository(conn: DB = db): StudySessionRepository {
  return {
    async listSessionsByProject(scope, filters) {
      const sessionRows = await conn
        .select()
        .from(studySessions)
        .where(
          and(
            eq(studySessions.workspaceId, scope.workspaceId),
            eq(studySessions.projectId, scope.projectId),
            filters?.sourceNoteId
              ? inArray(
                  studySessions.id,
                  conn
                    .select({ sessionId: studySessionSources.sessionId })
                    .from(studySessionSources)
                    .where(eq(studySessionSources.noteId, filters.sourceNoteId)),
                )
              : undefined,
          ),
        )
        .orderBy(desc(studySessions.updatedAt));
      return attachSources(conn, sessionRows.map(serializeSessionRow));
    },
    async createSession(input) {
      if (input.sourceNoteId) {
        const [sourceNote] = await conn
          .select({ id: notes.id })
          .from(notes)
          .where(
            and(
              eq(notes.id, input.sourceNoteId),
              eq(notes.workspaceId, input.workspaceId),
              eq(notes.projectId, input.projectId),
            ),
          )
          .limit(1);
        if (!sourceNote) throw new StudySessionError("source_note_not_found", 404);
      }
      return conn.transaction(async (tx) => {
        const [session] = await tx
          .insert(studySessions)
          .values({
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            title: input.title ?? "",
            createdBy: input.actorUserId,
          })
          .returning();
        let sources: StudySessionSource[] = [];
        if (input.sourceNoteId) {
          const [source] = await tx
            .insert(studySessionSources)
            .values({
              sessionId: session.id,
              noteId: input.sourceNoteId,
              role: "primary_pdf",
            })
            .returning();
          sources = [serializeSourceRow(source)];
        }
        return { ...serializeSessionRow(session), sources };
      });
    },
    async findSessionById(id) {
      const [session] = await conn
        .select()
        .from(studySessions)
        .where(eq(studySessions.id, id))
        .limit(1);
      if (!session) return null;
      const [withSources] = await attachSources(conn, [serializeSessionRow(session)]);
      return withSources ?? null;
    },
    async listRecordings(sessionId) {
      const rows = await conn
        .select()
        .from(sessionRecordings)
        .where(eq(sessionRecordings.sessionId, sessionId))
        .orderBy(desc(sessionRecordings.createdAt));
      return rows.map(serializeRecordingRow);
    },
    async listTranscriptSegments(sessionId) {
      const rows = await conn
        .select({ segment: transcriptSegments })
        .from(transcriptSegments)
        .innerJoin(
          sessionRecordings,
          eq(transcriptSegments.recordingId, sessionRecordings.id),
        )
        .where(eq(sessionRecordings.sessionId, sessionId))
        .orderBy(
          asc(sessionRecordings.createdAt),
          asc(sessionRecordings.id),
          asc(transcriptSegments.index),
          asc(transcriptSegments.startSec),
        );
      return rows.map((row) => serializeTranscriptRow(row.segment));
    },
    async createRecording(input) {
      return conn.transaction(async (tx) => {
        const [recording] = await tx
          .insert(sessionRecordings)
          .values({
            sessionId: input.sessionId,
            objectKey: input.objectKey,
            mimeType: input.mimeType,
            durationSec: input.durationSec ?? null,
            status: "processing",
            transcriptStatus: "processing",
            createdBy: input.createdBy,
          })
          .returning();
        await tx
          .update(studySessions)
          .set({ status: "processing", updatedAt: new Date() })
          .where(eq(studySessions.id, input.sessionId));
        return serializeRecordingRow(recording);
      });
    },
    async markRecordingFailed(recordingId) {
      await conn
        .update(sessionRecordings)
        .set({
          status: "failed",
          transcriptStatus: "failed",
          updatedAt: new Date(),
        })
        .where(eq(sessionRecordings.id, recordingId));
    },
    async findRecordingScope(recordingId) {
      const [row] = await conn
        .select({ recording: sessionRecordings, session: studySessions })
        .from(sessionRecordings)
        .innerJoin(studySessions, eq(sessionRecordings.sessionId, studySessions.id))
        .where(eq(sessionRecordings.id, recordingId))
        .limit(1);
      if (!row) return null;
      const [session] = await attachSources(conn, [serializeSessionRow(row.session)]);
      return {
        recording: serializeRecordingRow(row.recording),
        session: session!,
      };
    },
    async completeTranscript(input) {
      return conn.transaction(async (tx) => {
        await tx
          .delete(transcriptSegments)
          .where(eq(transcriptSegments.recordingId, input.recordingId));
        if (input.status === "ready" && input.segments?.length) {
          await tx.insert(transcriptSegments).values(
            input.segments.map((segment) => ({
              recordingId: input.recordingId,
              index: segment.index,
              startSec: segment.startSec,
              endSec: segment.endSec,
              text: segment.text,
              speaker: segment.speaker ?? null,
              language: segment.language ?? null,
              confidence: segment.confidence ?? null,
            })),
          );
        }
        const [recording] = await tx
          .update(sessionRecordings)
          .set({
            durationSec: input.durationSec ?? undefined,
            status: input.status,
            transcriptStatus: input.status,
            updatedAt: new Date(),
          })
          .where(eq(sessionRecordings.id, input.recordingId))
          .returning();
        if (!recording) return null;
        await tx
          .update(studySessions)
          .set({
            status: input.status === "ready" ? "ready" : "active",
            updatedAt: new Date(),
          })
          .where(eq(studySessions.id, recording.sessionId));
        return serializeRecordingRow(recording);
      });
    },
  };
}

async function attachSources(conn: DB, sessions: StudySession[]): Promise<StudySession[]> {
  if (sessions.length === 0) return [];
  const sources = await conn
    .select()
    .from(studySessionSources)
    .where(inArray(studySessionSources.sessionId, sessions.map((row) => row.id)));
  const bySession = new Map<string, StudySessionSource[]>();
  for (const source of sources) {
    const bucket = bySession.get(source.sessionId) ?? [];
    bucket.push(serializeSourceRow(source));
    bySession.set(source.sessionId, bucket);
  }
  return sessions.map((session) => ({
    ...session,
    sources: bySession.get(session.id) ?? [],
  }));
}

async function readProjectScope(projectId: string): Promise<ProjectScope | null> {
  const [project] = await db
    .select({ id: projects.id, workspaceId: projects.workspaceId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return project ? { workspaceId: project.workspaceId, projectId: project.id } : null;
}

function serializeDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function serializeSessionRow(row: typeof studySessions.$inferSelect): StudySession {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    title: row.title,
    status: row.status,
    startedAt: serializeDate(row.startedAt),
    endedAt: serializeDate(row.endedAt),
    createdBy: row.createdBy,
    createdAt: serializeDate(row.createdAt)!,
    updatedAt: serializeDate(row.updatedAt)!,
    sources: [],
  };
}

function serializeSourceRow(row: typeof studySessionSources.$inferSelect): StudySessionSource {
  return {
    id: row.id,
    sessionId: row.sessionId,
    noteId: row.noteId,
    role: row.role,
    createdAt: serializeDate(row.createdAt)!,
  };
}

function serializeRecordingRow(row: typeof sessionRecordings.$inferSelect): SessionRecording {
  return {
    id: row.id,
    sessionId: row.sessionId,
    objectKey: row.objectKey,
    mimeType: row.mimeType,
    durationSec: row.durationSec,
    status: row.status,
    transcriptStatus: row.transcriptStatus,
    createdBy: row.createdBy,
    createdAt: serializeDate(row.createdAt)!,
    updatedAt: serializeDate(row.updatedAt)!,
  };
}

function serializeTranscriptRow(row: typeof transcriptSegments.$inferSelect): TranscriptSegment {
  return {
    id: row.id,
    recordingId: row.recordingId,
    index: row.index,
    startSec: row.startSec,
    endSec: row.endSec,
    text: row.text,
    speaker: row.speaker,
    language: row.language,
    confidence: row.confidence,
    createdAt: serializeDate(row.createdAt)!,
  };
}

function studySessionError(c: import("hono").Context<AppEnv>, err: unknown): Response {
  if (err instanceof StudySessionError) {
    return c.json(
      { error: err.code, message: err.message },
      err.status as 400 | 403 | 404 | 409 | 500,
    );
  }
  console.error("[study-sessions] unhandled error", err);
  return c.json({ error: "study_session_failed" }, 503);
}

async function startStudyRecordingWorkflow(input: RecordingWorkflowInput): Promise<string> {
  const workflowId = `study-session-recording/${input.recordingId}`;
  const client = await getTemporalClient();
  await client.workflow.start("StudySessionRecordingWorkflow", {
    taskQueue: taskQueue(),
    workflowId,
    args: [
      {
        recording_id: input.recordingId,
        session_id: input.sessionId,
        workspace_id: input.workspaceId,
        project_id: input.projectId,
        user_id: input.userId,
        object_key: input.objectKey,
        mime_type: input.mimeType,
      },
    ],
  });
  return workflowId;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isRecordingMime(mimeType: string): boolean {
  return mimeType.startsWith("audio/") || mimeType.startsWith("video/");
}

function safeExtension(filename: string): string {
  const ext = filename.includes(".") ? filename.split(".").pop() : undefined;
  const normalized = (ext || "webm").toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalized || "webm";
}

function parseOptionalDuration(value: FormDataEntryValue | FormDataEntryValue[] | undefined): number | null | false {
  if (value === undefined || value === null || Array.isArray(value)) return null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : false;
}

type SeedRecordingInput = Omit<
  SessionRecording,
  "id" | "createdBy" | "createdAt" | "updatedAt" | "durationSec"
> & {
  id?: string;
  durationSec?: number | null;
  createdBy?: string;
};

export interface MemoryStudySessionRepository extends StudySessionRepository {
  seedRecording(input: SeedRecordingInput): SessionRecording;
  seedTranscriptSegments(
    recordingId: string,
    input: Array<{
      index: number;
      startSec: number;
      endSec: number;
      text: string;
      speaker?: string | null;
      language?: string | null;
      confidence?: number | null;
    }>,
  ): TranscriptSegment[];
}

export function createMemoryStudySessionRepository(): MemoryStudySessionRepository {
  const sessions = new Map<string, StudySession>();
  const recordings = new Map<string, SessionRecording>();
  const segments = new Map<string, TranscriptSegment[]>();

  const repo: MemoryStudySessionRepository = {
    async listSessionsByProject(scope, filters) {
      return [...sessions.values()]
        .filter((session) =>
          session.workspaceId === scope.workspaceId
          && session.projectId === scope.projectId
          && (!filters?.sourceNoteId
            || session.sources.some((source) => source.noteId === filters.sourceNoteId)),
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async createSession(input) {
      const now = new Date().toISOString();
      const id = randomUUID();
      const source = input.sourceNoteId
        ? {
            id: randomUUID(),
            sessionId: id,
            noteId: input.sourceNoteId,
            role: "primary_pdf" as const,
            createdAt: now,
          }
        : null;
      const session: StudySession = {
        id,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        title: input.title ?? "",
        status: "active",
        startedAt: now,
        endedAt: null,
        createdBy: input.actorUserId,
        createdAt: now,
        updatedAt: now,
        sources: source ? [source] : [],
      };
      sessions.set(id, session);
      return session;
    },
    async findSessionById(id) {
      return sessions.get(id) ?? null;
    },
    async listRecordings(sessionId) {
      return [...recordings.values()]
        .filter((recording) => recording.sessionId === sessionId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async listTranscriptSegments(sessionId) {
      const sessionRecordings = await this.listRecordings(sessionId);
      return sessionRecordings.flatMap((recording) =>
        (segments.get(recording.id) ?? []).sort((a, b) => a.index - b.index),
      );
    },
    async createRecording(input) {
      const now = new Date().toISOString();
      const recording: SessionRecording = {
        id: randomUUID(),
        sessionId: input.sessionId,
        objectKey: input.objectKey,
        mimeType: input.mimeType,
        durationSec: input.durationSec ?? null,
        status: "processing",
        transcriptStatus: "processing",
        createdBy: input.createdBy,
        createdAt: now,
        updatedAt: now,
      };
      recordings.set(recording.id, recording);
      const session = sessions.get(input.sessionId);
      if (session) sessions.set(session.id, { ...session, status: "processing", updatedAt: now });
      return recording;
    },
    async markRecordingFailed(recordingId) {
      const recording = recordings.get(recordingId);
      if (!recording) return;
      recordings.set(recordingId, {
        ...recording,
        status: "failed",
        transcriptStatus: "failed",
        updatedAt: new Date().toISOString(),
      });
    },
    async findRecordingScope(recordingId) {
      const recording = recordings.get(recordingId);
      if (!recording) return null;
      const session = sessions.get(recording.sessionId);
      return session ? { recording, session } : null;
    },
    async completeTranscript(input) {
      const recording = recordings.get(input.recordingId);
      if (!recording) return null;
      const now = new Date().toISOString();
      const updated: SessionRecording = {
        ...recording,
        durationSec: input.durationSec ?? recording.durationSec,
        status: input.status,
        transcriptStatus: input.status,
        updatedAt: now,
      };
      recordings.set(input.recordingId, updated);
      segments.set(
        input.recordingId,
        (input.segments ?? []).map((segment) => ({
          id: randomUUID(),
          recordingId: input.recordingId,
          index: segment.index,
          startSec: segment.startSec,
          endSec: segment.endSec,
          text: segment.text,
          speaker: segment.speaker ?? null,
          language: segment.language ?? null,
          confidence: segment.confidence ?? null,
          createdAt: now,
        })),
      );
      const session = sessions.get(recording.sessionId);
      if (session) {
        sessions.set(session.id, {
          ...session,
          status: input.status === "ready" ? "ready" : "active",
          updatedAt: now,
        });
      }
      return updated;
    },
    seedRecording(input) {
      const now = new Date().toISOString();
      const recording: SessionRecording = {
        id: input.id ?? randomUUID(),
        sessionId: input.sessionId,
        objectKey: input.objectKey,
        mimeType: input.mimeType,
        durationSec: input.durationSec ?? null,
        status: input.status,
        transcriptStatus: input.transcriptStatus,
        createdBy: input.createdBy ?? "user-1",
        createdAt: now,
        updatedAt: now,
      };
      recordings.set(recording.id, recording);
      return recording;
    },
    seedTranscriptSegments(recordingId, input) {
      const now = new Date().toISOString();
      const rows = input.map((segment) => ({
        id: randomUUID(),
        recordingId,
        index: segment.index,
        startSec: segment.startSec,
        endSec: segment.endSec,
        text: segment.text,
        speaker: segment.speaker ?? null,
        language: segment.language ?? null,
        confidence: segment.confidence ?? null,
        createdAt: now,
      }));
      segments.set(recordingId, rows);
      return rows;
    },
  };
  return repo;
}
