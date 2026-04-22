import { randomUUID } from "node:crypto";
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

// Plan 2B Task 20 — production-safe counterpart of the test-only
// `seedMultiRoleWorkspace()` in apps/api/tests/helpers/seed.ts. Extracted so
// the Playwright-facing `/api/internal/test-seed-multi-role` endpoint and the
// Vitest integration helper share a single seeding codepath.
//
// The function itself is not gated — it's pure data-insertion. The endpoint
// that wraps it MUST gate on NODE_ENV !== "production" and the
// INTERNAL_API_SECRET header (same pattern as `/api/internal/test-seed`).

interface CreatedUser {
  id: string;
  email: string;
  name: string;
}

async function createTestUser(): Promise<CreatedUser> {
  const id = randomUUID();
  const email = `e2e-${id}@example.com`;
  const name = `E2E User ${id.slice(0, 8)}`;
  await db.insert(user).values({ id, email, name, emailVerified: true });
  return { id, email, name };
}

export interface MultiRoleSeed {
  workspaceId: string;
  wsSlug: string;
  projectId: string;
  /** Shared note — all four role users have read access; editor can write. */
  noteId: string;
  /** Private note — inheritParent=false; viewer has no access. */
  privateNoteId: string;
  /** Sibling workspace with no shared members (cross-workspace isolation). */
  otherWorkspaceId: string;
  ownerUserId: string;
  editorUserId: string;
  commenterUserId: string;
  viewerUserId: string;
  /**
   * Reverses every insert. Callers (vitest helpers) MUST await this in
   * afterEach. The HTTP endpoint leaves rows in place — test-db is cleaned
   * out between runs.
   */
  cleanup: () => Promise<void>;
}

export async function createMultiRoleSeed(): Promise<MultiRoleSeed> {
  const ownerUser = await createTestUser();
  const editorUser = await createTestUser();
  const commenterUser = await createTestUser();
  const viewerUser = await createTestUser();

  const workspaceId = randomUUID();
  const wsSlug = `e2e-ws-${workspaceId.slice(0, 8)}`;
  await db.insert(workspaces).values({
    id: workspaceId,
    slug: wsSlug,
    name: "E2E Workspace (multi-role)",
    ownerId: ownerUser.id,
    planType: "free",
  });

  await db.insert(workspaceMembers).values([
    { workspaceId, userId: ownerUser.id, role: "owner" },
    { workspaceId, userId: editorUser.id, role: "member" },
    { workspaceId, userId: commenterUser.id, role: "member" },
    { workspaceId, userId: viewerUser.id, role: "member" },
  ]);

  const projectId = randomUUID();
  await db.insert(projects).values({
    id: projectId,
    workspaceId,
    name: "E2E Project (multi-role)",
    createdBy: ownerUser.id,
    defaultRole: "editor",
  });

  // editor inherits defaultRole="editor" from project; commenter + viewer
  // need explicit overrides.
  await db.insert(projectPermissions).values([
    { projectId, userId: commenterUser.id, role: "commenter" },
    { projectId, userId: viewerUser.id, role: "viewer" },
  ]);

  // Shared note — all 4 users have access; editor can write.
  const noteId = randomUUID();
  await db.insert(notes).values({
    id: noteId,
    projectId,
    workspaceId,
    title: "shared note",
    inheritParent: true,
  });

  // Private note — inheritParent=false + no pagePermissions → viewer = none.
  // Owner/editor/commenter get explicit page-level access.
  const privateNoteId = randomUUID();
  await db.insert(notes).values({
    id: privateNoteId,
    projectId,
    workspaceId,
    title: "private note",
    inheritParent: false,
  });
  await db.insert(pagePermissions).values([
    { pageId: privateNoteId, userId: editorUser.id, role: "editor" },
    { pageId: privateNoteId, userId: commenterUser.id, role: "commenter" },
  ]);

  // Sibling workspace — different owner, zero shared members.
  const otherOwner = await createTestUser();
  const otherWorkspaceId = randomUUID();
  await db.insert(workspaces).values({
    id: otherWorkspaceId,
    slug: `e2e-ws-${otherWorkspaceId.slice(0, 8)}`,
    name: "Other Workspace",
    ownerId: otherOwner.id,
    planType: "free",
  });
  await db.insert(workspaceMembers).values({
    workspaceId: otherWorkspaceId,
    userId: otherOwner.id,
    role: "owner",
  });

  const createdUserIds = [
    ownerUser.id,
    editorUser.id,
    commenterUser.id,
    viewerUser.id,
    otherOwner.id,
  ];

  const cleanup = async () => {
    const errors: unknown[] = [];
    for (const wsId of [workspaceId, otherWorkspaceId]) {
      try {
        await db.delete(workspaces).where(eq(workspaces.id, wsId));
      } catch (e) {
        errors.push(e);
      }
    }
    for (const uid of createdUserIds) {
      try {
        await db.delete(user).where(eq(user.id, uid));
      } catch (e) {
        errors.push(e);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "multi-role cleanup partial failure");
    }
  };

  return {
    workspaceId,
    wsSlug,
    projectId,
    noteId,
    privateNoteId,
    otherWorkspaceId,
    ownerUserId: ownerUser.id,
    editorUserId: editorUser.id,
    commenterUserId: commenterUser.id,
    viewerUserId: viewerUser.id,
    cleanup,
  };
}
