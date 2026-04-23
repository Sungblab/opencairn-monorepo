import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db, notes, eq } from "@opencairn/db";
import { createApp } from "../src/app.js";
import { findWorkspaceId } from "../src/lib/permissions.js";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";

// Regression coverage for Tier 0 item 0-1 (Post-hoc review Plan 1 H-4 +
// Plan 2B C-4 + Plan 3 M-2 + Plan 4 H-3). A soft-deleted note must not be
// resolvable via findWorkspaceId, nor readable/writable via the internal
// endpoints used by the worker. Dropping `deletedAt` here re-opens the
// Hocuspocus + compiler cross-surface bypass the review called out.

const SECRET = "test-internal-secret-soft-delete";
process.env.INTERNAL_API_SECRET = SECRET;

const app = createApp();

async function internalFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return app.request(path, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      "X-Internal-Secret": SECRET,
      "content-type": "application/json",
    },
  });
}

describe("soft-delete cascade (Tier 0 / Plan 1 H-4 family)", () => {
  let ctx: SeedResult;

  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "owner" });
    await db
      .update(notes)
      .set({ deletedAt: new Date() })
      .where(eq(notes.id, ctx.noteId));
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("findWorkspaceId returns null for soft-deleted notes", async () => {
    const wsId = await findWorkspaceId({ type: "note", id: ctx.noteId });
    expect(wsId).toBeNull();
  });

  it("GET /api/internal/notes/:id returns 404 for soft-deleted notes", async () => {
    const res = await internalFetch(`/api/internal/notes/${ctx.noteId}`);
    expect(res.status).toBe(404);
  });

  it("POST /api/internal/notes/:id/refresh-tsv returns 404 for soft-deleted notes", async () => {
    const res = await internalFetch(
      `/api/internal/notes/${ctx.noteId}/refresh-tsv`,
      { method: "POST" },
    );
    expect(res.status).toBe(404);
  });

  it("PATCH /api/internal/notes/:id returns 404 for soft-deleted notes", async () => {
    const res = await internalFetch(`/api/internal/notes/${ctx.noteId}`, {
      method: "PATCH",
      body: JSON.stringify({ title: "revived" }),
    });
    expect(res.status).toBe(404);

    const [row] = await db.select().from(notes).where(eq(notes.id, ctx.noteId));
    expect(row!.title).not.toBe("revived");
  });
});
