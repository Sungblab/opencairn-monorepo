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
import { createMultiRoleSeed } from "../../src/lib/test-seed-multi.js";

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
//
// Implementation moved to `apps/api/src/lib/test-seed-multi.ts` (Plan 2B
// Task 20) so the Playwright-facing `/internal/test-seed-multi-role` endpoint
// and these vitest helpers share one codepath. This file keeps the legacy
// `SeedMultiRoleResult` export + `seedMultiRoleWorkspace` name so existing
// call sites (notes.test.ts, comments.test.ts, mentions.test.ts) remain
// unchanged. The returned object is a superset of the old shape — `wsSlug`
// is additionally exposed because the E2E needs it to build URLs.
// ────────────────────────────────────────────────────────────────────────────
export interface SeedMultiRoleResult {
  workspaceId: string;
  wsSlug: string;
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
  // Thin wrapper around the shared lib — preserves the historical return
  // shape for existing vitest consumers (notes/comments/mentions).
  return createMultiRoleSeed();
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
