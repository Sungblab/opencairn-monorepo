import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import { db, notes, researchRuns, wikiLinks } from "@opencairn/db";
import {
  seedMultiRoleWorkspace,
  seedWorkspace,
  type SeedMultiRoleResult,
  type SeedResult,
} from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

// App Shell Phase 5 Task 2 — `/api/projects/:id/notes?filter=...` 의
// kind 분류 (research / imported / manual / all) 와 권한 / soft-delete
// 가드를 lock-in 하는 테스트.

const app = createApp();

async function authedGet(path: string, userId: string): Promise<Response> {
  const cookie = await signSessionCookie(userId);
  return app.request(path, { headers: { cookie } });
}

async function insertNote(opts: {
  workspaceId: string;
  projectId: string;
  title: string;
  sourceType?:
    | "manual"
    | "pdf"
    | "audio"
    | "video"
    | "image"
    | "youtube"
    | "web"
    | "notion"
    | "unknown"
    | "canvas"
    | null;
  canvasLanguage?: "python" | "javascript" | "html" | "react";
  deletedAt?: Date;
  type?: "note" | "wiki" | "source";
}): Promise<string> {
  const id = randomUUID();
  await db.insert(notes).values({
    id,
    projectId: opts.projectId,
    workspaceId: opts.workspaceId,
    title: opts.title,
    type: opts.type ?? "note",
    inheritParent: true,
    sourceType: opts.sourceType ?? null,
    canvasLanguage: opts.canvasLanguage,
    deletedAt: opts.deletedAt ?? null,
  });
  return id;
}

async function attachAsResearchOutput(opts: {
  workspaceId: string;
  projectId: string;
  userId: string;
  noteId: string;
}): Promise<void> {
  const id = randomUUID();
  await db.insert(researchRuns).values({
    id,
    workspaceId: opts.workspaceId,
    projectId: opts.projectId,
    userId: opts.userId,
    topic: "research note seed",
    model: "deep-research-preview-04-2026",
    billingPath: "managed",
    status: "completed",
    workflowId: id,
    noteId: opts.noteId,
  });
}

describe("GET /api/projects/:id/notes filter routing", () => {
  let seed: SeedResult;
  afterEach(async () => {
    if (seed) await seed.cleanup();
  });

  it("classifies imported / research / manual / canvas correctly", async () => {
    seed = await seedWorkspace({ role: "owner" });

    // The seedWorkspace helper already creates one bare note; track its id so
    // we don't double-count when asserting totals.
    const seedNoteId = seed.noteId;
    const importedId = await insertNote({
      workspaceId: seed.workspaceId,
      projectId: seed.projectId,
      title: "from-pdf",
      sourceType: "pdf",
    });
    const researchSourceId = await insertNote({
      workspaceId: seed.workspaceId,
      projectId: seed.projectId,
      title: "research-output",
      sourceType: "manual",
    });
    await attachAsResearchOutput({
      workspaceId: seed.workspaceId,
      projectId: seed.projectId,
      userId: seed.userId,
      noteId: researchSourceId,
    });
    const canvasId = await insertNote({
      workspaceId: seed.workspaceId,
      projectId: seed.projectId,
      title: "scratch",
      sourceType: "canvas",
      canvasLanguage: "python",
    });

    const all = (await (
      await authedGet(
        `/api/projects/${seed.projectId}/notes?filter=all`,
        seed.userId,
      )
    ).json()) as { notes: Array<{ id: string; kind: string }> };
    expect(all.notes).toHaveLength(4);
    const byId = new Map(all.notes.map((n) => [n.id, n.kind]));
    expect(byId.get(importedId)).toBe("imported");
    expect(byId.get(researchSourceId)).toBe("research");
    expect(byId.get(canvasId)).toBe("manual");
    expect(byId.get(seedNoteId)).toBe("manual");

    const imported = (await (
      await authedGet(
        `/api/projects/${seed.projectId}/notes?filter=imported`,
        seed.userId,
      )
    ).json()) as { notes: Array<{ id: string }> };
    expect(imported.notes.map((n) => n.id)).toEqual([importedId]);

    const research = (await (
      await authedGet(
        `/api/projects/${seed.projectId}/notes?filter=research`,
        seed.userId,
      )
    ).json()) as { notes: Array<{ id: string }> };
    expect(research.notes.map((n) => n.id)).toEqual([researchSourceId]);

    const manual = (await (
      await authedGet(
        `/api/projects/${seed.projectId}/notes?filter=manual`,
        seed.userId,
      )
    ).json()) as { notes: Array<{ id: string }> };
    expect(new Set(manual.notes.map((n) => n.id))).toEqual(
      new Set([canvasId, seedNoteId]),
    );
  });

  it("excludes soft-deleted notes from every filter", async () => {
    seed = await seedWorkspace({ role: "owner" });
    await insertNote({
      workspaceId: seed.workspaceId,
      projectId: seed.projectId,
      title: "tombstone",
      sourceType: "pdf",
      deletedAt: new Date(),
    });
    const all = (await (
      await authedGet(
        `/api/projects/${seed.projectId}/notes`,
        seed.userId,
      )
    ).json()) as { notes: unknown[] };
    expect(all.notes).toHaveLength(1); // only seed.noteId
  });

  it("orders results by updated_at desc", async () => {
    seed = await seedWorkspace({ role: "owner" });
    const older = await insertNote({
      workspaceId: seed.workspaceId,
      projectId: seed.projectId,
      title: "older",
    });
    const newer = await insertNote({
      workspaceId: seed.workspaceId,
      projectId: seed.projectId,
      title: "newer",
    });
    // Force the explicit ordering — the seed and the two inserts above all
    // land within the same millisecond on Windows, so we touch updated_at
    // directly to guarantee a strict ordering.
    const past = new Date(Date.now() - 60 * 1000);
    const past2 = new Date(Date.now() - 120 * 1000);
    const past3 = new Date(Date.now() - 180 * 1000);
    await db
      .update(notes)
      .set({ updatedAt: past3 })
      .where((await import("@opencairn/db")).eq(notes.id, seed.noteId));
    await db
      .update(notes)
      .set({ updatedAt: past2 })
      .where((await import("@opencairn/db")).eq(notes.id, older));
    await db
      .update(notes)
      .set({ updatedAt: past })
      .where((await import("@opencairn/db")).eq(notes.id, newer));

    const res = (await (
      await authedGet(`/api/projects/${seed.projectId}/notes`, seed.userId)
    ).json()) as { notes: Array<{ title: string }> };
    expect(res.notes.map((n) => n.title)).toEqual([
      "newer",
      "older",
      "test", // seed.noteId default title
    ]);
  });

  it("returns 403 for users without project read access", async () => {
    seed = await seedWorkspace({ role: "owner" });
    const intruder = await seedWorkspace({ role: "owner" });
    try {
      const res = await authedGet(
        `/api/projects/${seed.projectId}/notes`,
        intruder.userId,
      );
      expect(res.status).toBe(403);
    } finally {
      await intruder.cleanup();
    }
  });

  it("falls back to filter=all when given an unknown filter value", async () => {
    seed = await seedWorkspace({ role: "owner" });
    await insertNote({
      workspaceId: seed.workspaceId,
      projectId: seed.projectId,
      title: "bystander",
      sourceType: "pdf",
    });
    const res = (await (
      await authedGet(
        `/api/projects/${seed.projectId}/notes?filter=garbage`,
        seed.userId,
      )
    ).json()) as { notes: unknown[] };
    expect(res.notes).toHaveLength(2);
  });
});

