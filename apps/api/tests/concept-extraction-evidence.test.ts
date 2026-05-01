import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import {
  db,
  evidenceBundleChunks,
  evidenceBundles,
  noteChunks,
  notes,
  eq,
} from "@opencairn/db";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";

const SECRET = "test-internal-secret-concept-extractions";
process.env.INTERNAL_API_SECRET = SECRET;

const app = createApp();

async function seedBundle(ctx: SeedResult): Promise<{
  bundleId: string;
  chunkId: string;
}> {
  await db.update(notes).set({ type: "source", sourceType: "pdf" }).where(eq(notes.id, ctx.noteId));
  const chunkId = randomUUID();
  await db.insert(noteChunks).values({
    id: chunkId,
    workspaceId: ctx.workspaceId,
    projectId: ctx.projectId,
    noteId: ctx.noteId,
    chunkIndex: 0,
    headingPath: "Concepts",
    contentText: "OpenCairn is a knowledge OS.",
    tokenCount: 7,
    sourceOffsets: { start: 0, end: 29 },
    contentHash: `hash-${chunkId}`,
  });
  const [bundle] = await db.insert(evidenceBundles).values({
    workspaceId: ctx.workspaceId,
    projectId: ctx.projectId,
    purpose: "concept_extraction",
    producerKind: "worker",
    createdBy: null,
  }).returning({ id: evidenceBundles.id });
  await db.insert(evidenceBundleChunks).values({
    bundleId: bundle.id,
    noteChunkId: chunkId,
    noteId: ctx.noteId,
    rank: 1,
    score: 0.77,
    retrievalChannel: "manual",
    headingPath: "Concepts",
    sourceOffsets: { start: 0, end: 29 },
    quote: "OpenCairn is a knowledge OS.",
    citation: { label: "S1", title: "Source" },
    metadata: {},
  });
  return { bundleId: bundle.id, chunkId };
}

describe("POST /api/internal/concepts/extractions", () => {
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

  it("records concept extraction chunk evidence", async () => {
    const seeded = await seedBundle(ctx);
    const res = await app.request("/api/internal/concepts/extractions", {
      method: "POST",
      headers: {
        "X-Internal-Secret": SECRET,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        name: "OpenCairn",
        kind: "concept",
        normalizedName: "opencairn",
        description: "Knowledge OS",
        confidence: 0.92,
        evidenceBundleId: seeded.bundleId,
        sourceNoteId: ctx.noteId,
        createdByRunId: "run-1",
        chunks: [
          {
            noteChunkId: seeded.chunkId,
            supportScore: 0.92,
            quote: "OpenCairn is a knowledge OS.",
          },
        ],
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(body.id).toMatch(/[0-9a-f-]{36}/);
  });

  it("rejects chunks that are not part of the evidence bundle", async () => {
    const seeded = await seedBundle(ctx);
    const res = await app.request("/api/internal/concepts/extractions", {
      method: "POST",
      headers: {
        "X-Internal-Secret": SECRET,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        name: "OpenCairn",
        kind: "concept",
        normalizedName: "opencairn",
        confidence: 0.92,
        evidenceBundleId: seeded.bundleId,
        chunks: [
          {
            noteChunkId: randomUUID(),
            supportScore: 0.92,
            quote: "OpenCairn is a knowledge OS.",
          },
        ],
      }),
    });

    expect(res.status).toBe(400);
  });

  it("rejects workspace mismatches", async () => {
    const seeded = await seedBundle(ctx);
    const res = await app.request("/api/internal/concepts/extractions", {
      method: "POST",
      headers: {
        "X-Internal-Secret": SECRET,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspaceId: other.workspaceId,
        projectId: ctx.projectId,
        name: "OpenCairn",
        kind: "concept",
        normalizedName: "opencairn",
        confidence: 0.92,
        evidenceBundleId: seeded.bundleId,
        chunks: [
          {
            noteChunkId: seeded.chunkId,
            supportScore: 0.92,
            quote: "OpenCairn is a knowledge OS.",
          },
        ],
      }),
    });

    expect(res.status).toBe(400);
  });
});
