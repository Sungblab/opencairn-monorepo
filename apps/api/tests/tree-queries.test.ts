import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { db, folders, notes, eq } from "@opencairn/db";
import { seedWorkspace, type SeedResult } from "./helpers/seed";
import {
  labelFromId,
  listChildren,
  listChildrenForParents,
  getFolderSubtree,
  moveFolder,
  moveNote,
} from "../src/lib/tree-queries";

async function insertFolder(opts: {
  projectId: string;
  parentId: string | null;
  name: string;
  parentPath?: string;
}): Promise<{ id: string; path: string }> {
  const id = randomUUID();
  const path = opts.parentPath
    ? `${opts.parentPath}.${labelFromId(id)}`
    : labelFromId(id);
  await db.insert(folders).values({
    id,
    projectId: opts.projectId,
    parentId: opts.parentId,
    name: opts.name,
    path,
  });
  return { id, path };
}

async function insertNote(opts: {
  projectId: string;
  workspaceId: string;
  folderId: string | null;
  title: string;
}): Promise<string> {
  const id = randomUUID();
  await db.insert(notes).values({
    id,
    projectId: opts.projectId,
    workspaceId: opts.workspaceId,
    folderId: opts.folderId,
    title: opts.title,
  });
  return id;
}

describe("tree-queries", () => {
  let seed: SeedResult;

  beforeEach(async () => {
    seed = await seedWorkspace({ role: "owner" });
  });

  afterEach(async () => {
    await seed.cleanup();
  });

  describe("listChildren", () => {
    it("returns direct child folders + notes of a folder, folders first", async () => {
      const root = await insertFolder({
        projectId: seed.projectId,
        parentId: null,
        name: "Root",
      });
      const childFolder = await insertFolder({
        projectId: seed.projectId,
        parentId: root.id,
        name: "Child folder",
        parentPath: root.path,
      });
      const leafNoteId = await insertNote({
        projectId: seed.projectId,
        workspaceId: seed.workspaceId,
        folderId: root.id,
        title: "Leaf note",
      });

      const rows = await listChildren({
        projectId: seed.projectId,
        parentId: root.id,
      });

      expect(rows.map((r) => `${r.kind}:${r.id}`)).toEqual(
        expect.arrayContaining([
          `folder:${childFolder.id}`,
          `note:${leafNoteId}`,
        ]),
      );
      const firstFolderIdx = rows.findIndex((r) => r.kind === "folder");
      const firstNoteIdx = rows.findIndex((r) => r.kind === "note");
      expect(firstFolderIdx).toBeLessThan(firstNoteIdx);
    });

    it("returns root folders and root-level notes when parentId is null", async () => {
      const rootFolder = await insertFolder({
        projectId: seed.projectId,
        parentId: null,
        name: "R",
      });
      const rootNoteId = await insertNote({
        projectId: seed.projectId,
        workspaceId: seed.workspaceId,
        folderId: null,
        title: "root-level note",
      });

      const rows = await listChildren({
        projectId: seed.projectId,
        parentId: null,
      });
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(rootFolder.id);
      expect(ids).toContain(rootNoteId);
      expect(ids).toContain(seed.noteId); // seedWorkspace's note is at root too
    });

    it("folder childCount counts subfolders AND direct notes", async () => {
      const root = await insertFolder({
        projectId: seed.projectId,
        parentId: null,
        name: "Root",
      });
      await insertFolder({
        projectId: seed.projectId,
        parentId: root.id,
        name: "sub1",
        parentPath: root.path,
      });
      await insertFolder({
        projectId: seed.projectId,
        parentId: root.id,
        name: "sub2",
        parentPath: root.path,
      });
      await insertNote({
        projectId: seed.projectId,
        workspaceId: seed.workspaceId,
        folderId: root.id,
        title: "n1",
      });

      const rowsAtRoot = await listChildren({
        projectId: seed.projectId,
        parentId: null,
      });
      const rootRow = rowsAtRoot.find((r) => r.id === root.id);
      expect(rootRow?.childCount).toBe(3);
    });

    it("excludes soft-deleted notes", async () => {
      const folder = await insertFolder({
        projectId: seed.projectId,
        parentId: null,
        name: "F",
      });
      const activeId = await insertNote({
        projectId: seed.projectId,
        workspaceId: seed.workspaceId,
        folderId: folder.id,
        title: "active",
      });
      const deletedId = await insertNote({
        projectId: seed.projectId,
        workspaceId: seed.workspaceId,
        folderId: folder.id,
        title: "deleted",
      });
      await db
        .update(notes)
        .set({ deletedAt: new Date() })
        .where(eq(notes.id, deletedId));

      const rows = await listChildren({
        projectId: seed.projectId,
        parentId: folder.id,
      });
      const ids = rows.filter((r) => r.kind === "note").map((r) => r.id);
      expect(ids).toContain(activeId);
      expect(ids).not.toContain(deletedId);
    });

    it("is scoped to the caller's project", async () => {
      const other = await seedWorkspace({ role: "owner" });
      try {
        await insertFolder({
          projectId: other.projectId,
          parentId: null,
          name: "outside",
        });

        const rows = await listChildren({
          projectId: seed.projectId,
          parentId: null,
        });
        // Only seed's rows surface — outside project folder is invisible.
        expect(rows.every((r) => r.label !== "outside")).toBe(true);
      } finally {
        await other.cleanup();
      }
    });
  });

  describe("listChildrenForParents", () => {
    it("batches many folder parents into one query", async () => {
      const r1 = await insertFolder({
        projectId: seed.projectId,
        parentId: null,
        name: "R1",
      });
      const r2 = await insertFolder({
        projectId: seed.projectId,
        parentId: null,
        name: "R2",
      });
      await insertFolder({
        projectId: seed.projectId,
        parentId: r1.id,
        name: "a",
        parentPath: r1.path,
      });
      await insertFolder({
        projectId: seed.projectId,
        parentId: r1.id,
        name: "b",
        parentPath: r1.path,
      });
      await insertNote({
        projectId: seed.projectId,
        workspaceId: seed.workspaceId,
        folderId: r2.id,
        title: "n",
      });

      const grouped = await listChildrenForParents({
        projectId: seed.projectId,
        parentIds: [r1.id, r2.id],
      });
      expect(
        grouped.get(r1.id)?.filter((r) => r.kind === "folder"),
      ).toHaveLength(2);
      expect(
        grouped.get(r2.id)?.filter((r) => r.kind === "note"),
      ).toHaveLength(1);
    });

    it("returns an empty Map for empty input", async () => {
      const grouped = await listChildrenForParents({
        projectId: seed.projectId,
        parentIds: [],
      });
      expect(grouped.size).toBe(0);
    });

    it("preserves empty arrays for parents without children", async () => {
      const r1 = await insertFolder({
        projectId: seed.projectId,
        parentId: null,
        name: "R1",
      });
      const r2 = await insertFolder({
        projectId: seed.projectId,
        parentId: null,
        name: "R2",
      });

      const grouped = await listChildrenForParents({
        projectId: seed.projectId,
        parentIds: [r1.id, r2.id],
      });
      expect(grouped.get(r1.id)).toEqual([]);
      expect(grouped.get(r2.id)).toEqual([]);
    });
  });

  describe("getFolderSubtree", () => {
    it("returns folders only, ordered by depth", async () => {
      const root = await insertFolder({
        projectId: seed.projectId,
        parentId: null,
        name: "Root",
      });
      const a = await insertFolder({
        projectId: seed.projectId,
        parentId: root.id,
        name: "A",
        parentPath: root.path,
      });
      const a1 = await insertFolder({
        projectId: seed.projectId,
        parentId: a.id,
        name: "A1",
        parentPath: a.path,
      });
      // A note under the root must NOT appear in the subtree result.
      await insertNote({
        projectId: seed.projectId,
        workspaceId: seed.workspaceId,
        folderId: root.id,
        title: "not in subtree",
      });

      const rows = await getFolderSubtree({
        projectId: seed.projectId,
        rootFolderId: root.id,
      });
      const ids = rows.map((r) => r.id);
      expect(rows.every((r) => r.kind === "folder")).toBe(true);
      expect(ids[0]).toBe(root.id); // root comes first (nlevel = 1)
      expect(ids.slice(1).sort()).toEqual([a.id, a1.id].sort());
    });
  });

  describe("moveFolder", () => {
    it("reparents a folder and rewrites descendant paths", async () => {
      const f1 = await insertFolder({
        projectId: seed.projectId,
        parentId: null,
        name: "F1",
      });
      const f2 = await insertFolder({
        projectId: seed.projectId,
        parentId: null,
        name: "F2",
      });
      const child = await insertFolder({
        projectId: seed.projectId,
        parentId: f1.id,
        name: "child",
        parentPath: f1.path,
      });
      const grand = await insertFolder({
        projectId: seed.projectId,
        parentId: child.id,
        name: "grand",
        parentPath: child.path,
      });

      await moveFolder({
        projectId: seed.projectId,
        folderId: child.id,
        newParentId: f2.id,
      });

      const afterSub = await getFolderSubtree({
        projectId: seed.projectId,
        rootFolderId: f2.id,
      });
      const ids = afterSub.map((r) => r.id).sort();
      expect(ids).toEqual([f2.id, child.id, grand.id].sort());

      const [moved] = await db
        .select({ parentId: folders.parentId, path: folders.path })
        .from(folders)
        .where(eq(folders.id, child.id));
      expect(moved.parentId).toBe(f2.id);
      expect(moved.path.startsWith(`${f2.path}.`)).toBe(true);

      const [movedGrand] = await db
        .select({ path: folders.path })
        .from(folders)
        .where(eq(folders.id, grand.id));
      expect(movedGrand.path.startsWith(`${f2.path}.`)).toBe(true);
    });

    it("promotes a folder to root when newParentId is null", async () => {
      const root = await insertFolder({
        projectId: seed.projectId,
        parentId: null,
        name: "root",
      });
      const child = await insertFolder({
        projectId: seed.projectId,
        parentId: root.id,
        name: "child",
        parentPath: root.path,
      });

      await moveFolder({
        projectId: seed.projectId,
        folderId: child.id,
        newParentId: null,
      });

      const [moved] = await db
        .select({ parentId: folders.parentId, path: folders.path })
        .from(folders)
        .where(eq(folders.id, child.id));
      expect(moved.parentId).toBeNull();
      expect(moved.path).toBe(labelFromId(child.id));
    });

    it("refuses a cross-project parent target", async () => {
      const other = await seedWorkspace({ role: "owner" });
      try {
        const here = await insertFolder({
          projectId: seed.projectId,
          parentId: null,
          name: "here",
        });
        const outside = await insertFolder({
          projectId: other.projectId,
          parentId: null,
          name: "outside",
        });

        await expect(
          moveFolder({
            projectId: seed.projectId,
            folderId: here.id,
            newParentId: outside.id,
          }),
        ).rejects.toThrow(/cross-project|not found/i);
      } finally {
        await other.cleanup();
      }
    });

    it("refuses when the folder itself is not in the claimed project", async () => {
      const other = await seedWorkspace({ role: "owner" });
      try {
        const outside = await insertFolder({
          projectId: other.projectId,
          parentId: null,
          name: "outside",
        });
        await expect(
          moveFolder({
            projectId: seed.projectId,
            folderId: outside.id,
            newParentId: null,
          }),
        ).rejects.toThrow(/not found/i);
      } finally {
        await other.cleanup();
      }
    });
  });

  describe("moveNote", () => {
    it("updates folder_id and accepts null (move to root)", async () => {
      const f1 = await insertFolder({
        projectId: seed.projectId,
        parentId: null,
        name: "F1",
      });
      const noteId = await insertNote({
        projectId: seed.projectId,
        workspaceId: seed.workspaceId,
        folderId: f1.id,
        title: "n",
      });

      await moveNote({
        projectId: seed.projectId,
        noteId,
        newFolderId: null,
      });

      const [moved] = await db
        .select({ folderId: notes.folderId })
        .from(notes)
        .where(eq(notes.id, noteId));
      expect(moved.folderId).toBeNull();
    });

    it("refuses a cross-project target folder", async () => {
      const other = await seedWorkspace({ role: "owner" });
      try {
        const outsideFolder = await insertFolder({
          projectId: other.projectId,
          parentId: null,
          name: "outside",
        });
        await expect(
          moveNote({
            projectId: seed.projectId,
            noteId: seed.noteId,
            newFolderId: outsideFolder.id,
          }),
        ).rejects.toThrow(/cross-project|not found/i);
      } finally {
        await other.cleanup();
      }
    });

    it("refuses when the note is not in the claimed project", async () => {
      const other = await seedWorkspace({ role: "owner" });
      try {
        await expect(
          moveNote({
            projectId: seed.projectId,
            noteId: other.noteId,
            newFolderId: null,
          }),
        ).rejects.toThrow(/not found/i);
      } finally {
        await other.cleanup();
      }
    });
  });
});
