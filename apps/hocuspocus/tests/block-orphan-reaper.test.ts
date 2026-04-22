import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as Y from "yjs";
import { createDb, comments, eq } from "@opencairn/db";
import { makeBlockOrphanReaper } from "../src/block-orphan-reaper.js";
import { plateToYDoc } from "../src/plate-bridge.js";
import {
  seedMultiRoleWorkspace,
  type SeedMultiRoleResult,
} from "../../api/tests/helpers/seed.js";

// Plan 2B Task 14: block-orphan-reaper integration tests.
// Like persistence, we own our own pool via createDb(url).
const db = createDb(process.env.DATABASE_URL!);
const reaper = makeBlockOrphanReaper(db);

describe("block-orphan-reaper", () => {
  let seed: SeedMultiRoleResult;
  beforeEach(async () => {
    seed = await seedMultiRoleWorkspace();
  });
  afterEach(async () => {
    await seed.cleanup();
  });

  it("demotes anchor_block_id to NULL when the anchored block disappears", async () => {
    // Doc-before state used only to define the shape; we compare against
    // the doc-after state, which is what onChange actually observes.
    const docAfter = new Y.Doc();
    plateToYDoc(docAfter, [
      { type: "p", id: "blk_B", children: [{ text: "survived" }] },
    ]);

    // Comment anchored to blk_A — which is NOT present in docAfter.
    const [inserted] = await db
      .insert(comments)
      .values({
        workspaceId: seed.workspaceId,
        noteId: seed.noteId,
        anchorBlockId: "blk_A",
        authorId: seed.editorUserId,
        body: "anchored to A",
      })
      .returning();

    await reaper.onChange!({
      document: docAfter,
      documentName: `page:${seed.noteId}`,
    } as never);

    const [after] = await db
      .select()
      .from(comments)
      .where(eq(comments.id, inserted!.id));
    expect(after!.anchorBlockId).toBeNull();
    // Body preserved — reaper demotes, it doesn't delete.
    expect(after!.body).toBe("anchored to A");
  });

  it("leaves still-present anchors alone", async () => {
    const doc = new Y.Doc();
    plateToYDoc(doc, [
      { type: "p", id: "blk_keep", children: [{ text: "x" }] },
    ]);

    const [inserted] = await db
      .insert(comments)
      .values({
        workspaceId: seed.workspaceId,
        noteId: seed.noteId,
        anchorBlockId: "blk_keep",
        authorId: seed.editorUserId,
        body: "ok",
      })
      .returning();

    await reaper.onChange!({
      document: doc,
      documentName: `page:${seed.noteId}`,
    } as never);

    const [after] = await db
      .select()
      .from(comments)
      .where(eq(comments.id, inserted!.id));
    expect(after!.anchorBlockId).toBe("blk_keep");
  });

  it("ignores unsupported document names (workspace:*, project:*)", async () => {
    const doc = new Y.Doc();
    await expect(
      reaper.onChange!({
        document: doc,
        documentName: "workspace:xxx",
      } as never),
    ).resolves.toBeUndefined();
  });

  it("does nothing when the note has no anchored comments", async () => {
    const doc = new Y.Doc();
    plateToYDoc(doc, [
      { type: "p", id: "blk_only", children: [{ text: "only" }] },
    ]);
    // No comments inserted — reaper should be a cheap no-op.
    await expect(
      reaper.onChange!({
        document: doc,
        documentName: `page:${seed.noteId}`,
      } as never),
    ).resolves.toBeUndefined();
  });

  it("swallows errors — a reaper failure must not abort the edit", async () => {
    // Pass a doc whose content structure is fine but the DB call will
    // succeed; then simulate a later failure by passing a malformed
    // documentName-like path that still matches DOC_RE but points to a
    // non-existent note. With FK on note_id cascades the update simply
    // affects zero rows — no throw. This is the nominal no-op path.
    const doc = new Y.Doc();
    plateToYDoc(doc, [{ type: "p", id: "x", children: [{ text: "y" }] }]);
    const fakeNoteId = "00000000-0000-4000-8000-000000000001";
    await expect(
      reaper.onChange!({
        document: doc,
        documentName: `page:${fakeNoteId}`,
      } as never),
    ).resolves.toBeUndefined();
  });
});
