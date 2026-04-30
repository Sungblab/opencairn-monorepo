import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  captureNoteVersion,
  db,
  eq,
  noteVersions,
  notes,
  yjsDocuments,
} from "@opencairn/db";

import { createApp } from "../src/app.js";
import {
  seedMultiRoleWorkspace,
  type SeedMultiRoleResult,
} from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

const app = createApp();

async function authedFetch(
  path: string,
  init: RequestInit & { userId: string },
): Promise<Response> {
  const { userId, headers, ...rest } = init;
  const cookie = await signSessionCookie(userId);
  return app.request(path, {
    ...rest,
    headers: {
      ...(headers ?? {}),
      cookie,
      "content-type": "application/json",
    },
  });
}

async function seedVersion(seed: SeedMultiRoleResult) {
  await db
    .update(notes)
    .set({
      title: "Current",
      content: [{ type: "p", children: [{ text: "current" }] }],
      contentText: "current",
    })
    .where(eq(notes.id, seed.noteId));
  await db
    .insert(yjsDocuments)
    .values({
      name: `page:${seed.noteId}`,
      state: new Uint8Array([9]),
      stateVector: new Uint8Array([10]),
      sizeBytes: 1,
    })
    .onConflictDoUpdate({
      target: yjsDocuments.name,
      set: {
        state: new Uint8Array([9]),
        stateVector: new Uint8Array([10]),
        sizeBytes: 1,
      },
    });
  return captureNoteVersion({
    noteId: seed.noteId,
    title: "Old",
    content: [{ type: "p", children: [{ text: "old" }] }],
    contentText: "old",
    yjsState: new Uint8Array([1]),
    yjsStateVector: new Uint8Array([2]),
    source: "manual_checkpoint",
    actorType: "user",
    actorId: seed.editorUserId,
    reason: "seed",
    force: true,
  });
}

describe("note version routes", () => {
  let seed: SeedMultiRoleResult;

  beforeEach(async () => {
    seed = await seedMultiRoleWorkspace();
    await seedVersion(seed);
  });

  afterEach(async () => {
    await seed.cleanup();
  });

  it("lists versions for readers", async () => {
    const res = await authedFetch(`/api/notes/${seed.noteId}/versions`, {
      method: "GET",
      userId: seed.viewerUserId,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { versions: Array<{ version: number }> };
    expect(body.versions[0]?.version).toBe(1);
  });

  it("returns 403 for users without note read access", async () => {
    const res = await authedFetch(`/api/notes/${seed.privateNoteId}/versions`, {
      method: "GET",
      userId: seed.viewerUserId,
    });

    expect(res.status).toBe(403);
  });

  it("returns a version detail", async () => {
    const res = await authedFetch(`/api/notes/${seed.noteId}/versions/1`, {
      method: "GET",
      userId: seed.viewerUserId,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { title: string; contentText: string };
    expect(body.title).toBe("Old");
    expect(body.contentText).toBe("old");
  });

  it("returns a diff against current", async () => {
    const res = await authedFetch(`/api/notes/${seed.noteId}/versions/1/diff`, {
      method: "GET",
      userId: seed.viewerUserId,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { summary: { changedBlocks: number } };
    expect(body.summary.changedBlocks).toBe(1);
  });

  it("creates a manual checkpoint for writers", async () => {
    const res = await authedFetch(
      `/api/notes/${seed.noteId}/versions/checkpoint`,
      {
        method: "POST",
        userId: seed.editorUserId,
        body: JSON.stringify({ reason: "manual" }),
      },
    );

    expect(res.status).toBe(201);
    const rows = await db
      .select()
      .from(noteVersions)
      .where(eq(noteVersions.noteId, seed.noteId));
    expect(rows).toHaveLength(2);
  });

  it("rejects checkpoint for read-only users", async () => {
    const res = await authedFetch(
      `/api/notes/${seed.noteId}/versions/checkpoint`,
      {
        method: "POST",
        userId: seed.viewerUserId,
        body: JSON.stringify({}),
      },
    );

    expect(res.status).toBe(403);
  });

  it("restores a version for writers", async () => {
    const res = await authedFetch(
      `/api/notes/${seed.noteId}/versions/1/restore`,
      {
        method: "POST",
        userId: seed.editorUserId,
      },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { newVersion: number };
    expect(body.newVersion).toBe(3);
    const [note] = await db
      .select()
      .from(notes)
      .where(eq(notes.id, seed.noteId));
    expect(note?.title).toBe("Old");
  });

  it("rejects restore for read-only users", async () => {
    const res = await authedFetch(
      `/api/notes/${seed.noteId}/versions/1/restore`,
      {
        method: "POST",
        userId: seed.viewerUserId,
      },
    );

    expect(res.status).toBe(403);
  });
});
