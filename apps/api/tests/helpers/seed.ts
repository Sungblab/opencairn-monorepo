import { randomUUID } from "crypto";
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

export type SeedRole = "viewer" | "editor" | "admin" | "owner";

export interface CreatedUser {
  id: string;
  email: string;
  name: string;
}

// Better Auth user 테이블에 최소 필수 컬럼으로 삽입
export async function createUser(): Promise<CreatedUser> {
  const id = randomUUID();
  const email = `test-${id}@example.com`;
  const name = `Test User ${id.slice(0, 8)}`;

  await db.insert(user).values({
    id,
    email,
    name,
    emailVerified: false,
  });

  return { id, email, name };
}

export interface SeedResult {
  userId: string;
  workspaceId: string;
  projectId: string;
  noteId: string;
  // 헬퍼 owner userId (role !== "owner" 경우 별도 생성됨)
  ownerUserId: string;
  cleanup: () => Promise<void>;
}

export async function seedWorkspace(opts: { role: SeedRole }): Promise<SeedResult> {
  const { role } = opts;

  // 1. 테스트 대상 유저 생성
  const testUser = await createUser();

  // 2. workspace owner 결정
  //    role==="owner" → testUser 자신이 owner
  //    그 외 → 별도 helper user가 owner
  let ownerUser: CreatedUser;
  if (role === "owner") {
    ownerUser = testUser;
  } else {
    ownerUser = await createUser();
  }

  // 3. workspace 삽입 (slug는 uuid prefix로 유일성 보장)
  const workspaceId = randomUUID();
  const slug = `test-ws-${workspaceId.slice(0, 8)}`;
  await db.insert(workspaces).values({
    id: workspaceId,
    slug,
    name: "Test Workspace",
    ownerId: ownerUser.id,
    planType: "free",
  });

  // 4. workspaceMembers 삽입
  //    owner / admin → workspace role 그대로
  //    editor / viewer → role="member" (project-level permission으로 구체화)
  const wsRole =
    role === "owner" ? "owner"
    : role === "admin" ? "admin"
    : "member";

  await db.insert(workspaceMembers).values({
    workspaceId,
    userId: testUser.id,
    role: wsRole,
  });

  // owner가 testUser와 다른 경우, owner 자신도 workspace member로 삽입
  if (ownerUser.id !== testUser.id) {
    await db.insert(workspaceMembers).values({
      workspaceId,
      userId: ownerUser.id,
      role: "owner",
    });
  }

  // 5. project 삽입
  const projectId = randomUUID();
  await db.insert(projects).values({
    id: projectId,
    workspaceId,
    name: "Test Project",
    createdBy: ownerUser.id,
    defaultRole: "editor",
  });

  // 6. note 삽입
  const noteId = randomUUID();
  await db.insert(notes).values({
    id: noteId,
    projectId,
    workspaceId,
    title: "test",
    inheritParent: true,
  });

  // 7. editor / viewer: projectPermissions 행 추가
  if (role === "editor" || role === "viewer") {
    await db.insert(projectPermissions).values({
      projectId,
      userId: testUser.id,
      role, // "editor" | "viewer"
    });
  }

  // 8. cleanup — workspace 삭제가 CASCADE로 members/invites/projects/notes/perms를 모두 정리.
  //    각 step을 독립적으로 try/catch해서 한 step 실패 시에도 나머지를 계속 시도.
  //    모든 오류는 AggregateError로 묶어 상위로 전파 (silent leak 불가).
  const cleanup = async () => {
    const errors: unknown[] = [];

    // 1. workspace 삭제 → CASCADE: members, invites, projects, notes, projectPerms, pagePerms
    try {
      await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    } catch (e) {
      errors.push(e);
    }

    // 2. user 삭제 (workspace가 먼저 삭제되어야 ownerId FK RESTRICT를 통과)
    try {
      await db.delete(user).where(eq(user.id, testUser.id));
    } catch (e) {
      errors.push(e);
    }
    if (ownerUser.id !== testUser.id) {
      try {
        await db.delete(user).where(eq(user.id, ownerUser.id));
      } catch (e) {
        errors.push(e);
      }
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, "cleanup partial failure");
    }
  };

  return {
    userId: testUser.id,
    workspaceId,
    projectId,
    noteId,
    ownerUserId: ownerUser.id,
    cleanup,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Plan 2B: multi-role seed for comments + collab tests.
// Existing seedWorkspace({role}) returns a single-user context — left untouched.
// This helper builds one workspace with owner/editor/commenter/viewer roles
// simultaneously, plus a private note (viewer blocked) and a sibling workspace
// (no shared members) for cross-workspace isolation tests.
// ────────────────────────────────────────────────────────────────────────────
export interface SeedMultiRoleResult {
  workspaceId: string;
  projectId: string;
  noteId: string;            // editor+commenter+viewer all have access
  privateNoteId: string;     // inheritParent=false + no pagePermissions for viewer
  otherWorkspaceId: string;  // separate workspace, no shared members
  ownerUserId: string;
  editorUserId: string;
  commenterUserId: string;
  viewerUserId: string;
  cleanup: () => Promise<void>;
}

export async function seedMultiRoleWorkspace(): Promise<SeedMultiRoleResult> {
  const ownerUser = await createUser();
  const editorUser = await createUser();
  const commenterUser = await createUser();
  const viewerUser = await createUser();

  // Primary workspace with project defaultRole="editor".
  const workspaceId = randomUUID();
  await db.insert(workspaces).values({
    id: workspaceId,
    slug: `test-ws-${workspaceId.slice(0, 8)}`,
    name: "Test Workspace (multi-role)",
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
    name: "Test Project (multi-role)",
    createdBy: ownerUser.id,
    defaultRole: "editor",
  });

  // editor inherits defaultRole="editor" from project; no explicit row needed.
  // commenter + viewer need explicit overrides.
  await db.insert(projectPermissions).values([
    { projectId, userId: commenterUser.id, role: "commenter" },
    { projectId, userId: viewerUser.id, role: "viewer" },
  ]);

  // Shared note — all 4 users should be able to read; editor can write.
  const noteId = randomUUID();
  await db.insert(notes).values({
    id: noteId,
    projectId,
    workspaceId,
    title: "shared note",
    inheritParent: true,
  });

  // Private note — inheritParent=false + no pagePermissions → viewer sees "none".
  // Grant owner/editor/commenter explicit page-level access so they still pass.
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
  const otherOwner = await createUser();
  const otherWorkspaceId = randomUUID();
  await db.insert(workspaces).values({
    id: otherWorkspaceId,
    slug: `test-ws-${otherWorkspaceId.slice(0, 8)}`,
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
    // workspace delete cascades to members/projects/notes/permissions/comments.
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

// 특정 note에 pagePermissions 행 삽입
export async function setPagePermission(
  userId: string,
  pageId: string,
  role: "editor" | "commenter" | "viewer" | "none",
): Promise<void> {
  await db.insert(pagePermissions).values({
    pageId,
    userId,
    role,
  });
}

// notes.inheritParent 값 변경
export async function setNoteInherit(noteId: string, inherit: boolean): Promise<void> {
  await db.update(notes).set({ inheritParent: inherit }).where(eq(notes.id, noteId));
}