describe("GET /api/projects/:id/wiki-index", () => {
  let seed: SeedResult;
  let multiSeed: SeedMultiRoleResult | undefined;
  afterEach(async () => {
    if (seed) await seed.cleanup();
    if (multiSeed) await multiSeed.cleanup();
  });

  it("returns a project wiki catalog with link counts", async () => {
    seed = await seedWorkspace({ role: "owner" });
    const sourceId = await insertNote({
      workspaceId: seed.workspaceId,
      projectId: seed.projectId,
      title: "Source packet",
      type: "source",
      sourceType: "pdf",
    });
    const wikiId = await insertNote({
      workspaceId: seed.workspaceId,
      projectId: seed.projectId,
      title: "Compiled concept",
      type: "wiki",
    });
    await db.insert(wikiLinks).values({
      workspaceId: seed.workspaceId,
      sourceNoteId: sourceId,
      targetNoteId: wikiId,
    });

    const res = await authedGet(
      `/api/projects/${seed.projectId}/wiki-index`,
      seed.userId,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as {
      projectId: string;
      generatedAt: string;
      latestPageUpdatedAt: string | null;
      totals: { pages: number; wikiLinks: number; orphanPages: number };
      pages: Array<{
        id: string;
        title: string;
        type: string;
        inboundLinks: number;
        outboundLinks: number;
      }>;
    };
    expect(body.projectId).toBe(seed.projectId);
    expect(Date.parse(body.generatedAt)).not.toBeNaN();
    expect(body.latestPageUpdatedAt).not.toBeNull();
    expect(body.totals.pages).toBeGreaterThanOrEqual(3);
    expect(body.totals.wikiLinks).toBe(1);
    expect(body.totals.orphanPages).toBeGreaterThanOrEqual(1);
    expect(body.pages.find((page) => page.id === sourceId)).toMatchObject({
      title: "Source packet",
      type: "source",
      inboundLinks: 0,
      outboundLinks: 1,
    });
    expect(body.pages.find((page) => page.id === wikiId)).toMatchObject({
      title: "Compiled concept",
      type: "wiki",
      inboundLinks: 1,
      outboundLinks: 0,
    });
  });

  it("returns 403 for users without project read access", async () => {
    seed = await seedWorkspace({ role: "owner" });
    const intruder = await seedWorkspace({ role: "owner" });
    try {
      const res = await authedGet(
        `/api/projects/${seed.projectId}/wiki-index`,
        intruder.userId,
      );
      expect(res.status).toBe(403);
    } finally {
      await intruder.cleanup();
    }
  });

  it("excludes private notes and their links when the caller cannot read them", async () => {
    multiSeed = await seedMultiRoleWorkspace();
    await db.insert(wikiLinks).values({
      workspaceId: multiSeed.workspaceId,
      sourceNoteId: multiSeed.privateNoteId,
      targetNoteId: multiSeed.noteId,
    });

    const res = await authedGet(
      `/api/projects/${multiSeed.projectId}/wiki-index`,
      multiSeed.viewerUserId,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as {
      totals: { wikiLinks: number };
      pages: Array<{ id: string }>;
    };
    expect(body.pages.map((page) => page.id)).not.toContain(
      multiSeed.privateNoteId,
    );
    expect(body.totals.wikiLinks).toBe(0);
  });
});
