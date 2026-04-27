import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "../src/app.js";
import { db, notes, eq } from "@opencairn/db";
import {
  seedWorkspace,
  createUser,
  type SeedResult,
} from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

const app = createApp();

async function authedFetch(
  path: string,
  init: { userId: string } & RequestInit = { userId: "" },
): Promise<Response> {
  const { userId, headers, ...rest } = init;
  const cookie = await signSessionCookie(userId);
  return app.request(path, {
    ...rest,
    headers: {
      ...(headers ?? {}),
      cookie,
    },
  });
}

describe("GET /api/search/scope-targets", () => {
  let ctx: SeedResult;
  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "owner" });
    // Rename the seeded note so the q="rope" search hits it.
    await db.update(notes).set({ title: "RoPE primer" }).where(eq(notes.id, ctx.noteId));
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it("returns matching pages with the canonical label", async () => {
    const res = await authedFetch(
      `/api/search/scope-targets?workspaceId=${ctx.workspaceId}&q=rope`,
      { userId: ctx.userId },
    );
    expect(res.status).toBe(200);
    const hits = (await res.json()) as Array<{
      type: string;
      id: string;
      label: string;
    }>;
    expect(hits.find((h) => h.id === ctx.noteId)).toMatchObject({
      type: "page",
      label: "RoPE primer",
    });
  });

  it("returns 403 when the caller is not a workspace member", async () => {
    const stranger = await createUser();
    try {
      const res = await authedFetch(
        `/api/search/scope-targets?workspaceId=${ctx.workspaceId}&q=rope`,
        { userId: stranger.id },
      );
      expect(res.status).toBe(403);
    } finally {
      // Stranger isn't tied to ctx, so direct delete is fine.
      const { user, eq: eqOp, db: dbConn } = await import("@opencairn/db");
      await dbConn.delete(user).where(eqOp(user.id, stranger.id));
    }
  });

  it("returns 400 when q is missing", async () => {
    const res = await authedFetch(
      `/api/search/scope-targets?workspaceId=${ctx.workspaceId}`,
      { userId: ctx.userId },
    );
    expect(res.status).toBe(400);
  });
});
