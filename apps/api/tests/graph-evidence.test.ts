import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import {
  conceptEdgeEvidence,
  conceptEdges,
  concepts,
  db,
  evidenceBundleChunks,
  evidenceBundles,
  knowledgeClaims,
  noteChunks,
  notes,
  eq,
} from "@opencairn/db";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

const app = createApp();

async function seedEdge(ctx: SeedResult): Promise<{
  edgeId: string;
  claimId: string;
  bundleId: string;
  chunkId: string;
}> {
  const [source] = await db
    .insert(concepts)
    .values({ projectId: ctx.projectId, name: `source-${randomUUID()}` })
    .returning({ id: concepts.id });
  const [target] = await db
    .insert(concepts)
    .values({ projectId: ctx.projectId, name: `target-${randomUUID()}` })
    .returning({ id: concepts.id });
  const [edge] = await db
    .insert(conceptEdges)
    .values({ sourceId: source.id, targetId: target.id, relationType: "supports" })
    .returning({ id: conceptEdges.id });

  await db.update(notes).set({ type: "source", sourceType: "pdf" }).where(eq(notes.id, ctx.noteId));
  const chunkId = randomUUID();
  await db.insert(noteChunks).values({
    id: chunkId,
    workspaceId: ctx.workspaceId,
    projectId: ctx.projectId,
    noteId: ctx.noteId,
    chunkIndex: 0,
    headingPath: "Evidence",
    contentText: "A supports B.",
    tokenCount: 4,
    sourceOffsets: { start: 0, end: 13 },
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
    score: 0.8,
    retrievalChannel: "graph",
    headingPath: "Evidence",
    sourceOffsets: { start: 0, end: 13 },
    quote: "A supports B.",
    citation: { label: "S1", title: "Source" },
    metadata: {},
  });

  const [claim] = await db
    .insert(knowledgeClaims)
    .values({
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      claimText: "A supports B.",
      claimType: "relation",
      subjectConceptId: source.id,
      objectConceptId: target.id,
      status: "active",
      confidence: 0.8,
      evidenceBundleId: bundle.id,
      producedBy: "ingest",
    })
    .returning({ id: knowledgeClaims.id });
  await db.insert(conceptEdgeEvidence).values({
    conceptEdgeId: edge.id,
    claimId: claim.id,
    evidenceBundleId: bundle.id,
    noteChunkId: chunkId,
    supportScore: 0.8,
    stance: "supports",
    quote: "A supports B.",
  });

  return { edgeId: edge.id, claimId: claim.id, bundleId: bundle.id, chunkId };
}

describe("GET /api/projects/:projectId/graph/evidence", () => {
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

  it("returns claim evidence for a readable edge", async () => {
    const seeded = await seedEdge(ctx);
    const res = await app.request(
      `/api/projects/${ctx.projectId}/graph/evidence?edgeId=${seeded.edgeId}`,
      { headers: { cookie: await signSessionCookie(ctx.userId) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      edgeId: string;
      claims: Array<{
        claimId: string;
        evidenceBundleId: string;
        evidence: Array<{ noteChunkId: string }>;
      }>;
    };
    expect(body.edgeId).toBe(seeded.edgeId);
    expect(body.claims[0]?.claimId).toBe(seeded.claimId);
    expect(body.claims[0]?.evidenceBundleId).toBe(seeded.bundleId);
    expect(body.claims[0]?.evidence[0]?.noteChunkId).toBe(seeded.chunkId);
  });

  it("returns an empty claim list when an edge has no evidence", async () => {
    const [source] = await db.insert(concepts).values({
      projectId: ctx.projectId,
      name: `source-${randomUUID()}`,
    }).returning({ id: concepts.id });
    const [target] = await db.insert(concepts).values({
      projectId: ctx.projectId,
      name: `target-${randomUUID()}`,
    }).returning({ id: concepts.id });
    const [edge] = await db.insert(conceptEdges).values({
      sourceId: source.id,
      targetId: target.id,
    }).returning({ id: conceptEdges.id });

    const res = await app.request(
      `/api/projects/${ctx.projectId}/graph/evidence?edgeId=${edge.id}`,
      { headers: { cookie: await signSessionCookie(ctx.userId) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { claims: unknown[] };
    expect(body.claims).toEqual([]);
  });

  it("does not expose edge evidence to non-members", async () => {
    const seeded = await seedEdge(ctx);
    const res = await app.request(
      `/api/projects/${ctx.projectId}/graph/evidence?edgeId=${seeded.edgeId}`,
      { headers: { cookie: await signSessionCookie(outsider.userId) } },
    );

    expect(res.status).toBe(403);
  });

  it("returns 404 when the edge belongs to another project", async () => {
    const seeded = await seedEdge(ctx);
    const res = await app.request(
      `/api/projects/${outsider.projectId}/graph/evidence?edgeId=${seeded.edgeId}`,
      { headers: { cookie: await signSessionCookie(outsider.userId) } },
    );

    expect(res.status).toBe(404);
  });
});
