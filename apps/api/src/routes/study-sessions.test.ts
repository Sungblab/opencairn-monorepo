import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  StudySession,
  StudySessionTranscriptResponse,
} from "@opencairn/shared";
import {
  db,
  eq,
  notes,
  projects,
  studySessionSources,
  user,
  workspaces,
} from "@opencairn/db";
import type { AppEnv } from "../lib/types";
import {
  createDrizzleStudySessionRepository,
  createStudySessionInternalRoutes,
  createMemoryStudySessionRepository,
  createStudySessionRoutes,
  StudySessionError,
} from "./study-sessions";

const userId = "user-1";
const workspaceId = "00000000-0000-4000-8000-000000000001";
const projectId = "00000000-0000-4000-8000-000000000002";
const sourceNoteId = "00000000-0000-4000-8000-000000000003";

function appWith(options?: {
  canReadWorkspace?: (uid: string, wid: string) => Promise<boolean>;
  canReadProject?: (uid: string, pid: string) => Promise<boolean>;
  canWriteProject?: (uid: string, pid: string) => Promise<boolean>;
  uploadObject?: (key: string, data: Buffer, contentType: string) => Promise<string>;
  streamObject?: (key: string) => Promise<{
    stream: ReadableStream<Uint8Array>;
    contentType: string;
    contentLength: number;
  }>;
  startRecordingWorkflow?: (input: {
    recordingId: string;
    sessionId: string;
    workspaceId: string;
    projectId: string;
    userId: string;
    objectKey: string;
    mimeType: string;
  }) => Promise<string>;
}) {
  const repo = createMemoryStudySessionRepository();
  const app = new Hono<AppEnv>().route(
    "/api",
    createStudySessionRoutes({
      repo,
      projectScope: async (pid) => pid === projectId ? { workspaceId, projectId } : null,
      canReadWorkspace: options?.canReadWorkspace ?? (async (_uid, wid) => wid === workspaceId),
      canReadProject: options?.canReadProject ?? (async (_uid, pid) => pid === projectId),
      canWriteProject: options?.canWriteProject ?? (async (_uid, pid) => pid === projectId),
      auth: async (c, next) => {
        c.set("userId", userId);
        c.set("user", { id: userId, email: "user@example.com", name: "User" });
        await next();
      },
      uploadObject: options?.uploadObject,
      streamObject: options?.streamObject,
      startRecordingWorkflow: options?.startRecordingWorkflow,
    }),
  );
  return { app, repo };
}

