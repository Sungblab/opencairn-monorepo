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

const INTERNAL_SECRET =
  process.env.INTERNAL_API_SECRET ?? "test-internal-secret-plan8-agents";
process.env.INTERNAL_API_SECRET = INTERNAL_SECRET;

const app = createApp();

async function authedGet(path: string, userId: string): Promise<Response> {
  return app.request(path, {
    method: "GET",
    headers: { cookie: await signSessionCookie(userId) },
  });
}

async function internalRequest(
  path: string,
  init: RequestInit,
): Promise<Response> {
  return app.request(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Secret": INTERNAL_SECRET,
      ...init.headers,
    },
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
    await db.insert(suggestions).values({
      userId: seed.userId,
      projectId: seed.projectId,
      type: "synthesis_insight",
      payload: { title: "already handled" },
      status: "accepted",
      resolvedAt: new Date(),
    });
    await db.insert(staleAlerts).values({
      noteId: seed.noteId,
      stalenessScore: 0.82,
      reason: "older source detected",
    });
    await db.insert(staleAlerts).values({
      noteId: seed.noteId,
      stalenessScore: 0.21,
      reason: "already reviewed",
      reviewedAt: new Date(),
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
    expect(body.suggestions).toHaveLength(1);
    expect(body.staleAlerts[0]).toMatchObject({
      noteId: seed.noteId,
      stalenessScore: 0.82,
    });
    expect(body.staleAlerts).toHaveLength(1);
    expect(body.audioFiles[0]).toMatchObject({
      noteId: seed.noteId,
      durationSec: 73,
    });
    expect(body.audioFiles[0]!.urlPath).toMatch(
      /^\/api\/agents\/plan8\/audio-files\/.+\/file$/,
    );
  });

  it("projects worker agent run callbacks into the Agents overview", async () => {
    seed = await seedWorkspace({ role: "owner" });
    const workflowId = "synthesis-callback-test";

    const start = await internalRequest("/api/internal/agent-runs", {
      method: "POST",
      body: JSON.stringify({
        workspaceId: seed.workspaceId,
        projectId: seed.projectId,
        userId: seed.userId,
        agentName: "synthesis",
        workflowId,
        trajectoryUri: "file:///tmp/synthesis-callback-test.ndjson",
      }),
    });
    expect(start.status).toBe(201);

    const finish = await internalRequest(
      `/api/internal/agent-runs/${workflowId}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          agentName: "synthesis",
          status: "completed",
          totalCostKrw: 12,
          trajectoryBytes: 2048,
        }),
      },
    );
    expect(finish.status).toBe(200);

    const overview = await authedGet(
      `/api/agents/plan8/overview?projectId=${seed.projectId}`,
      seed.userId,
    );
    expect(overview.status).toBe(200);
    const body = (await overview.json()) as {
      agentRuns: Array<{
        agentName: string;
        workflowId: string;
        status: string;
        totalCostKrw: number;
      }>;
    };
    expect(body.agentRuns).toMatchObject([
      {
        agentName: "synthesis",
        workflowId,
        status: "completed",
        totalCostKrw: 12,
      },
    ]);
  });

  it("resolves own project suggestions through the Plan 8 API", async () => {
    seed = await seedWorkspace({ role: "owner" });
    const [suggestion] = await db
      .insert(suggestions)
      .values({
        userId: seed.userId,
        projectId: seed.projectId,
        type: "connector_link",
        payload: { source: "A", target: "B" },
        status: "pending",
      })
      .returning({ id: suggestions.id });

    const res = await app.request(
      `/api/agents/plan8/suggestions/${suggestion.id}`,
      {
        method: "PATCH",
        headers: {
          cookie: await signSessionCookie(seed.userId),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "accepted" }),
      },
    );
    expect(res.status).toBe(200);

    const overview = await authedGet(
      `/api/agents/plan8/overview?projectId=${seed.projectId}`,
      seed.userId,
    );
    const body = (await overview.json()) as { suggestions: unknown[] };
    expect(body.suggestions).toHaveLength(0);
  });

  it("marks readable stale alerts as reviewed through the Plan 8 API", async () => {
    seed = await seedWorkspace({ role: "owner" });
    const [alert] = await db
      .insert(staleAlerts)
      .values({
        noteId: seed.noteId,
        stalenessScore: 0.71,
        reason: "needs review",
      })
      .returning({ id: staleAlerts.id });

    const res = await app.request(
      `/api/agents/plan8/stale-alerts/${alert.id}/review`,
      {
        method: "PATCH",
        headers: { cookie: await signSessionCookie(seed.userId) },
      },
    );
    expect(res.status).toBe(200);

    const overview = await authedGet(
      `/api/agents/plan8/overview?projectId=${seed.projectId}`,
      seed.userId,
    );
    const body = (await overview.json()) as { staleAlerts: unknown[] };
    expect(body.staleAlerts).toHaveLength(0);
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
