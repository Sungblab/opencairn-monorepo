import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { canRead, canWrite, requireWorkspaceRole } from "../src/lib/permissions.js";
import {
  seedWorkspace,
  createUser,
  setPagePermission,
  setNoteInherit,
  type SeedRole,
  type SeedResult,
} from "./helpers/seed.js";

// ──────────────────────────────────────────────────────────────
// 4 역할 × 3 검증 = 12 tests
// ──────────────────────────────────────────────────────────────
describe("permissions (workspace 3계층)", () => {
  describe.each<{ role: SeedRole; read: boolean; write: boolean; admin: boolean }>([
    { role: "viewer", read: true,  write: false, admin: false },
    { role: "editor", read: true,  write: true,  admin: false },
    { role: "admin",  read: true,  write: true,  admin: true  },
    { role: "owner",  read: true,  write: true,  admin: true  },
  ])("role=$role", ({ role, read, write, admin }) => {
    let ctx: SeedResult;

    beforeEach(async () => {
      ctx = await seedWorkspace({ role });
    });

    afterEach(async () => {
      await ctx.cleanup();
    });

    it(`canRead = ${read}`, async () => {
      const result = await canRead(ctx.userId, { type: "note", id: ctx.noteId });
      expect(result).toBe(read);
    });

    it(`canWrite = ${write}`, async () => {
      const result = await canWrite(ctx.userId, { type: "note", id: ctx.noteId });
      expect(result).toBe(write);
    });

    it(`requireWorkspaceRole(admin) ${admin ? "passes" : "throws"}`, async () => {
      const call = () =>
        requireWorkspaceRole(ctx.userId, ctx.workspaceId, ["owner", "admin"]);

      if (admin) {
        await expect(call()).resolves.toBeUndefined();
      } else {
        await expect(call()).rejects.toThrow("Forbidden");
      }
    });
  });

  // ──────────────────────────────────────────────────────────────
  // 오버라이드 / 엣지케이스 3 tests
  // ──────────────────────────────────────────────────────────────

  it("page_permissions override downgrades editor to viewer", async () => {
    // editor 역할로 시드 → projectPermissions에 editor 존재
    const ctx = await seedWorkspace({ role: "editor" });

    try {
      // page-level override: viewer로 다운그레이드
      await setPagePermission(ctx.userId, ctx.noteId, "viewer");

      // canWrite는 "viewer"이므로 false여야 함
      const write = await canWrite(ctx.userId, { type: "note", id: ctx.noteId });
      expect(write).toBe(false);

      // canRead는 여전히 true
      const read = await canRead(ctx.userId, { type: "note", id: ctx.noteId });
      expect(read).toBe(true);
    } finally {
      await ctx.cleanup();
    }
  });

  it("notes.inheritParent=false + no page_permissions → none", async () => {
    // editor 역할이지만 inheritParent=false이고 page_permissions 없음
    // resolveRole: membership=member, no pagePerm, inherit=false → "none"
    const ctx = await seedWorkspace({ role: "editor" });

    try {
      // inheritParent를 false로 변경
      await setNoteInherit(ctx.noteId, false);

      // page_permissions 없으므로 → role "none"
      const read = await canRead(ctx.userId, { type: "note", id: ctx.noteId });
      expect(read).toBe(false);

      const write = await canWrite(ctx.userId, { type: "note", id: ctx.noteId });
      expect(write).toBe(false);
    } finally {
      await ctx.cleanup();
    }
  });

  it("non-member has no access to workspace resource", async () => {
    // workspace를 하나 시드하되, 별도 유저(비멤버)를 만들어 접근 시도
    const ctx = await seedWorkspace({ role: "owner" });
    const outsider = await createUser();

    try {
      const read = await canRead(outsider.id, { type: "note", id: ctx.noteId });
      expect(read).toBe(false);

      const write = await canWrite(outsider.id, { type: "note", id: ctx.noteId });
      expect(write).toBe(false);
    } finally {
      await ctx.cleanup();
      // outsider 유저 정리 (workspace에 소속되지 않으므로 ctx.cleanup에 포함 안 됨)
      const { db, user, eq } = await import("@opencairn/db");
      await db.delete(user).where(eq(user.id, outsider.id));
    }
  });
});
