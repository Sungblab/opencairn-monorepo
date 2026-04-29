import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import {
  seedWorkspace,
  createUser,
  type SeedResult,
  type CreatedUser,
} from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";
import { db, importJobs, eq, user } from "@opencairn/db";

// Mock Temporal so we don't need a real Temporal cluster — only the start
// arguments matter for these tests, not actual workflow execution.
const { startSpy } = vi.hoisted(() => ({
  startSpy: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/lib/temporal-client.js", () => ({
  getTemporalClient: vi.fn().mockResolvedValue({
    workflow: { start: startSpy },
  }),
  taskQueue: () => "opencairn",
}));

describe("POST /api/import/notion — zipObjectKey prefix validation (S3-024)", () => {
  let seed: SeedResult;

  beforeEach(async () => {
    seed = await seedWorkspace({ role: "editor" });
    startSpy.mockClear();
  });

  afterEach(async () => {
    // Clean up any rows we left behind so cascade delete in seed.cleanup
    // doesn't trip on FK references — import_jobs links to user + workspace.
    await db.delete(importJobs).where(eq(importJobs.userId, seed.userId));
    await seed.cleanup();
  });

  it("accepts a zipObjectKey under the caller's own workspace+user prefix", async () => {
    const app = createApp();
    const objectKey = `imports/notion/${seed.workspaceId}/${seed.userId}/${Date.now()}-${randomUUID()}.zip`;
    const res = await app.request("/api/import/notion", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: await signSessionCookie(seed.userId),
      },
      body: JSON.stringify({
        workspaceId: seed.workspaceId,
        zipObjectKey: objectKey,
        originalName: "export.zip",
        target: { kind: "new" },
      }),
    });
    expect(res.status).toBe(201);
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects a zipObjectKey issued for a different user with 403", async () => {
    // Another user uploaded the zip into the SAME workspace. The caller has
    // write access to the workspace but must not be able to consume someone
    // else's upload — that would leak the other user's file content into the
    // caller's workspace as imported pages.
    const otherUser = await createUser();
    try {
      const app = createApp();
      const foreignKey = `imports/notion/${seed.workspaceId}/${otherUser.id}/${Date.now()}-${randomUUID()}.zip`;
      const res = await app.request("/api/import/notion", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: await signSessionCookie(seed.userId),
        },
        body: JSON.stringify({
          workspaceId: seed.workspaceId,
          zipObjectKey: foreignKey,
          originalName: "export.zip",
          target: { kind: "new" },
        }),
      });
      expect(res.status).toBe(403);
      expect(startSpy).not.toHaveBeenCalled();
    } finally {
      await db.delete(user).where(eq(user.id, otherUser.id));
    }
  });

  it("rejects a zipObjectKey issued for a different workspace with 403", async () => {
    const app = createApp();
    const otherWorkspaceId = randomUUID();
    const crossWsKey = `imports/notion/${otherWorkspaceId}/${seed.userId}/${Date.now()}-${randomUUID()}.zip`;
    const res = await app.request("/api/import/notion", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: await signSessionCookie(seed.userId),
      },
      body: JSON.stringify({
        workspaceId: seed.workspaceId,
        zipObjectKey: crossWsKey,
        originalName: "export.zip",
        target: { kind: "new" },
      }),
    });
    expect(res.status).toBe(403);
    expect(startSpy).not.toHaveBeenCalled();
  });

  it("rejects a zipObjectKey outside imports/notion/ entirely with 403", async () => {
    const app = createApp();
    const res = await app.request("/api/import/notion", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: await signSessionCookie(seed.userId),
      },
      body: JSON.stringify({
        workspaceId: seed.workspaceId,
        zipObjectKey: `exports/some/other/path.zip`,
        originalName: "export.zip",
        target: { kind: "new" },
      }),
    });
    expect(res.status).toBe(403);
    expect(startSpy).not.toHaveBeenCalled();
  });

  // Review fix: `startsWith` alone allowed traversal segments. These
  // would all pass the prefix anchor but resolve elsewhere if a future
  // layer normalizes the path (presigned helper, fs join, etc).
  const traversalKeys = [
    `imports/notion/${"<wsId>"}/${"<userId>"}/../../../other-ws/other-user/abc.zip`,
    `imports/notion/${"<wsId>"}/${"<userId>"}//etc/passwd`,
    `imports/notion/${"<wsId>"}/${"<userId>"}/sub\\..\\victim.zip`,
  ];
  for (const tpl of traversalKeys) {
    it(`rejects path-traversal in zipObjectKey: ${tpl}`, async () => {
      const app = createApp();
      const key = tpl
        .replace("<wsId>", seed.workspaceId)
        .replace("<userId>", seed.userId);
      const res = await app.request("/api/import/notion", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: await signSessionCookie(seed.userId),
        },
        body: JSON.stringify({
          workspaceId: seed.workspaceId,
          zipObjectKey: key,
          originalName: "export.zip",
          target: { kind: "new" },
        }),
      });
      expect(res.status).toBe(403);
      expect(startSpy).not.toHaveBeenCalled();
    });
  }
});
