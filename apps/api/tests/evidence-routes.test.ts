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
import { signSessionCookie } from "./helpers/session.js";

const SECRET = "test-internal-secret-evidence";
process.env.INTERNAL_API_SECRET = SECRET;

const app = createApp();

async function insertChunk(ctx: SeedResult): Promise<string> {
  const id = randomUUID();
  await db.update(notes).set({ type: "source", sourceType: "pdf" }).where(eq(notes.id, ctx.noteId));
  await db.insert(noteChunks).values({
    id,
    workspaceId: ctx.workspaceId,
    projectId: ctx.projectId,
    noteId: ctx.noteId,
    chunkIndex: 0,
    headingPath: "Intro",
    contentText: "A short supporting quote.",
    tokenCount: 6,
    sourceOffsets: { start: 0, end: 25 },
    contentHash: `hash-${id}`,
  });
  return id;
}

async function insertBundle(ctx: SeedResult, chunkId: string): Promise<string> {
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
    retrievalChannel: "vector",
    headingPath: "Intro",
    sourceOffsets: { start: 0, end: 25 },
    quote: "A short supporting quote.",
    citation: { label: "S1", title: "Source" },
    metadata: {},
  });
  return bundle.id;
}

describe("evidence routes", () => {
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

  it("returns a permission-filtered evidence bundle", async () => {
    const chunkId = await insertChunk(ctx);
    const bundleId = await insertBundle(ctx, chunkId);

    const res = await app.request(`/api/evidence/bundles/${bundleId}`, {
      headers: { cookie: await signSessionCookie(ctx.userId) },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      entries: Array<{ noteChunkId: string; citation: { label: string } }>;
    };
    expect(body.id).toBe(bundleId);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]?.noteChunkId).toBe(chunkId);
    expect(body.entries[0]?.citation.label).toBe("S1");
  });

  it("does not expose bundles to non-members", async () => {
    const chunkId = await insertChunk(ctx);
    const bundleId = await insertBundle(ctx, chunkId);

    const res = await app.request(`/api/evidence/bundles/${bundleId}`, {
      headers: { cookie: await signSessionCookie(outsider.userId) },
    });

    expect(res.status).toBe(403);
  });

  it("validates and persists internal bundle writes", async () => {
    const chunkId = await insertChunk(ctx);
    const res = await app.request("/api/internal/evidence/bundles", {
      method: "POST",
      headers: {
        "X-Internal-Secret": SECRET,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        purpose: "kg_edge",
        producer: { kind: "worker", runId: "run-1" },
        createdBy: null,
        entries: [
          {
            noteChunkId: chunkId,
            noteId: ctx.noteId,
            noteType: "source",
            sourceType: "pdf",
            headingPath: "Intro",
            sourceOffsets: { start: 0, end: 25 },
            score: 0.9,
            rank: 1,
            retrievalChannel: "manual",
            quote: "A short supporting quote.",
            citation: { label: "S1", title: "Source" },
            metadata: {},
          },
        ],
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; createdAt: string };
    expect(body.id).toMatch(/[0-9a-f-]{36}/);
    expect(new Date(body.createdAt).toString()).not.toBe("Invalid Date");
  });

  it("rejects internal bundle writes with a mismatched workspace", async () => {
    const chunkId = await insertChunk(ctx);
    const res = await app.request("/api/internal/evidence/bundles", {
      method: "POST",
      headers: {
        "X-Internal-Secret": SECRET,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspaceId: outsider.workspaceId,
        projectId: ctx.projectId,
        purpose: "kg_edge",
        producer: { kind: "worker" },
        createdBy: null,
        entries: [
          {
            noteChunkId: chunkId,
            noteId: ctx.noteId,
            noteType: "source",
            sourceType: "pdf",
            headingPath: "Intro",
            sourceOffsets: { start: 0, end: 25 },
            score: 0.9,
            rank: 1,
            retrievalChannel: "manual",
            quote: "A short supporting quote.",
            citation: { label: "S1", title: "Source" },
            metadata: {},
          },
        ],
      }),
    });

    expect(res.status).toBe(403);
  });
});
