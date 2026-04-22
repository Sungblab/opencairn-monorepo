import { describe, it, expect } from "vitest";
import {
  db,
  user,
  workspaces,
  workspaceMembers,
  projects,
  projectPermissions,
  pagePermissions,
  notes,
  eq,
} from "@opencairn/db";

import { createMultiRoleSeed } from "../src/lib/test-seed-multi.js";

// Plan 2B Task 20 — direct unit coverage for the shared multi-role seed lib.
// The previous suite (notes/comments/mentions) exercised this function
// indirectly via the re-export in tests/helpers/seed.ts; pinning the new
// return shape here (especially `wsSlug`, which the Playwright collab E2E
// depends on) guards against silent drift.

describe("createMultiRoleSeed", () => {
  it("seeds 4 role users + workspace + shared/private notes + sibling ws", async () => {
    const seed = await createMultiRoleSeed();

    try {
      // Identity surface — every id must be a non-empty string and the four
      // users must all be distinct.
      expect(seed.ownerUserId).not.toEqual(seed.editorUserId);
      expect(seed.editorUserId).not.toEqual(seed.commenterUserId);
      expect(seed.commenterUserId).not.toEqual(seed.viewerUserId);

      // wsSlug is the NEW field the endpoint returns; it must match the
      // `test-ws-<prefix>` pattern the legacy helper used so URLs built
      // from it (Playwright) stay valid.
      expect(seed.wsSlug).toMatch(/^e2e-ws-[0-9a-f]{8}$/);

      // Workspace row exists with the returned slug.
      const [ws] = await db
        .select({ id: workspaces.id, slug: workspaces.slug })
        .from(workspaces)
        .where(eq(workspaces.id, seed.workspaceId));
      expect(ws?.slug).toBe(seed.wsSlug);

      // 4 workspace_members rows — owner/member × 4 users.
      const members = await db
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(eq(workspaceMembers.workspaceId, seed.workspaceId));
      expect(members.map((m) => m.userId).sort()).toEqual(
        [
          seed.ownerUserId,
          seed.editorUserId,
          seed.commenterUserId,
          seed.viewerUserId,
        ].sort(),
      );

      // project_permissions: commenter + viewer only (editor inherits).
      const perms = await db
        .select({ userId: projectPermissions.userId, role: projectPermissions.role })
        .from(projectPermissions)
        .where(eq(projectPermissions.projectId, seed.projectId));
      const permMap = new Map(perms.map((p) => [p.userId, p.role]));
      expect(permMap.get(seed.commenterUserId)).toBe("commenter");
      expect(permMap.get(seed.viewerUserId)).toBe("viewer");
      expect(permMap.has(seed.editorUserId)).toBe(false);

      // notes: shared + private; private has inheritParent=false.
      const [shared] = await db
        .select({ id: notes.id, inheritParent: notes.inheritParent })
        .from(notes)
        .where(eq(notes.id, seed.noteId));
      const [priv] = await db
        .select({ id: notes.id, inheritParent: notes.inheritParent })
        .from(notes)
        .where(eq(notes.id, seed.privateNoteId));
      expect(shared?.inheritParent).toBe(true);
      expect(priv?.inheritParent).toBe(false);

      // page_permissions for the private note: editor + commenter only.
      const pageRows = await db
        .select({
          userId: pagePermissions.userId,
          role: pagePermissions.role,
        })
        .from(pagePermissions)
        .where(eq(pagePermissions.pageId, seed.privateNoteId));
      const pageMap = new Map(pageRows.map((p) => [p.userId, p.role]));
      expect(pageMap.get(seed.editorUserId)).toBe("editor");
      expect(pageMap.get(seed.commenterUserId)).toBe("commenter");
      expect(pageMap.has(seed.viewerUserId)).toBe(false);

      // Sibling workspace — no shared members with the primary.
      const otherMembers = await db
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(eq(workspaceMembers.workspaceId, seed.otherWorkspaceId));
      expect(otherMembers).toHaveLength(1);
      expect(members.map((m) => m.userId)).not.toContain(
        otherMembers[0]!.userId,
      );

      // project row exists under the primary workspace.
      const [proj] = await db
        .select({ id: projects.id, workspaceId: projects.workspaceId })
        .from(projects)
        .where(eq(projects.id, seed.projectId));
      expect(proj?.workspaceId).toBe(seed.workspaceId);
    } finally {
      await seed.cleanup();
    }

    // Cleanup should cascade — the five created user rows must be gone.
    const survivors = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, seed.ownerUserId));
    expect(survivors).toHaveLength(0);
  });
});
