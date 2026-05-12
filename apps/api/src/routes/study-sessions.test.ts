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
