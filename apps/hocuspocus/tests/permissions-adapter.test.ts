import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb } from "@opencairn/db";
import { makePermissionsAdapter } from "../src/permissions-adapter.js";
import {
  seedMultiRoleWorkspace,
  type SeedMultiRoleResult,
} from "../../api/tests/helpers/seed.js";

// Plan 2B Task 10: hocuspocus는 자체 pool을 통해 권한 헬퍼를 호출한다.
// createDb(url)로 별개 pool을 만들고 makePermissionsAdapter에 주입.
const db = createDb(process.env.DATABASE_URL!);
const perms = makePermissionsAdapter(db);

describe("permissions-adapter", () => {
  let seed: SeedMultiRoleResult;
  beforeEach(async () => {
    seed = await seedMultiRoleWorkspace();
  });
  afterEach(async () => {
    await seed.cleanup();
  });

  it("editor can read and write", async () => {
    expect(
      await perms.canRead(seed.editorUserId, { type: "note", id: seed.noteId }),
    ).toBe(true);
    expect(
      await perms.canWrite(seed.editorUserId, { type: "note", id: seed.noteId }),
    ).toBe(true);
  });

  it("commenter can read + comment but not write", async () => {
    expect(
      await perms.canRead(seed.commenterUserId, { type: "note", id: seed.noteId }),
    ).toBe(true);
    expect(
      await perms.canComment(seed.commenterUserId, { type: "note", id: seed.noteId }),
    ).toBe(true);
    expect(
      await perms.canWrite(seed.commenterUserId, { type: "note", id: seed.noteId }),
    ).toBe(false);
  });

  it("viewer can read but not comment or write", async () => {
    expect(
      await perms.canRead(seed.viewerUserId, { type: "note", id: seed.noteId }),
    ).toBe(true);
    expect(
      await perms.canComment(seed.viewerUserId, { type: "note", id: seed.noteId }),
    ).toBe(false);
    expect(
      await perms.canWrite(seed.viewerUserId, { type: "note", id: seed.noteId }),
    ).toBe(false);
  });

  it("outsider returns none", async () => {
    const role = await perms.resolveRole("u_outsider_never_exists", {
      type: "note",
      id: seed.noteId,
    });
    expect(role).toBe("none");
  });

  it("viewer cannot read privateNoteId (inheritParent=false)", async () => {
    expect(
      await perms.canRead(seed.viewerUserId, { type: "note", id: seed.privateNoteId }),
    ).toBe(false);
  });
});
