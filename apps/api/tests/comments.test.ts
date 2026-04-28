import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "../src/app.js";
import { db, comments, commentMentions, eq, user } from "@opencairn/db";
import {
  createUser,
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

  it("rejects user mentions outside the note workspace", async () => {
    const app = createApp();
    const outsider = await createUser();
    try {
      const res = await app.request(`/api/notes/${seed.noteId}/comments`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: await signSessionCookie(seed.editorUserId),
        },
        body: JSON.stringify({
          body: "hi @[user:" + outsider.id + "]",
        }),
      });

      expect(res.status).toBe(400);
      const rows = await db
        .select()
        .from(commentMentions)
        .where(eq(commentMentions.mentionedId, outsider.id));
      expect(rows).toEqual([]);
    } finally {
      await db.delete(user).where(eq(user.id, outsider.id));
    }
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

  it("commenter can create a page-level (unanchored) comment", async () => {
    const app = createApp();
    const res = await app.request(`/api/notes/${seed.noteId}/comments`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: await signSessionCookie(seed.commenterUserId),
      },
      body: JSON.stringify({ body: "page-level ok" }),
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.anchorBlockId).toBe(null);
  });

  it("commenter cannot create a block-anchored comment (needs editor)", async () => {
    // api-contract.md §Comments: "page viewer (기본) / editor if anchored".
    // Block-level annotations mutate structural metadata of an editor block,
    // so they require write access on the page, not just comment access.
    const app = createApp();
    const res = await app.request(`/api/notes/${seed.noteId}/comments`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: await signSessionCookie(seed.commenterUserId),
      },
      body: JSON.stringify({ body: "blocked", anchorBlockId: "blk9" }),
    });
    expect(res.status).toBe(403);
  });

  it("editor can create a block-anchored comment", async () => {
    const app = createApp();
    const res = await app.request(`/api/notes/${seed.noteId}/comments`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: await signSessionCookie(seed.editorUserId),
      },
      body: JSON.stringify({ body: "anchor by editor", anchorBlockId: "blk7" }),
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.anchorBlockId).toBe("blk7");
  });

  it("empty-string anchorBlockId is rejected by zod (400), not routed as unanchored", async () => {
    // Defense-in-depth: the handler uses `!= null` (not truthy) so an empty
    // string would still trip the canWrite branch if it somehow reached the
    // handler. createCommentSchema.anchorBlockId has `.min(1)` so it should
    // never get past validation — but pin that contract here so a future
    // relaxation of the schema can't silently downgrade the permission check.
    const app = createApp();
    const res = await app.request(`/api/notes/${seed.noteId}/comments`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: await signSessionCookie(seed.commenterUserId),
      },
      body: JSON.stringify({ body: "empty anchor", anchorBlockId: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("explicit null anchorBlockId is treated as unanchored (commenter OK)", async () => {
    const app = createApp();
    const res = await app.request(`/api/notes/${seed.noteId}/comments`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: await signSessionCookie(seed.commenterUserId),
      },
      body: JSON.stringify({ body: "null anchor", anchorBlockId: null }),
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.anchorBlockId).toBe(null);
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

describe("PATCH /api/comments/:id", () => {
  let seed: SeedMultiRoleResult;

  beforeEach(async () => {
    seed = await seedMultiRoleWorkspace();
  });

  afterEach(async () => {
    await seed.cleanup();
  });

  it("only the author may edit", async () => {
    const app = createApp();
    const createRes = await app.request(
      `/api/notes/${seed.noteId}/comments`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: await signSessionCookie(seed.editorUserId),
        },
        body: JSON.stringify({ body: "orig" }),
      },
    );
    expect(createRes.status).toBe(201);
    const { id } = await createRes.json();

    // viewer (not author) → 403
    const forbiddenRes = await app.request(`/api/comments/${id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: await signSessionCookie(seed.viewerUserId),
      },
      body: JSON.stringify({ body: "hacked" }),
    });
    expect(forbiddenRes.status).toBe(403);

    // author (editor) → 200
    const okRes = await app.request(`/api/comments/${id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: await signSessionCookie(seed.editorUserId),
      },
      body: JSON.stringify({ body: "edited" }),
    });
    expect(okRes.status).toBe(200);

    const [row] = await db
      .select()
      .from(comments)
      .where(eq(comments.id, id));
    expect(row.body).toBe("edited");
  });

  it("re-extracts mentions on edit", async () => {
    const app = createApp();
    // X = viewer, Y = commenter
    const X = seed.viewerUserId;
    const Y = seed.commenterUserId;

    const createRes = await app.request(
      `/api/notes/${seed.noteId}/comments`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: await signSessionCookie(seed.editorUserId),
        },
        body: JSON.stringify({ body: `hi @[user:${X}]` }),
      },
    );
    expect(createRes.status).toBe(201);
    const { id } = await createRes.json();

    const before = await db
      .select()
      .from(commentMentions)
      .where(eq(commentMentions.commentId, id));
    expect(before.map((r) => r.mentionedId)).toEqual([X]);

    const patchRes = await app.request(`/api/comments/${id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: await signSessionCookie(seed.editorUserId),
      },
      body: JSON.stringify({ body: `hi @[user:${Y}]` }),
    });
    expect(patchRes.status).toBe(200);

    const after = await db
      .select()
      .from(commentMentions)
      .where(eq(commentMentions.commentId, id));
    expect(after.map((r) => r.mentionedId)).toEqual([Y]);
  });

  it("rejects edited user mentions outside the note workspace", async () => {
    const app = createApp();
    const outsider = await createUser();
    try {
      const createRes = await app.request(
        `/api/notes/${seed.noteId}/comments`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: await signSessionCookie(seed.editorUserId),
          },
          body: JSON.stringify({ body: "orig" }),
        },
      );
      expect(createRes.status).toBe(201);
      const { id } = await createRes.json();

      const patchRes = await app.request(`/api/comments/${id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: await signSessionCookie(seed.editorUserId),
        },
        body: JSON.stringify({ body: `hi @[user:${outsider.id}]` }),
      });
      expect(patchRes.status).toBe(400);

      const rows = await db
        .select()
        .from(commentMentions)
        .where(eq(commentMentions.commentId, id));
      expect(rows).toEqual([]);
    } finally {
      await db.delete(user).where(eq(user.id, outsider.id));
    }
  });
});

