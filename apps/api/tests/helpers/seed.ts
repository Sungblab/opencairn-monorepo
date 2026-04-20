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
  and,
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

  // 8. cleanup — 역의존 순서로 삭제
  const cleanup = async () => {
    // pagePermissions (note 삭제 전에)
    await db.delete(pagePermissions).where(eq(pagePermissions.pageId, noteId));

    // projectPermissions
    await db
      .delete(projectPermissions)
      .where(
        and(
          eq(projectPermissions.projectId, projectId),
          eq(projectPermissions.userId, testUser.id),
        ),
      );

    // notes
    await db.delete(notes).where(eq(notes.id, noteId));

    // projects (cascade → projectPermissions이 이미 없어도 OK)
    await db.delete(projects).where(eq(projects.id, projectId));

    // workspaceMembers
    await db
      .delete(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, workspaceId));

    // workspaces
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));

    // users
    await db.delete(user).where(eq(user.id, testUser.id));
    if (ownerUser.id !== testUser.id) {
      await db.delete(user).where(eq(user.id, ownerUser.id));
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

// 특정 note에 pagePermissions 행 삽입
export async function setPagePermission(
  userId: string,
  pageId: string,
  role: "editor" | "viewer" | "none",
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
