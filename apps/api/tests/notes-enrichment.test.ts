import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../src/app.js";
import {
  db,
  notes,
  noteEnrichments,
  projects,
  workspaces,
  user,
  workspaceMembers,
  eq,
} from "@opencairn/db";
import { signSessionCookie } from "./helpers/session.js";

describe("GET /api/notes/:id/enrichment", () => {
  let workspaceId: string;
  let projectId: string;
  let memberId: string;
  let nonMemberId: string;
  let noteWithArtifact: string;
  let noteWithout: string;
  const app = createApp();

  beforeAll(async () => {
    await db.transaction(async (tx) => {
      const [m] = await tx.insert(user).values({
        id: crypto.randomUUID(),
        email: `enr-m-${crypto.randomUUID().slice(0, 8)}@example.com`,
        name: "m",
        emailVerified: false,
      }).returning();
      memberId = m.id;
      const [nm] = await tx.insert(user).values({
        id: crypto.randomUUID(),
        email: `enr-nm-${crypto.randomUUID().slice(0, 8)}@example.com`,
        name: "nm",
        emailVerified: false,
      }).returning();
      nonMemberId = nm.id;

      const [ws] = await tx.insert(workspaces).values({
        name: "ENR",
        slug: `enr-${crypto.randomUUID().slice(0, 8)}`,
        ownerId: memberId,
      }).returning();
      workspaceId = ws.id;
      await tx.insert(workspaceMembers).values({
        workspaceId,
        userId: memberId,
        role: "owner",
      });
      const [p] = await tx.insert(projects).values({
        name: "P",
        workspaceId,
        createdBy: memberId,
      }).returning();
      projectId = p.id;

      const [n1] = await tx.insert(notes).values({
        title: "Paper",
        projectId,
        workspaceId,
      }).returning();
      noteWithArtifact = n1.id;
      const [n2] = await tx.insert(notes).values({
        title: "Plain",
        projectId,
        workspaceId,
      }).returning();
      noteWithout = n2.id;

      await tx.insert(noteEnrichments).values({
        noteId: noteWithArtifact,
        workspaceId,
        contentType: "paper",
        status: "done",
        provider: "gemini",
        skipReasons: [],
        artifact: {
          outline: [
            { level: 1, title: "Introduction", page: 3 },
          ],
          word_count: 4200,
        },
      });
    });
  });

  afterAll(async () => {
    await db.delete(noteEnrichments).where(eq(noteEnrichments.workspaceId, workspaceId));
    await db.delete(notes).where(eq(notes.workspaceId, workspaceId));
    await db.delete(projects).where(eq(projects.workspaceId, workspaceId));
    await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId));
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(user).where(eq(user.id, memberId));
    await db.delete(user).where(eq(user.id, nonMemberId));
  });

  it("returns the artifact row for a workspace member", async () => {
    const res = await app.request(
      `/api/notes/${noteWithArtifact}/enrichment`,
      { method: "GET", headers: { cookie: await signSessionCookie(memberId) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      noteId: string;
      contentType: string;
      status: string;
      artifact: Record<string, unknown> | null;
      skipReasons: string[];
    };
    expect(body.noteId).toBe(noteWithArtifact);
    expect(body.contentType).toBe("paper");
    expect(body.status).toBe("done");
    expect(body.artifact).toMatchObject({ word_count: 4200 });
    expect(body.skipReasons).toEqual([]);
  });

  it("returns 404 when no enrichment row exists", async () => {
    const res = await app.request(
      `/api/notes/${noteWithout}/enrichment`,
      { method: "GET", headers: { cookie: await signSessionCookie(memberId) } },
    );
    expect(res.status).toBe(404);
  });

  it("returns 403 for a non-member", async () => {
    const res = await app.request(
      `/api/notes/${noteWithArtifact}/enrichment`,
      { method: "GET", headers: { cookie: await signSessionCookie(nonMemberId) } },
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 on a non-uuid id (registered before /:id catch-all)", async () => {
    const res = await app.request(
      `/api/notes/not-a-uuid/enrichment`,
      { method: "GET", headers: { cookie: await signSessionCookie(memberId) } },
    );
    expect(res.status).toBe(400);
  });
});
