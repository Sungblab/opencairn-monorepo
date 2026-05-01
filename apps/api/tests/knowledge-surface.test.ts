import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  conceptEdgeEvidence,
  conceptEdges,
  concepts,
  db,
  evidenceBundleChunks,
  evidenceBundles,
  eq,
  knowledgeClaims,
  noteChunks,
  notes,
} from "@opencairn/db";
import { createApp } from "../src/app.js";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

const app = createApp();

async function seedSupportedEdge(ctx: SeedResult): Promise<{
  edgeId: string;
  bundleId: string;
  sourceConceptId: string;
}> {
  const [source] = await db
    .insert(concepts)
    .values({
      projectId: ctx.projectId,
      name: `Source ${randomUUID()}`,
      description: "queryable source concept",
    })
    .returning({ id: concepts.id });
  const [target] = await db
    .insert(concepts)
    .values({
      projectId: ctx.projectId,
      name: `Target ${randomUUID()}`,
      description: "target concept",
    })
    .returning({ id: concepts.id });
  const [edge] = await db
    .insert(conceptEdges)
    .values({
      sourceId: source.id,
      targetId: target.id,
      relationType: "supports",
      weight: 0.8,
    })
    .returning({ id: conceptEdges.id });

  await db
    .update(notes)
    .set({ type: "source", sourceType: "pdf" })
    .where(eq(notes.id, ctx.noteId));
  const chunkId = randomUUID();
  await db.insert(noteChunks).values({
    id: chunkId,
    workspaceId: ctx.workspaceId,
    projectId: ctx.projectId,
    noteId: ctx.noteId,
    chunkIndex: 0,
    headingPath: "Evidence",
    contentText: "This paragraph supports the edge.",
    tokenCount: 6,
    sourceOffsets: { start: 0, end: 33 },
    contentHash: `hash-${chunkId}`,
  });
  const [bundle] = await db
    .insert(evidenceBundles)
    .values({
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      purpose: "kg_edge",
      producerKind: "worker",
      createdBy: null,
    })
    .returning({ id: evidenceBundles.id });
  await db.insert(evidenceBundleChunks).values({
    bundleId: bundle.id,
    noteChunkId: chunkId,
    noteId: ctx.noteId,
    rank: 1,
    score: 0.9,
    retrievalChannel: "graph",
    headingPath: "Evidence",
    sourceOffsets: { start: 0, end: 33 },
    quote: "This paragraph supports the edge.",
    citation: { label: "S1", title: "Source" },
    metadata: {},
  });
  const [claim] = await db
    .insert(knowledgeClaims)
    .values({
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      claimText: "Source supports target.",
      claimType: "relation",
      subjectConceptId: source.id,
      objectConceptId: target.id,
      status: "active",
      confidence: 0.9,
      evidenceBundleId: bundle.id,
      producedBy: "ingest",
    })
    .returning({ id: knowledgeClaims.id });
  await db.insert(conceptEdgeEvidence).values({
    conceptEdgeId: edge.id,
    claimId: claim.id,
    evidenceBundleId: bundle.id,
    noteChunkId: chunkId,
    supportScore: 0.9,
    stance: "supports",
    quote: "This paragraph supports the edge.",
  });

  return { edgeId: edge.id, bundleId: bundle.id, sourceConceptId: source.id };
}

describe("GET /api/projects/:projectId/knowledge-surface", () => {
  let ctx: SeedResult;
  let outsider: SeedResult;

  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "owner" });
    outsider = await seedWorkspace({ role: "owner" });
  });

  afterEach(async () => {
    await ctx.cleanup();
    await outsider.cleanup();
  });

  it("returns graph edges with support summaries and optional evidence bundles", async () => {
    const seeded = await seedSupportedEdge(ctx);
    const res = await app.request(
      `/api/projects/${ctx.projectId}/knowledge-surface?view=graph&includeEvidence=true`,
      { headers: { cookie: await signSessionCookie(ctx.userId) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      viewType: string;
      edges: Array<{ id: string; support: { status: string; citationCount: number } }>;
      evidenceBundles?: Array<{ id: string }>;
    };
    expect(body.viewType).toBe("graph");
    expect(body.edges.find((edge) => edge.id === seeded.edgeId)?.support).toMatchObject({
      status: "supported",
      citationCount: 1,
    });
    expect(body.evidenceBundles?.map((bundle) => bundle.id)).toContain(seeded.bundleId);
  });

  it("returns cards backed by concept claim evidence", async () => {
    const seeded = await seedSupportedEdge(ctx);
    const res = await app.request(
      `/api/projects/${ctx.projectId}/knowledge-surface?view=cards`,
      { headers: { cookie: await signSessionCookie(ctx.userId) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      viewType: string;
      cards: Array<{ conceptId: string; evidenceBundleId: string | null; citationCount: number }>;
    };
    expect(body.viewType).toBe("cards");
    const card = body.cards.find((item) => item.conceptId === seeded.sourceConceptId);
    expect(card?.evidenceBundleId).toBe(seeded.bundleId);
    expect(card?.citationCount).toBe(1);
  });

  it("does not expose knowledge surfaces to non-members", async () => {
    await seedSupportedEdge(ctx);
    const res = await app.request(
      `/api/projects/${ctx.projectId}/knowledge-surface?view=graph`,
      { headers: { cookie: await signSessionCookie(outsider.userId) } },
    );

    expect(res.status).toBe(403);
  });
});
