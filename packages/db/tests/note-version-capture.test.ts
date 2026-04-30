import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  captureNoteVersion,
  db,
  eq,
  noteVersions,
  notes,
  projects,
  restoreNoteVersion,
  user,
  workspaces,
  yjsDocuments,
} from "../src";

async function seedNote() {
  const userId = randomUUID();
  await db.insert(user).values({
    id: userId,
    email: `${userId}@example.com`,
    name: "Version Tester",
    emailVerified: false,
  });
  const [workspace] = await db
    .insert(workspaces)
    .values({
      name: "Version Workspace",
      slug: `version-${randomUUID().slice(0, 8)}`,
      ownerId: userId,
    })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({
      name: "Version Project",
      workspaceId: workspace!.id,
      createdBy: userId,
    })
    .returning();
  const [note] = await db
    .insert(notes)
    .values({
      title: "seed",
      workspaceId: workspace!.id,
      projectId: project!.id,
      content: [{ type: "p", children: [{ text: "seed" }] }],
      contentText: "seed",
    })
    .returning();

  return {
    userId,
    noteId: note!.id,
    cleanup: async () => {
      await db.delete(workspaces).where(eq(workspaces.id, workspace!.id));
      await db.delete(user).where(eq(user.id, userId));
    },
  };
}

describe("note version capture", () => {
  let cleanup: (() => Promise<void>) | undefined;

  beforeEach(() => {
    cleanup = undefined;
  });

  afterEach(async () => {
    await cleanup?.();
  });

  it("creates version 1 and skips exact duplicate hashes", async () => {
    const seed = await seedNote();
    cleanup = seed.cleanup;

    const input = {
      noteId: seed.noteId,
      title: "First",
      content: [{ type: "p", children: [{ text: "hello" }] }],
      contentText: "hello",
      yjsState: new Uint8Array([1]),
      yjsStateVector: new Uint8Array([2]),
      source: "manual_checkpoint" as const,
      actorType: "user" as const,
      actorId: seed.userId,
      reason: "test",
      force: true,
    };

    const first = await captureNoteVersion(input);
    const second = await captureNoteVersion(input);

    expect(first).toEqual({ created: true, version: 1 });
    expect(second).toEqual({ created: false, version: 1 });
    const rows = await db
      .select()
      .from(noteVersions)
      .where(eq(noteVersions.noteId, seed.noteId));
    expect(rows).toHaveLength(1);
  });

  it("throttles small automatic snapshots", async () => {
    const seed = await seedNote();
    cleanup = seed.cleanup;

    await captureNoteVersion({
      noteId: seed.noteId,
      title: "Auto",
      content: [{ type: "p", children: [{ text: "short" }] }],
      contentText: "short",
      yjsState: new Uint8Array([1]),
      yjsStateVector: new Uint8Array([2]),
      source: "auto_save",
      actorType: "system",
      actorId: null,
    });
    const second = await captureNoteVersion({
      noteId: seed.noteId,
      title: "Auto",
      content: [{ type: "p", children: [{ text: "short edit" }] }],
      contentText: "short edit",
      yjsState: new Uint8Array([3]),
      yjsStateVector: new Uint8Array([4]),
      source: "auto_save",
      actorType: "system",
      actorId: null,
    });

    expect(second).toEqual({ created: false, version: 1 });
  });

  it("restores a historical version and creates a new latest version", async () => {
    const seed = await seedNote();
    cleanup = seed.cleanup;

    await captureNoteVersion({
      noteId: seed.noteId,
      title: "Old",
      content: [{ type: "p", children: [{ text: "old" }] }],
      contentText: "old",
      yjsState: new Uint8Array([1]),
      yjsStateVector: new Uint8Array([2]),
      source: "manual_checkpoint",
      actorType: "user",
      actorId: seed.userId,
      reason: "old checkpoint",
      force: true,
    });
    await db
      .update(notes)
      .set({
        title: "Current",
        content: [{ type: "p", children: [{ text: "current" }] }],
        contentText: "current",
      })
      .where(eq(notes.id, seed.noteId));
    await db.insert(yjsDocuments).values({
      name: `page:${seed.noteId}`,
      state: new Uint8Array([5]),
      stateVector: new Uint8Array([6]),
      sizeBytes: 1,
    });

    const restored = await restoreNoteVersion({
      noteId: seed.noteId,
      version: 1,
      actorId: seed.userId,
    });

    expect(restored.newVersion).toBe(3);
    const [note] = await db
      .select()
      .from(notes)
      .where(eq(notes.id, seed.noteId));
    expect(note?.title).toBe("Old");
    const [doc] = await db
      .select()
      .from(yjsDocuments)
      .where(eq(yjsDocuments.name, `page:${seed.noteId}`));
    expect(Array.from(doc!.state)).toEqual([1]);
  });
});
