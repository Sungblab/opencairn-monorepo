import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../src/app.js";
import {
  db,
  notes,
  projects,
  workspaces,
  user,
  concepts,
  conceptEdges,
  conceptNotes,
  workspaceMembers,
  eq,
} from "@opencairn/db";
import { signSessionCookie } from "./helpers/session.js";

describe("GET /api/projects/:projectId/graph", () => {
  let workspaceId: string;
  let projectId: string;
  let otherProjectId: string;
  let memberId: string;
  let nonMemberId: string;
  let conceptA: string;
  let conceptB: string;
  const app = createApp();

  beforeAll(async () => {
    await db.transaction(async (tx) => {
      const [m] = await tx
        .insert(user)
        .values({
          id: crypto.randomUUID(),
          email: `g-m-${crypto.randomUUID().slice(0, 8)}@example.com`,
          name: "m",
          emailVerified: false,
        })
        .returning();
      memberId = m.id;
      const [nm] = await tx
        .insert(user)
        .values({
          id: crypto.randomUUID(),
          email: `g-nm-${crypto.randomUUID().slice(0, 8)}@example.com`,
          name: "nm",
          emailVerified: false,
        })
        .returning();
      nonMemberId = nm.id;

      const [ws] = await tx
        .insert(workspaces)
        .values({ name: "G", slug: `g-${crypto.randomUUID().slice(0, 8)}`, ownerId: memberId })
        .returning();
      workspaceId = ws.id;
      await tx
        .insert(workspaceMembers)
        .values({ workspaceId, userId: memberId, role: "owner" });

      const [p] = await tx
        .insert(projects)
        .values({ name: "P", workspaceId, createdBy: memberId })
        .returning();
      projectId = p.id;
      const [op] = await tx
        .insert(projects)
        .values({ name: "Other", workspaceId, createdBy: memberId })
        .returning();
      otherProjectId = op.id;

      const [n] = await tx
        .insert(notes)
        .values({ title: "src", projectId, workspaceId })
        .returning();
      const [a] = await tx
        .insert(concepts)
        .values({ projectId, name: "A", description: "alpha" })
        .returning();
      const [b] = await tx
        .insert(concepts)
        .values({ projectId, name: "B", description: "beta" })
        .returning();
      conceptA = a.id;
      conceptB = b.id;
      await tx
        .insert(conceptEdges)
        .values({ sourceId: a.id, targetId: b.id, relationType: "is-a", weight: 1 });
      await tx
        .insert(conceptNotes)
        .values({ conceptId: a.id, noteId: n.id });
    });
  });

  afterAll(async () => {
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(user).where(eq(user.id, memberId));
    await db.delete(user).where(eq(user.id, nonMemberId));
  });

  it("returns 403 for a non-member", async () => {
    const res = await app.request(`/api/projects/${projectId}/graph`, {
      method: "GET",
      headers: { cookie: await signSessionCookie(nonMemberId) },
    });
    expect(res.status).toBe(403);
  });

  it("returns nodes + edges for a member", async () => {
    const res = await app.request(`/api/projects/${projectId}/graph`, {
      method: "GET",
      headers: { cookie: await signSessionCookie(memberId) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      nodes: Array<{
        id: string;
        name: string;
        description: string;
        degree: number;
        noteCount: number;
        firstNoteId: string | null;
      }>;
      edges: Array<{ id: string; sourceId: string; targetId: string; relationType: string; weight: number }>;
      truncated: boolean;
      totalConcepts: number;
    };
    expect(body.nodes).toHaveLength(2);
    expect(body.edges).toHaveLength(1);
    expect(body.truncated).toBe(false);
    expect(body.totalConcepts).toBe(2);
    const nodeA = body.nodes.find((n) => n.id === conceptA);
    expect(nodeA?.firstNoteId).toBeTruthy();
    expect(nodeA?.degree).toBe(1);
    expect(nodeA?.noteCount).toBe(1);
    const nodeB = body.nodes.find((n) => n.id === conceptB);
    expect(nodeB?.firstNoteId).toBeNull();
  });

  it("filters edges by relation", async () => {
    const res = await app.request(
      `/api/projects/${projectId}/graph?relation=does-not-exist`,
      {
        method: "GET",
        headers: { cookie: await signSessionCookie(memberId) },
      },
    );
    const body = (await res.json()) as { edges: unknown[] };
    expect(body.edges).toHaveLength(0);
  });

  it("returns empty result for an empty project", async () => {
    const res = await app.request(`/api/projects/${otherProjectId}/graph`, {
      method: "GET",
      headers: { cookie: await signSessionCookie(memberId) },
    });
    const body = (await res.json()) as { nodes: unknown[]; edges: unknown[]; totalConcepts: number };
    expect(body.nodes).toHaveLength(0);
    expect(body.edges).toHaveLength(0);
    expect(body.totalConcepts).toBe(0);
  });
});
