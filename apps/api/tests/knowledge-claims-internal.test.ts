import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import {
  conceptEdges,
  conceptEdgeEvidence,
  conceptNotes,
  concepts,
  db,
  eq,
  evidenceBundleChunks,
  evidenceBundles,
  knowledgeClaims,
  noteChunks,
  notes,
} from "@opencairn/db";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";

const SECRET = "test-internal-secret-knowledge-claims";
process.env.INTERNAL_API_SECRET = SECRET;

const app = createApp();

async function seedClaimEvidence(ctx: SeedResult): Promise<{
  bundleId: string;
  chunkId: string;
  sourceConceptId: string;
  targetConceptId: string;
  edgeId: string;
}> {
  const [source] = await db
    .insert(concepts)
    .values({
      projectId: ctx.projectId,
      name: `Source ${randomUUID()}`,
      description: "source concept",
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

  return {
    bundleId: bundle.id,
    chunkId,
    sourceConceptId: source.id,
    targetConceptId: target.id,
    edgeId: edge.id,
  };
}

describe("POST /api/internal/knowledge/claims", () => {
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

  it("records a claim with edge evidence", async () => {
    const seeded = await seedClaimEvidence(ctx);

    const res = await app.request("/api/internal/knowledge/claims", {
      method: "POST",
      headers: {
        "X-Internal-Secret": SECRET,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        claimText: "Source supports target.",
        claimType: "relation",
        status: "active",
        confidence: 0.9,
        subjectConceptId: seeded.sourceConceptId,
        objectConceptId: seeded.targetConceptId,
        evidenceBundleId: seeded.bundleId,
        producedBy: "ingest",
        producedByRunId: "run-1",
        edgeEvidence: [
          {
            conceptEdgeId: seeded.edgeId,
            noteChunkId: seeded.chunkId,
            supportScore: 0.9,
            stance: "supports",
            quote: "This paragraph supports the edge.",
          },
        ],
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      claimId: string;
      edgeEvidenceIds: string[];
    };
    expect(body.claimId).toMatch(/[0-9a-f-]{36}/);
    expect(body.edgeEvidenceIds).toHaveLength(1);

    const [claim] = await db
      .select({ id: knowledgeClaims.id })
      .from(knowledgeClaims)
      .where(eq(knowledgeClaims.id, body.claimId));
    expect(claim?.id).toBe(body.claimId);
    const [edgeEvidence] = await db
      .select({ id: conceptEdgeEvidence.id })
      .from(conceptEdgeEvidence)
      .where(eq(conceptEdgeEvidence.id, body.edgeEvidenceIds[0]));
    expect(edgeEvidence?.id).toBe(body.edgeEvidenceIds[0]);
  });

  it("rejects workspace/project mismatches", async () => {
    const seeded = await seedClaimEvidence(ctx);

    const res = await app.request("/api/internal/knowledge/claims", {
      method: "POST",
      headers: {
        "X-Internal-Secret": SECRET,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspaceId: other.workspaceId,
        projectId: ctx.projectId,
        claimText: "Source supports target.",
        claimType: "relation",
        status: "active",
        confidence: 0.9,
        evidenceBundleId: seeded.bundleId,
        producedBy: "ingest",
      }),
    });

    expect(res.status).toBe(403);
  });

  it("rejects bundle chunk mismatches", async () => {
    const seeded = await seedClaimEvidence(ctx);
    const otherChunkId = randomUUID();
    await db.insert(noteChunks).values({
      id: otherChunkId,
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      noteId: ctx.noteId,
      chunkIndex: 1,
      headingPath: "Other",
      contentText: "Not in bundle.",
      tokenCount: 4,
      sourceOffsets: { start: 34, end: 48 },
      contentHash: `hash-${otherChunkId}`,
    });

    const res = await app.request("/api/internal/knowledge/claims", {
      method: "POST",
      headers: {
        "X-Internal-Secret": SECRET,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        claimText: "Source supports target.",
        claimType: "relation",
        status: "active",
        confidence: 0.9,
        evidenceBundleId: seeded.bundleId,
        producedBy: "ingest",
        edgeEvidence: [
          {
            conceptEdgeId: seeded.edgeId,
            noteChunkId: otherChunkId,
            supportScore: 0.9,
            stance: "supports",
            quote: "Not in bundle.",
          },
        ],
      }),
    });

    expect(res.status).toBe(400);
  });

  it("rejects edge evidence outside the project", async () => {
    const seeded = await seedClaimEvidence(ctx);
    const foreign = await seedClaimEvidence(other);

    const res = await app.request("/api/internal/knowledge/claims", {
      method: "POST",
      headers: {
        "X-Internal-Secret": SECRET,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        claimText: "Source supports target.",
        claimType: "relation",
        status: "active",
        confidence: 0.9,
        evidenceBundleId: seeded.bundleId,
        producedBy: "ingest",
        edgeEvidence: [
          {
            conceptEdgeId: foreign.edgeId,
            noteChunkId: seeded.chunkId,
            supportScore: 0.9,
            stance: "supports",
            quote: "This paragraph supports the edge.",
          },
        ],
      }),
    });

    expect(res.status).toBe(400);
  });

  it("returns shared chunks for a concept pair", async () => {
    const seeded = await seedClaimEvidence(ctx);
    await db.insert(conceptNotes).values([
      { conceptId: seeded.sourceConceptId, noteId: ctx.noteId },
      { conceptId: seeded.targetConceptId, noteId: ctx.noteId },
    ]);

    const res = await app.request(
      `/api/internal/projects/${ctx.projectId}/concept-pair-chunks` +
        `?sourceId=${seeded.sourceConceptId}&targetId=${seeded.targetConceptId}`,
      {
        headers: {
          "X-Internal-Secret": SECRET,
        },
      },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      source: { id: string; name: string };
      target: { id: string; name: string };
      chunks: Array<{ id: string; noteId: string; quote: string }>;
    };
    expect(body.source.id).toBe(seeded.sourceConceptId);
    expect(body.target.id).toBe(seeded.targetConceptId);
    expect(body.chunks).toHaveLength(1);
    expect(body.chunks[0]).toMatchObject({
      noteId: ctx.noteId,
      quote: "This paragraph supports the edge.",
    });
  });
});
