import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import {
  db,
  concepts,
  conceptEdges,
  projects,
  user,
  eq,
} from "@opencairn/db";
import { seedWorkspace, createUser, type SeedResult } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

// ─── Plan 5 KG Phase 2 · Task 9 · GET /graph?view= integration ──────────
//
// Phase 1 (`tests/graph.test.ts`) already covers `view=graph` (default)
// behaviour. This file targets the four new branches plus the cross-cutting
// rules: auto-root selection for mindmap, cross-project root → 404,
// non-member → 403, and `view=graph` echo-fields regression coverage.

const app = createApp();

interface GraphSeed {
  hubId: string; // highest-degree concept (mindmap auto-root target)
  spokeIds: string[]; // direct neighbours of hub
  isolatedId: string; // concept with no edges (degree 0)
}

/**
 * Seed: 1 hub concept connected to N spokes (1-hop edges hub→spoke), plus
 * one isolated concept with no edges. Hub has degree N; spokes degree 1;
 * isolated degree 0. That makes `hubId` deterministically the max-degree
 * concept in the project for the auto-root mindmap test.
 *
 * Concepts are inserted one at a time so each row gets a unique
 * `created_at` (NOW() advances per statement) — needed by the timeline /
 * cards order assertions.
 */
async function seedHubAndSpokes(
  projectId: string,
  spokeCount: number,
): Promise<GraphSeed> {
  const hubId = randomUUID();
  await db.insert(concepts).values({
    id: hubId,
    projectId,
    name: `hub-${hubId.slice(0, 6)}`,
    description: "hub",
  });
  const spokeIds: string[] = [];
  for (let i = 0; i < spokeCount; i += 1) {
    const id = randomUUID();
    spokeIds.push(id);
    await db.insert(concepts).values({
      id,
      projectId,
      name: `spoke-${i}-${id.slice(0, 6)}`,
      description: `spoke ${i}`,
    });
    await db.insert(conceptEdges).values({
      sourceId: hubId,
      targetId: id,
      relationType: "related-to",
      weight: 1 + i, // ensure deterministic per-parent ordering by weight DESC
    });
  }
  const isolatedId = randomUUID();
  await db.insert(concepts).values({
    id: isolatedId,
    projectId,
    name: `iso-${isolatedId.slice(0, 6)}`,
    description: "isolated",
  });
  return { hubId, spokeIds, isolatedId };
}

interface GraphResponseBody {
  nodes: Array<{
    id: string;
    name: string;
    description: string;
    degree: number;
    noteCount: number;
    firstNoteId: string | null;
    createdAt?: string;
  }>;
  edges: Array<{
    id: string;
    sourceId: string;
    targetId: string;
    relationType: string;
    weight: number;
  }>;
  truncated: boolean;
  totalConcepts: number;
  viewType: string;
  layout: string;
  rootId: string | null;
}

async function getGraph(
  projectId: string,
  query: string,
  cookie: string,
): Promise<{ status: number; body: GraphResponseBody }> {
  const url = `/api/projects/${projectId}/graph${query}`;
  const res = await app.request(url, {
    method: "GET",
    headers: { cookie },
  });
  const body = (await res.json()) as GraphResponseBody;
  return { status: res.status, body };
}

