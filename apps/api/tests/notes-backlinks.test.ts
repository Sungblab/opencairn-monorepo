import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../src/app.js";
import {
  db,
  notes,
  projects,
  workspaces,
  user,
  wikiLinks,
  workspaceMembers,
  eq,
} from "@opencairn/db";
import { signSessionCookie } from "./helpers/session.js";

describe("GET /api/notes/:id/backlinks", () => {
  let workspaceId: string;
  let projectId: string;
  let memberId: string;
  let nonMemberId: string;
  let target: string;
  let sourceLive: string;
  const app = createApp();

  beforeAll(async () => {
    await db.transaction(async (tx) => {
      const [m] = await tx.insert(user).values({
        id: crypto.randomUUID(),
        email: `bl-m-${crypto.randomUUID().slice(0, 8)}@example.com`,
        name: "m",
        emailVerified: false,
      }).returning();
      memberId = m.id;
      const [nm] = await tx.insert(user).values({
        id: crypto.randomUUID(),
        email: `bl-nm-${crypto.randomUUID().slice(0, 8)}@example.com`,
        name: "nm",
        emailVerified: false,
      }).returning();
      nonMemberId = nm.id;

      const [ws] = await tx.insert(workspaces).values({
        name: "BL",
        slug: `bl-${crypto.randomUUID().slice(0, 8)}`,
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

      const [t] = await tx.insert(notes).values({
        title: "Target",
        projectId,
        workspaceId,
      }).returning();
      target = t.id;
      const [s1] = await tx.insert(notes).values({
        title: "Live source",
        projectId,
        workspaceId,
      }).returning();
      sourceLive = s1.id;
      const [s2] = await tx.insert(notes).values({
        title: "Deleted source",
        projectId,
        workspaceId,
        deletedAt: new Date(),
      }).returning();

      await tx.insert(wikiLinks).values([
        { sourceNoteId: sourceLive, targetNoteId: target, workspaceId },
        { sourceNoteId: s2.id, targetNoteId: target, workspaceId },
      ]);
    });
  });

  afterAll(async () => {
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(user).where(eq(user.id, memberId));
    await db.delete(user).where(eq(user.id, nonMemberId));
  });

  it("returns 403 for a non-member", async () => {
    const res = await app.request(
      `/api/notes/${target}/backlinks`,
      { method: "GET", headers: { cookie: await signSessionCookie(nonMemberId) } },
    );
    expect(res.status).toBe(403);
  });

  it("excludes soft-deleted source notes", async () => {
    const res = await app.request(
      `/api/notes/${target}/backlinks`,
      { method: "GET", headers: { cookie: await signSessionCookie(memberId) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ id: string; title: string; projectName: string; updatedAt: string }>;
      total: number;
    };
    expect(body.total).toBe(1);
    expect(body.data[0]?.id).toBe(sourceLive);
    expect(body.data[0]?.title).toBe("Live source");
    expect(body.data[0]?.projectName).toBe("P");
  });

  it("returns empty data for a note with no backlinks", async () => {
    const [orphan] = await db.insert(notes).values({
      title: "Orphan",
      projectId,
      workspaceId,
    }).returning();
    const res = await app.request(
      `/api/notes/${orphan.id}/backlinks`,
      { method: "GET", headers: { cookie: await signSessionCookie(memberId) } },
    );
    const body = (await res.json()) as { data: unknown[]; total: number };
    expect(body.total).toBe(0);
    expect(body.data).toHaveLength(0);
  });
});
