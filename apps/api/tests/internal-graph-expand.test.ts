import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import {
  db,
  concepts,
  conceptEdges,
  projects,
  eq,
} from "@opencairn/db";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";

const SECRET = "test-internal-secret-graph-expand";
process.env.INTERNAL_API_SECRET = SECRET;

const app = createApp();

async function postExpand(
  projectId: string,
  body: unknown,
  withSecret = true,
): Promise<Response> {
  return app.request(
    `/api/internal/projects/${projectId}/graph/expand`,
    {
      method: "POST",
      headers: {
        ...(withSecret ? { "X-Internal-Secret": SECRET } : {}),
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
}

// Local helper: insert a seed concept + N neighbour concepts + 1-hop edges
// from the seed to each neighbour. Mirrors the plan's `seedConceptWithEdges`
// fixture; kept inline because the rest of `tests/helpers/seed.ts` doesn't
// own concept-graph fixtures yet.
async function seedConceptWithEdges(
  projectId: string,
  neighbourCount: number,
): Promise<{ conceptId: string; neighborIds: string[] }> {
  const conceptId = randomUUID();
  await db.insert(concepts).values({
    id: conceptId,
    projectId,
    name: `seed-${conceptId.slice(0, 6)}`,
    description: "seed",
  });
  const neighborIds: string[] = [];
  for (let i = 0; i < neighbourCount; i += 1) {
    const id = randomUUID();
    neighborIds.push(id);
    await db.insert(concepts).values({
      id,
      projectId,
      name: `nbr-${i}-${id.slice(0, 6)}`,
      description: `neighbour ${i}`,
    });
    await db.insert(conceptEdges).values({
      sourceId: conceptId,
      targetId: id,
      relationType: "related-to",
      weight: 1,
    });
  }
  return { conceptId, neighborIds };
}

describe("POST /api/internal/projects/:id/graph/expand", () => {
  let ctx: SeedResult;
  let other: SeedResult;

  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "owner" });
    other = await seedWorkspace({ role: "owner" });
  });

  afterEach(async () => {
    await ctx.cleanup();
    await other.cleanup();
  });

  it("returns 401 without internal secret header", async () => {
    const res = await postExpand(
      ctx.projectId,
      {
        conceptId: randomUUID(),
        hops: 1,
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
      },
      false,
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 when hops > 3", async () => {
    const res = await postExpand(ctx.projectId, {
      conceptId: randomUUID(),
      hops: 4,
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
    });
    expect(res.status).toBe(400);
  });

  it("returns 403 when workspaceId mismatches project", async () => {
    const res = await postExpand(ctx.projectId, {
      conceptId: randomUUID(),
      hops: 1,
      workspaceId: other.workspaceId, // mismatched — belongs to other project
      userId: ctx.userId,
    });
    expect(res.status).toBe(403);
  });

  it("returns 404 when concept belongs to a different project", async () => {
    // Spin up a second project inside ctx's workspace and create the concept
    // there. The request targets ctx.projectId, so the seed-belongs-to-project
    // guard must reject with 404 (NOT 200 with a wrong-project subgraph).
    const otherProjectId = randomUUID();
    await db.insert(projects).values({
      id: otherProjectId,
      workspaceId: ctx.workspaceId,
      name: "Other Project",
      createdBy: ctx.ownerUserId,
    });
    const { conceptId } = await seedConceptWithEdges(otherProjectId, 1);

    try {
      const res = await postExpand(ctx.projectId, {
        conceptId,
        hops: 1,
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
      });
      expect(res.status).toBe(404);
    } finally {
      // workspace cleanup CASCADEs both projects, so concept rows go with it.
      // Explicit project delete here just keeps the test isolated in case
      // afterEach order ever changes.
      await db.delete(projects).where(eq(projects.id, otherProjectId));
    }
  });

  it("returns 200 with nodes + edges for valid 1-hop expand", async () => {
    const { conceptId, neighborIds } = await seedConceptWithEdges(
      ctx.projectId,
      3,
    );

    const res = await postExpand(ctx.projectId, {
      conceptId,
      hops: 1,
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      nodes: Array<{ id: string; name: string; description: string }>;
      edges: Array<{
        id: string;
        sourceId: string;
        targetId: string;
        relationType: string;
        weight: number;
      }>;
    };
    const nodeIds = body.nodes.map((n) => n.id);
    expect(nodeIds).toContain(conceptId);
    for (const n of neighborIds) {
      expect(nodeIds).toContain(n);
    }
    expect(Array.isArray(body.edges)).toBe(true);
    // Each seeded neighbour got one edge from the seed; expect at least
    // those edges (the BFS may also surface incidental edges among
    // neighbours, but here we created none, so equal is fine).
    expect(body.edges.length).toBe(neighborIds.length);
  });
});