describe("GET /api/projects/:id/graph?view=", () => {
  let ctx: SeedResult;
  let memberCookie: string;
  let seed: GraphSeed;

  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "owner" });
    memberCookie = await signSessionCookie(ctx.userId);
    // 5 spokes → hub degree 5; spokes degree 1; isolated degree 0 → 7 concepts.
    seed = await seedHubAndSpokes(ctx.projectId, 5);
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  // ─── Test 1: view=graph regression-zero ─────────────────────────────
  it("view=graph defaults to Phase 1 shape with new echo fields", async () => {
    const { status, body } = await getGraph(ctx.projectId, "", memberCookie);
    expect(status).toBe(200);
    // Phase 1 contract: nodes/edges/truncated/totalConcepts present.
    expect(Array.isArray(body.nodes)).toBe(true);
    expect(Array.isArray(body.edges)).toBe(true);
    expect(body.totalConcepts).toBe(7); // hub + 5 spokes + isolated
    expect(body.truncated).toBe(false);
    // Phase 2 echo fields.
    expect(body.viewType).toBe("graph");
    expect(body.layout).toBe("fcose");
    expect(body.rootId).toBeNull();
    // hub is in the result and carries degree 5.
    const hubNode = body.nodes.find((n) => n.id === seed.hubId);
    expect(hubNode?.degree).toBe(5);
    // 5 hub→spoke edges among the returned node set.
    expect(body.edges.length).toBe(5);
  });

  // ─── Test 2: mindmap with explicit root ────────────────────────────
  it("view=mindmap&root=<hubId> returns BFS tree with dagre layout", async () => {
    const { status, body } = await getGraph(
      ctx.projectId,
      `?view=mindmap&root=${seed.hubId}`,
      memberCookie,
    );
    expect(status).toBe(200);
    expect(body.viewType).toBe("mindmap");
    expect(body.layout).toBe("dagre");
    expect(body.rootId).toBe(seed.hubId);
    const ids = body.nodes.map((n) => n.id);
    expect(ids).toContain(seed.hubId);
    // All 5 spokes are within depth=1 + perParentCap=8, so all are present.
    for (const s of seed.spokeIds) {
      expect(ids).toContain(s);
    }
    // Isolated concept must NOT appear (BFS from hub doesn't reach it).
    expect(ids).not.toContain(seed.isolatedId);
    // Each spoke is connected to the hub via exactly 1 edge → 5 edges.
    expect(body.edges.length).toBe(5);
  });

  // ─── Test 3: mindmap auto-root selects max-degree concept ──────────
  it("view=mindmap (no root) auto-selects max-degree concept", async () => {
    const { status, body } = await getGraph(
      ctx.projectId,
      "?view=mindmap",
      memberCookie,
    );
    expect(status).toBe(200);
    // hub has degree 5, spokes degree 1, isolated degree 0 → hub wins.
    expect(body.rootId).toBe(seed.hubId);
    expect(body.viewType).toBe("mindmap");
    expect(body.layout).toBe("dagre");
  });

  // ─── Test 4: cross-project root → 404 ─────────────────────────────
  it("view=mindmap&root=<other-project-concept> returns 404", async () => {
    // Create a sibling project inside the same workspace and a concept there.
    const otherProjectId = randomUUID();
    await db.insert(projects).values({
      id: otherProjectId,
      workspaceId: ctx.workspaceId,
      name: "Other Project",
      createdBy: ctx.ownerUserId,
    });
    const orphanId = randomUUID();
    await db.insert(concepts).values({
      id: orphanId,
      projectId: otherProjectId,
      name: "orphan",
      description: "in the wrong project",
    });

    try {
      const { status } = await getGraph(
        ctx.projectId,
        `?view=mindmap&root=${orphanId}`,
        memberCookie,
      );
      expect(status).toBe(404);
    } finally {
      await db.delete(projects).where(eq(projects.id, otherProjectId));
    }
  });

  // ─── Test 5: cards by recency + relation edges ─────────────────────
  it("view=cards returns nodes by created_at DESC with intra-set edges", async () => {
    const { status, body } = await getGraph(
      ctx.projectId,
      "?view=cards",
      memberCookie,
    );
    expect(status).toBe(200);
    expect(body.viewType).toBe("cards");
    expect(body.layout).toBe("preset");
    expect(body.rootId).toBeNull();
    expect(body.edges.length).toBeGreaterThan(0);
    expect(body.edges.every((edge) => edge.relationType === "related-to")).toBe(
      true,
    );
    // Insertion order in seedHubAndSpokes was hub → spoke0..N → isolated.
    // created_at DESC means isolated first, then spokes in reverse, then hub.
    const ids = body.nodes.map((n) => n.id);
    expect(ids[0]).toBe(seed.isolatedId);
    expect(ids[ids.length - 1]).toBe(seed.hubId);
  });

  // ─── Test 6: timeline by created_at ASC ───────────────────────────
  it("view=timeline returns nodes by created_at ASC with empty edges", async () => {
    const { status, body } = await getGraph(
      ctx.projectId,
      "?view=timeline",
      memberCookie,
    );
    expect(status).toBe(200);
    expect(body.viewType).toBe("timeline");
    expect(body.layout).toBe("preset");
    expect(body.rootId).toBeNull();
    expect(body.edges).toEqual([]);
    // Hub was inserted first → ASC order puts it at index 0.
    const ids = body.nodes.map((n) => n.id);
    expect(ids[0]).toBe(seed.hubId);
    expect(ids[ids.length - 1]).toBe(seed.isolatedId);
    // Regression guard (gemini-code-assist review follow-up): every node on
    // the timeline path MUST surface `createdAt`. Without it the client
    // layout collapses every node onto the axis midpoint because `eventYear`
    // is only populated by the LLM path, not the deterministic one.
    for (const n of body.nodes) {
      expect(typeof n.createdAt).toBe("string");
      expect(Number.isFinite(new Date(n.createdAt as string).getTime())).toBe(
        true,
      );
    }
  });

  // ─── Test 7: board with explicit root → 1-hop neighborhood ────────
  it("view=board&root=<hubId> returns 1-hop neighborhood with preset layout", async () => {
    const { status, body } = await getGraph(
      ctx.projectId,
      `?view=board&root=${seed.hubId}`,
      memberCookie,
    );
    expect(status).toBe(200);
    expect(body.viewType).toBe("board");
    expect(body.layout).toBe("preset");
    expect(body.rootId).toBe(seed.hubId);
    const ids = body.nodes.map((n) => n.id);
    expect(ids).toContain(seed.hubId);
    for (const s of seed.spokeIds) {
      expect(ids).toContain(s);
    }
    // Isolated concept is NOT in the 1-hop neighborhood of hub.
    expect(ids).not.toContain(seed.isolatedId);
    expect(body.edges.length).toBe(5);
  });

  // ─── Test 8: non-member → 403 ─────────────────────────────────────
  it("returns 403 for a non-member regardless of view", async () => {
    const stranger = await createUser();
    try {
      const strangerCookie = await signSessionCookie(stranger.id);
      const { status } = await getGraph(
        ctx.projectId,
        "?view=cards",
        strangerCookie,
      );
      expect(status).toBe(403);
    } finally {
      // Direct user cleanup — stranger never joined any workspace.
      await db.delete(user).where(eq(user.id, stranger.id));
    }
  });
});
