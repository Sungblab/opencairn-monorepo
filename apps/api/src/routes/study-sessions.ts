import { randomUUID } from "node:crypto";
import { Hono, type MiddlewareHandler } from "hono";
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

export interface StudySessionRepository {
  listSessionsByProject(
    scope: ProjectScope,
    filters?: { sourceNoteId?: string },
  ): Promise<StudySession[]>;
  createSession(input: CreateSessionInput): Promise<StudySession>;
  findSessionById(id: string): Promise<StudySession | null>;
  listRecordings(sessionId: string): Promise<SessionRecording[]>;
  listTranscriptSegments(sessionId: string): Promise<TranscriptSegment[]>;
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
  canReadProject?: (userId: string, projectId: string) => Promise<boolean>;
  canWriteProject?: (userId: string, projectId: string) => Promise<boolean>;
  projectScope?: (projectId: string) => Promise<ProjectScope | null>;
}

const projectParamSchema = z.object({ projectId: z.string().uuid() });
const sessionParamSchema = z.object({ id: z.string().uuid() });

export function createStudySessionRoutes(options: StudySessionRouteOptions = {}) {
  const repo = options.repo ?? createDrizzleStudySessionRepository();
  const auth = options.auth ?? requireAuth;
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
        if (!(await canReadProject(userId, projectId))) {
          return c.json({ error: "Forbidden" }, 403);
        }
        const scope = await projectScope(projectId);
        if (!scope) return c.json({ error: "project_not_found" }, 404);
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
        if (!(await canWriteProject(userId, body.projectId))) {
          return c.json({ error: "Forbidden" }, 403);
        }
        const scope = await projectScope(body.projectId);
        if (!scope) return c.json({ error: "project_not_found" }, 404);
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
        if (!(await canReadProject(c.get("userId"), session.projectId))) {
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
        if (!(await canReadProject(c.get("userId"), session.projectId))) {
          return c.json({ error: "Forbidden" }, 403);
        }
        return c.json({ recordings: await repo.listRecordings(session.id) });
      },
    )
    .get(
      "/study-sessions/:id/transcript",
      auth,
      zValidator("param", sessionParamSchema),
      async (c) => {
        const session = await repo.findSessionById(c.req.valid("param").id);
        if (!session) return c.json({ error: "study_session_not_found" }, 404);
        if (!(await canReadProject(c.get("userId"), session.projectId))) {
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

export function createDrizzleStudySessionRepository(conn: DB = db): StudySessionRepository {
  return {
    async listSessionsByProject(scope, filters) {
      let sessionRows = await conn
        .select()
        .from(studySessions)
        .where(
          and(
            eq(studySessions.workspaceId, scope.workspaceId),
            eq(studySessions.projectId, scope.projectId),
          ),
        )
        .orderBy(desc(studySessions.updatedAt));
      if (filters?.sourceNoteId) {
        const sourceRows = await conn
          .select({ sessionId: studySessionSources.sessionId })
          .from(studySessionSources)
          .where(eq(studySessionSources.noteId, filters.sourceNoteId));
        const allowedIds = new Set(sourceRows.map((row) => row.sessionId));
        sessionRows = sessionRows.filter((row) => allowedIds.has(row.id));
      }
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
      const recordings = await conn
        .select({ id: sessionRecordings.id })
        .from(sessionRecordings)
        .where(eq(sessionRecordings.sessionId, sessionId))
        .orderBy(asc(sessionRecordings.createdAt), asc(sessionRecordings.id));
      if (recordings.length === 0) return [];
      const recordingOrder = new Map(
        recordings.map((recording, index) => [recording.id, index]),
      );
      const rows = await conn
        .select()
        .from(transcriptSegments)
        .where(inArray(transcriptSegments.recordingId, recordings.map((row) => row.id)))
        .orderBy(asc(transcriptSegments.recordingId), asc(transcriptSegments.index));
      return rows
        .map(serializeTranscriptRow)
        .sort((a, b) =>
          (recordingOrder.get(a.recordingId) ?? 0) - (recordingOrder.get(b.recordingId) ?? 0)
          || a.index - b.index
          || a.startSec - b.startSec,
        );
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
