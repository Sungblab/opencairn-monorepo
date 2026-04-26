import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "../src/app.js";
import { db, notifications, eq, and } from "@opencairn/db";
import {
  seedMultiRoleWorkspace,
  type SeedMultiRoleResult,
} from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

// Plan 2C Task 5 — `comment_reply` notification fan-out fires from the
// comment POST route AFTER the insert tx commits. The new block sits as a
// sibling to the existing `mention` fan-out (App Shell Phase 5 Task 9).
//
// Rules:
//   - reply (parentId set) by a different user → parent author gets one
//     `comment_reply` row with payload {noteId, commentId, parentCommentId,
//     fromUserId, summary}.
//   - self-reply → no `comment_reply` row for the actor.
//   - top-level comment (parentId null) → no `comment_reply` rows at all.
//   - mention + comment_reply double-fire is allowed (both meaningful) and
//     these tests intentionally do NOT mention the parent author so the
//     comment_reply assertion isn't muddied by mention rows.

describe("POST /api/notes/:noteId/comments → comment_reply notification", () => {
  let seed: SeedMultiRoleResult;

  beforeEach(async () => {
    seed = await seedMultiRoleWorkspace();
  });

  afterEach(async () => {
    await seed.cleanup();
  });

  async function postComment(opts: {
    actorId: string;
    body: string;
    parentId?: string;
    anchorBlockId?: string;
  }): Promise<{ id: string; status: number; json: Record<string, unknown> }> {
    const app = createApp();
    const res = await app.request(`/api/notes/${seed.noteId}/comments`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: await signSessionCookie(opts.actorId),
      },
      body: JSON.stringify({
        body: opts.body,
        ...(opts.parentId ? { parentId: opts.parentId } : {}),
        ...(opts.anchorBlockId ? { anchorBlockId: opts.anchorBlockId } : {}),
      }),
    });
    const json = (await res.json()) as Record<string, unknown>;
    return { id: json.id as string, status: res.status, json };
  }

  it("notifies the parent author when a different user replies", async () => {
    // owner posts the top-level comment; editor replies.
    const parent = await postComment({
      actorId: seed.ownerUserId,
      body: "top level by owner",
    });
    expect(parent.status).toBe(201);

    const reply = await postComment({
      actorId: seed.editorUserId,
      body: "reply body from editor",
      parentId: parent.id,
    });
    expect(reply.status).toBe(201);

    const rows = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, seed.ownerUserId),
          eq(notifications.kind, "comment_reply"),
        ),
      );
    expect(rows).toHaveLength(1);
    const payload = rows[0]!.payload as Record<string, unknown>;
    expect(payload.noteId).toBe(seed.noteId);
    expect(payload.commentId).toBe(reply.id);
    expect(payload.parentCommentId).toBe(parent.id);
    expect(payload.fromUserId).toBe(seed.editorUserId);
    expect(typeof payload.summary).toBe("string");
    expect(payload.summary as string).toContain("reply body from editor");
  });

  it("does not fire on self-reply", async () => {
    // editor posts top-level then replies to their own comment.
    const parent = await postComment({
      actorId: seed.editorUserId,
      body: "self top",
    });
    expect(parent.status).toBe(201);

    const reply = await postComment({
      actorId: seed.editorUserId,
      body: "self reply",
      parentId: parent.id,
    });
    expect(reply.status).toBe(201);

    const rows = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, seed.editorUserId),
          eq(notifications.kind, "comment_reply"),
        ),
      );
    expect(rows).toHaveLength(0);
  });

  it("does not fire on a top-level comment (parentId null)", async () => {
    const top = await postComment({
      actorId: seed.editorUserId,
      body: "top-level only",
    });
    expect(top.status).toBe(201);

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.kind, "comment_reply"));
    expect(rows).toHaveLength(0);
  });
});