describe("DELETE /api/comments/:id", () => {
  let seed: SeedMultiRoleResult;

  beforeEach(async () => {
    seed = await seedMultiRoleWorkspace();
  });

  afterEach(async () => {
    await seed.cleanup();
  });

  it("non-author viewer cannot delete", async () => {
    const app = createApp();
    const createRes = await app.request(
      `/api/notes/${seed.noteId}/comments`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: await signSessionCookie(seed.editorUserId),
        },
        body: JSON.stringify({ body: "editor's comment" }),
      },
    );
    expect(createRes.status).toBe(201);
    const { id } = await createRes.json();

    const res = await app.request(`/api/comments/${id}`, {
      method: "DELETE",
      headers: { cookie: await signSessionCookie(seed.viewerUserId) },
    });
    expect(res.status).toBe(403);
  });

  it("author can delete", async () => {
    const app = createApp();
    const createRes = await app.request(
      `/api/notes/${seed.noteId}/comments`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: await signSessionCookie(seed.commenterUserId),
        },
        body: JSON.stringify({ body: "my own comment" }),
      },
    );
    expect(createRes.status).toBe(201);
    const { id } = await createRes.json();

    const delRes = await app.request(`/api/comments/${id}`, {
      method: "DELETE",
      headers: { cookie: await signSessionCookie(seed.commenterUserId) },
    });
    expect(delRes.status).toBe(204);

    const listRes = await app.request(
      `/api/notes/${seed.noteId}/comments`,
      { headers: { cookie: await signSessionCookie(seed.editorUserId) } },
    );
    expect(listRes.status).toBe(200);
    const listJson = await listRes.json();
    expect(listJson.comments).toHaveLength(0);
  });

  it("editor (non-author) can delete", async () => {
    const app = createApp();
    const createRes = await app.request(
      `/api/notes/${seed.noteId}/comments`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: await signSessionCookie(seed.commenterUserId),
        },
        body: JSON.stringify({ body: "commenter's comment" }),
      },
    );
    expect(createRes.status).toBe(201);
    const { id } = await createRes.json();

    const res = await app.request(`/api/comments/${id}`, {
      method: "DELETE",
      headers: { cookie: await signSessionCookie(seed.editorUserId) },
    });
    expect(res.status).toBe(204);
  });
});

describe("POST /api/comments/:id/resolve", () => {
  let seed: SeedMultiRoleResult;

  beforeEach(async () => {
    seed = await seedMultiRoleWorkspace();
  });

  afterEach(async () => {
    await seed.cleanup();
  });

  it("editor toggles resolved_at", async () => {
    const app = createApp();
    const createRes = await app.request(
      `/api/notes/${seed.noteId}/comments`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: await signSessionCookie(seed.editorUserId),
        },
        body: JSON.stringify({ body: "needs resolving" }),
      },
    );
    expect(createRes.status).toBe(201);
    const { id } = await createRes.json();

    const res1 = await app.request(`/api/comments/${id}/resolve`, {
      method: "POST",
      headers: { cookie: await signSessionCookie(seed.editorUserId) },
    });
    expect(res1.status).toBe(200);
    const json1 = await res1.json();
    expect(typeof json1.resolvedAt).toBe("string");
    expect(() => new Date(json1.resolvedAt).toISOString()).not.toThrow();
    expect(json1.resolvedBy).toBe(seed.editorUserId);

    const res2 = await app.request(`/api/comments/${id}/resolve`, {
      method: "POST",
      headers: { cookie: await signSessionCookie(seed.editorUserId) },
    });
    expect(res2.status).toBe(200);
    const json2 = await res2.json();
    expect(json2.resolvedAt).toBeNull();
    expect(json2.resolvedBy).toBeNull();
  });

  it("commenter (not author) cannot resolve unless they wrote it", async () => {
    const app = createApp();
    const createRes = await app.request(
      `/api/notes/${seed.noteId}/comments`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: await signSessionCookie(seed.editorUserId),
        },
        body: JSON.stringify({ body: "editor's comment" }),
      },
    );
    expect(createRes.status).toBe(201);
    const { id } = await createRes.json();

    const res = await app.request(`/api/comments/${id}/resolve`, {
      method: "POST",
      headers: { cookie: await signSessionCookie(seed.commenterUserId) },
    });
    expect(res.status).toBe(403);
  });
});
