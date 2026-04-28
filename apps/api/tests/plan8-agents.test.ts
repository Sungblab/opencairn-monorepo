import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import {
  agentRuns,
  audioFiles,
  concepts,
  db,
  eq,
  projectPermissions,
  staleAlerts,
  suggestions,
  user,
  workspaceMembers,
} from "@opencairn/db";
import {
  createUser,
  seedWorkspace,
  setNoteInherit,
  type SeedResult,
} from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

const app = createApp();

async function authedGet(path: string, userId: string): Promise<Response> {
  return app.request(path, {
    method: "GET",
    headers: { cookie: await signSessionCookie(userId) },
  });
}

describe("Plan 8 agent entrypoint overview", () => {
  let seed: SeedResult | undefined;

  afterEach(async () => {
    await db
      .delete(audioFiles)
      .where(eq(audioFiles.r2Key, "agent-entrypoints-test.mp3"));
    if (seed) await seed.cleanup();
    seed = undefined;
  });

  it("returns project-scoped runs, suggestions, stale alerts, audio files, and launch options", async () => {
    seed = await seedWorkspace({ role: "owner" });

    await db.insert(concepts).values({
      projectId: seed.projectId,
      name: "Retrieval",
      description: "retrieval concept",
    });
    await db.insert(agentRuns).values({
      workspaceId: seed.workspaceId,
      projectId: seed.projectId,
      userId: seed.userId,
      agentName: "synthesis",
      workflowId: "synthesis-test-workflow",
      status: "completed",
      trajectoryUri: "memory://synthesis-test",
    });
    await db.insert(suggestions).values({
      userId: seed.userId,
      projectId: seed.projectId,
      type: "connector_link",
      payload: { source: "A", target: "B" },
      status: "pending",
    });
    await db.insert(staleAlerts).values({
      noteId: seed.noteId,
      stalenessScore: 0.82,
      reason: "older source detected",
    });
    await db.insert(audioFiles).values({
      noteId: seed.noteId,
      r2Key: "agent-entrypoints-test.mp3",
      durationSec: 73,
      voices: [{ name: "Kore", style: "host" }],
    });

    const res = await authedGet(
      `/api/agents/plan8/overview?projectId=${seed.projectId}`,
      seed.userId,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      launch: {
        notes: Array<{ id: string; title: string }>;
        concepts: Array<{ name: string }>;
      };
      agentRuns: Array<{ agentName: string; workflowId: string }>;
      suggestions: Array<{ type: string; payload: Record<string, unknown> }>;
      staleAlerts: Array<{ noteId: string; stalenessScore: number }>;
      audioFiles: Array<{ noteId: string; durationSec: number; urlPath: string }>;
    };

    expect(body.launch.notes.map((note) => note.id)).toContain(seed.noteId);
    expect(body.launch.concepts.map((concept) => concept.name)).toContain(
      "Retrieval",
    );
    expect(body.agentRuns).toMatchObject([
      { agentName: "synthesis", workflowId: "synthesis-test-workflow" },
    ]);
    expect(body.suggestions[0]).toMatchObject({
      type: "connector_link",
      payload: { source: "A", target: "B" },
    });
    expect(body.staleAlerts[0]).toMatchObject({
      noteId: seed.noteId,
      stalenessScore: 0.82,
    });
    expect(body.audioFiles[0]).toMatchObject({
      noteId: seed.noteId,
      durationSec: 73,
    });
    expect(body.audioFiles[0]!.urlPath).toMatch(
      /^\/api\/agents\/plan8\/audio-files\/.+\/file$/,
    );
  });

  it("does not expose project data to a user without project access", async () => {
    seed = await seedWorkspace({ role: "owner" });
    const other = await seedWorkspace({ role: "owner" });
    try {
      const res = await authedGet(
        `/api/agents/plan8/overview?projectId=${seed.projectId}`,
        other.userId,
      );
      expect(res.status).toBe(403);
    } finally {
      await other.cleanup();
    }
  });

  it("filters note-bound artifacts through per-note permissions", async () => {
    seed = await seedWorkspace({ role: "owner" });
    await setNoteInherit(seed.noteId, false);
    const viewer = await createUser();
    await db.insert(workspaceMembers).values({
      workspaceId: seed.workspaceId,
      userId: viewer.id,
      role: "member",
    });
    await db.insert(projectPermissions).values({
      projectId: seed.projectId,
      userId: viewer.id,
      role: "viewer",
    });
    await db.insert(staleAlerts).values({
      noteId: seed.noteId,
      stalenessScore: 0.91,
      reason: "private stale note",
    });
    await db.insert(audioFiles).values({
      noteId: seed.noteId,
      r2Key: "agent-entrypoints-test.mp3",
      durationSec: 45,
    });

    try {
      const res = await authedGet(
        `/api/agents/plan8/overview?projectId=${seed.projectId}`,
        viewer.id,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        launch: { notes: unknown[] };
        staleAlerts: unknown[];
        audioFiles: unknown[];
      };
      expect(body.launch.notes).toHaveLength(0);
      expect(body.staleAlerts).toHaveLength(0);
      expect(body.audioFiles).toHaveLength(0);
    } finally {
      await db.delete(user).where(eq(user.id, viewer.id));
    }
  });
});
