import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "../src/app.js";
import { db, commentMentions, eq } from "@opencairn/db";
import {
  seedMultiRoleWorkspace,
  type SeedMultiRoleResult,
} from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

describe("POST /api/notes/:noteId/comments", () => {
  let seed: SeedMultiRoleResult;

  beforeEach(async () => {
    seed = await seedMultiRoleWorkspace();
  });

  afterEach(async () => {
    await seed.cleanup();
  });

  it("editor creates a comment and mentions are persisted", async () => {
    const app = createApp();
    const res = await app.request(`/api/notes/${seed.noteId}/comments`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: await signSessionCookie(seed.editorUserId),
      },
      body: JSON.stringify({
        body: "hi @[user:" + seed.viewerUserId + "]",
        anchorBlockId: "blk1",
      }),
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.anchorBlockId).toBe("blk1");
    const rows = await db
      .select()
      .from(commentMentions)
      .where(eq(commentMentions.commentId, json.id));
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mentionedType: "user",
          mentionedId: seed.viewerUserId,
        }),
      ]),
    );
  });

  it("viewer (no commenter) cannot create", async () => {
    const app = createApp();
    const res = await app.request(`/api/notes/${seed.noteId}/comments`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: await signSessionCookie(seed.viewerUserId),
      },
      body: JSON.stringify({ body: "nope" }),
    });
    expect(res.status).toBe(403);
  });

  it("GET returns threaded shape with mentions", async () => {
    const app = createApp();
    await app.request(`/api/notes/${seed.noteId}/comments`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: await signSessionCookie(seed.editorUserId),
      },
      body: JSON.stringify({ body: "root" }),
    });
    const r = await app.request(`/api/notes/${seed.noteId}/comments`, {
      headers: { cookie: await signSessionCookie(seed.editorUserId) },
    });
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.comments).toHaveLength(1);
    expect(json.comments[0].mentions).toEqual([]);
  });
});