describe("study session routes", () => {
  it("creates, lists, and reads a project-scoped study session", async () => {
    const { app } = appWith();

    const create = await app.request("/api/study-sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId,
        sourceNoteId,
        title: "Linear algebra lecture",
      }),
    });

    expect(create.status).toBe(201);
    const created = await create.json() as { session: StudySession };
    expect(created.session).toMatchObject({
      workspaceId,
      projectId,
      title: "Linear algebra lecture",
      status: "active",
      createdBy: userId,
    });
    expect(created.session.sources).toEqual([
      expect.objectContaining({ noteId: sourceNoteId, role: "primary_pdf" }),
    ]);

    const list = await app.request(
      `/api/projects/${projectId}/study-sessions?sourceNoteId=${sourceNoteId}`,
    );
    expect(list.status).toBe(200);
    expect((await list.json() as { sessions: StudySession[] }).sessions).toHaveLength(1);

    const detail = await app.request(`/api/study-sessions/${created.session.id}`);
    expect(detail.status).toBe(200);
    expect((await detail.json() as { session: StudySession }).session.id).toBe(
      created.session.id,
    );
  });

  it("requires project write permission to create a session", async () => {
    const { app } = appWith({ canWriteProject: async () => false });

    const response = await app.request("/api/study-sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId, title: "Blocked" }),
    });

    expect(response.status).toBe(403);
  });

  it("hides project existence when the user is not a workspace member", async () => {
    const { app } = appWith({ canReadWorkspace: async () => false });

    const list = await app.request(`/api/projects/${projectId}/study-sessions`);
    expect(list.status).toBe(404);

    const create = await app.request("/api/study-sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId, title: "Hidden" }),
    });
    expect(create.status).toBe(404);
  });

  it("requires project read permission before exposing transcripts", async () => {
    const { app, repo } = appWith({ canReadProject: async () => false });
    const session = await repo.createSession({
      workspaceId,
      projectId,
      actorUserId: userId,
      title: "Hidden lecture",
      sourceNoteId,
    });
    const response = await app.request(`/api/study-sessions/${session.id}/transcript`);

    expect(response.status).toBe(403);
  });

  it("hides study session existence when the user is not a workspace member", async () => {
    const { app, repo } = appWith({ canReadWorkspace: async () => false });
    const session = await repo.createSession({
      workspaceId,
      projectId,
      actorUserId: userId,
      title: "Hidden lecture",
      sourceNoteId,
    });

    const detail = await app.request(`/api/study-sessions/${session.id}`);
    const recordings = await app.request(`/api/study-sessions/${session.id}/recordings`);
    const transcript = await app.request(`/api/study-sessions/${session.id}/transcript`);

    expect(detail.status).toBe(404);
    expect(recordings.status).toBe(404);
    expect(transcript.status).toBe(404);
  });

  it("returns ordered transcript segments for a session recording", async () => {
    const { app, repo } = appWith();
    const session = await repo.createSession({
      workspaceId,
      projectId,
      actorUserId: userId,
      title: "Recorded lecture",
      sourceNoteId,
    });
    const recording = repo.seedRecording({
      sessionId: session.id,
      objectKey: "uploads/user/lecture.webm",
      mimeType: "audio/webm",
      status: "ready",
      transcriptStatus: "ready",
    });
    repo.seedTranscriptSegments(recording.id, [
      { index: 0, startSec: 0, endSec: 2.5, text: "first idea" },
      { index: 1, startSec: 2.5, endSec: 5, text: "second idea" },
    ]);

    const response = await app.request(`/api/study-sessions/${session.id}/transcript`);

    expect(response.status).toBe(200);
    const body = await response.json() as StudySessionTranscriptResponse;
    expect(body.text).toBe("first idea second idea");
    expect(body.segments.map((segment) => [
      segment.recordingId,
      segment.index,
      segment.startSec,
      segment.endSec,
      segment.text,
    ])).toEqual([
      [recording.id, 0, 0, 2.5, "first idea"],
      [recording.id, 1, 2.5, 5, "second idea"],
    ]);
  });

  it("uploads a recording, attaches it to the session, and starts STT processing", async () => {
    const uploaded: Array<{ key: string; bytes: number; contentType: string }> = [];
    const started: unknown[] = [];
    const { app, repo } = appWith({
      uploadObject: async (key, data, contentType) => {
        uploaded.push({ key, bytes: data.length, contentType });
        return key;
      },
      startRecordingWorkflow: async (input) => {
        started.push(input);
        return `study-session-recording/${input.recordingId}`;
      },
    });
    const session = await repo.createSession({
      workspaceId,
      projectId,
      actorUserId: userId,
      title: "Recorded lecture",
      sourceNoteId,
    });
    const form = new FormData();
    form.set("file", new File(["audio-bytes"], "lecture.webm", { type: "audio/webm" }));
    form.set("durationSec", "12.5");

    const response = await app.request(
      `/api/study-sessions/${session.id}/recordings/upload`,
      { method: "POST", body: form },
    );

    expect(response.status).toBe(202);
    const body = await response.json() as { recording: { id: string; status: string; transcriptStatus: string; objectKey: string } };
    expect(body.recording).toMatchObject({
      sessionId: session.id,
      mimeType: "audio/webm",
      durationSec: 12.5,
      status: "processing",
      transcriptStatus: "processing",
    });
    expect(body.recording.objectKey).toMatch(
      new RegExp(`^study-sessions/${session.id}/recordings/${userId}/`),
    );
    expect(uploaded).toEqual([
      {
        key: body.recording.objectKey,
        bytes: "audio-bytes".length,
        contentType: "audio/webm",
      },
    ]);
    expect(started).toEqual([
      expect.objectContaining({
        recordingId: body.recording.id,
        sessionId: session.id,
        workspaceId,
        projectId,
        userId,
        objectKey: body.recording.objectKey,
        mimeType: "audio/webm",
      }),
    ]);

    const recordings = await app.request(`/api/study-sessions/${session.id}/recordings`);
    expect((await recordings.json() as { recordings: unknown[] }).recordings).toHaveLength(1);
  });

  it("requires project write permission before accepting a recording upload", async () => {
    const { app, repo } = appWith({ canWriteProject: async () => false });
    const session = await repo.createSession({
      workspaceId,
      projectId,
      actorUserId: userId,
      title: "Blocked lecture",
      sourceNoteId,
    });
    const form = new FormData();
    form.set("file", new File(["audio-bytes"], "lecture.webm", { type: "audio/webm" }));

    const response = await app.request(
      `/api/study-sessions/${session.id}/recordings/upload`,
      { method: "POST", body: form },
    );

    expect(response.status).toBe(403);
  });

  it("streams a ready recording only after session and project read checks", async () => {
    const streamed: string[] = [];
    const { app, repo } = appWith({
      streamObject: async (key) => {
        streamed.push(key);
        return {
          stream: new Response("audio-bytes").body!,
          contentType: "audio/webm",
          contentLength: "audio-bytes".length,
        };
      },
    });
    const session = await repo.createSession({
      workspaceId,
      projectId,
      actorUserId: userId,
      title: "Ready recording",
      sourceNoteId,
    });
    const recording = repo.seedRecording({
      sessionId: session.id,
      objectKey: "study-sessions/session/recordings/user/ready.webm",
      mimeType: "audio/webm",
      status: "ready",
      transcriptStatus: "ready",
    });

    const response = await app.request(
      `/api/study-sessions/${session.id}/recordings/${recording.id}/file`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/webm");
    expect(await response.text()).toBe("audio-bytes");
    expect(streamed).toEqual([recording.objectKey]);
  });

  it("does not stream recordings from another session path", async () => {
    const { app, repo } = appWith({
      streamObject: async () => {
        throw new Error("should not stream");
      },
    });
    const session = await repo.createSession({
      workspaceId,
      projectId,
      actorUserId: userId,
      title: "Ready recording",
      sourceNoteId,
    });
    const recording = repo.seedRecording({
      sessionId: session.id,
      objectKey: "study-sessions/session/recordings/user/ready.webm",
      mimeType: "audio/webm",
      status: "ready",
      transcriptStatus: "ready",
    });

    const response = await app.request(
      `/api/study-sessions/00000000-0000-4000-8000-999999999999/recordings/${recording.id}/file`,
    );

    expect(response.status).toBe(404);
  });

  it("stores transcript callback segments only when recording scope matches", async () => {
    const repo = createMemoryStudySessionRepository();
    const session = await repo.createSession({
      workspaceId,
      projectId,
      actorUserId: userId,
      title: "Recorded lecture",
      sourceNoteId,
    });
    const recording = repo.seedRecording({
      sessionId: session.id,
      objectKey: "study-sessions/session/recordings/user/lecture.webm",
      mimeType: "audio/webm",
      status: "processing",
      transcriptStatus: "processing",
    });
    const app = new Hono<AppEnv>().route(
      "/api/internal",
      createStudySessionInternalRoutes({ repo }),
    );

    const response = await app.request(
      `/api/internal/study-sessions/recordings/${recording.id}/transcript`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          projectId,
          sessionId: session.id,
          durationSec: 4.5,
          status: "ready",
          segments: [
            { index: 0, startSec: 0, endSec: 2.25, text: "first" },
            { index: 1, startSec: 2.25, endSec: 4.5, text: "second" },
          ],
        }),
      },
    );

    expect(response.status).toBe(200);
    const recordings = await repo.listRecordings(session.id);
    expect(recordings[0]).toMatchObject({
      id: recording.id,
      durationSec: 4.5,
      status: "ready",
      transcriptStatus: "ready",
    });
    const transcript = await repo.listTranscriptSegments(session.id);
    expect(transcript.map((segment) => segment.text)).toEqual(["first", "second"]);

    const mismatch = await app.request(
      `/api/internal/study-sessions/recordings/${recording.id}/transcript`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          projectId: "00000000-0000-4000-8000-999999999999",
          sessionId: session.id,
          status: "ready",
          segments: [],
        }),
      },
    );
    expect(mismatch.status).toBe(403);
  });

  it("validates source notes against the session project in the Drizzle repository", async () => {
    const repo = createDrizzleStudySessionRepository();
    const dbUserId = `study-session-${randomUUID()}`;
    const dbWorkspaceId = randomUUID();
    const dbProjectId = randomUUID();
    const otherProjectId = randomUUID();
    const sameProjectNoteId = randomUUID();
    const otherProjectNoteId = randomUUID();
    const slug = `study-${randomUUID().slice(0, 8)}`;

    try {
      await db.insert(user).values({
        id: dbUserId,
        name: "Study Session Test",
        email: `${dbUserId}@example.com`,
      });
      await db.insert(workspaces).values({
        id: dbWorkspaceId,
        slug,
        name: "Study Session Workspace",
        ownerId: dbUserId,
      });
      await db.insert(projects).values([
        {
          id: dbProjectId,
          workspaceId: dbWorkspaceId,
          name: "Study Session Project",
          createdBy: dbUserId,
        },
        {
          id: otherProjectId,
          workspaceId: dbWorkspaceId,
          name: "Other Project",
          createdBy: dbUserId,
        },
      ]);
      await db.insert(notes).values([
        {
          id: sameProjectNoteId,
          workspaceId: dbWorkspaceId,
          projectId: dbProjectId,
          title: "same.pdf",
        },
        {
          id: otherProjectNoteId,
          workspaceId: dbWorkspaceId,
          projectId: otherProjectId,
          title: "other.pdf",
        },
      ]);

      let rejected: unknown;
      try {
        await repo.createSession({
          workspaceId: dbWorkspaceId,
          projectId: dbProjectId,
          actorUserId: dbUserId,
          sourceNoteId: otherProjectNoteId,
        });
      } catch (err) {
        rejected = err;
      }
      expect(rejected).toBeInstanceOf(StudySessionError);
      expect(rejected).toMatchObject({
        code: "source_note_not_found",
        status: 404,
      });

      const session = await repo.createSession({
        workspaceId: dbWorkspaceId,
        projectId: dbProjectId,
        actorUserId: dbUserId,
        sourceNoteId: sameProjectNoteId,
      });
      const sourceRows = await db
        .select()
        .from(studySessionSources)
        .where(eq(studySessionSources.sessionId, session.id));

      expect(sourceRows).toHaveLength(1);
      expect(sourceRows[0]).toMatchObject({
        noteId: sameProjectNoteId,
        role: "primary_pdf",
      });
    } finally {
      await db.delete(workspaces).where(eq(workspaces.id, dbWorkspaceId));
      await db.delete(user).where(eq(user.id, dbUserId));
    }
  });
});
