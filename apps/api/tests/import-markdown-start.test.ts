import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import {
  seedWorkspace,
  createUser,
  type SeedResult,
} from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";
import { db, importJobs, eq, user } from "@opencairn/db";

const { startSpy } = vi.hoisted(() => ({
  startSpy: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/lib/temporal-client.js", () => ({
  getTemporalClient: vi.fn().mockResolvedValue({
    workflow: { start: startSpy },
  }),
  taskQueue: () => "opencairn",
}));

describe("POST /api/import/markdown — zipObjectKey prefix validation", () => {
  let seed: SeedResult;

  beforeEach(async () => {
    seed = await seedWorkspace({ role: "editor" });
    startSpy.mockClear();
  });

  afterEach(async () => {
    await db.delete(importJobs).where(eq(importJobs.userId, seed.userId));
    await seed.cleanup();
  });

  it("accepts a zipObjectKey under the caller's own workspace+user prefix", async () => {
    const app = createApp();
    const objectKey = `imports/markdown/${seed.workspaceId}/${seed.userId}/${Date.now()}-${randomUUID()}.zip`;
    const res = await app.request("/api/import/markdown", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: await signSessionCookie(seed.userId),
      },
      body: JSON.stringify({
        workspaceId: seed.workspaceId,
        zipObjectKey: objectKey,
        originalName: "vault.zip",
        target: { kind: "new" },
      }),
    });
    expect(res.status).toBe(201);
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(startSpy.mock.calls[0]?.[1]?.args?.[0]?.source).toBe(
      "markdown_zip",
    );
  });

  it("rejects a zipObjectKey issued for a different user with 403", async () => {
    const otherUser = await createUser();
    try {
      const app = createApp();
      const foreignKey = `imports/markdown/${seed.workspaceId}/${otherUser.id}/${Date.now()}-${randomUUID()}.zip`;
      const res = await app.request("/api/import/markdown", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: await signSessionCookie(seed.userId),
        },
        body: JSON.stringify({
          workspaceId: seed.workspaceId,
          zipObjectKey: foreignKey,
          originalName: "vault.zip",
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
    const crossWsKey = `imports/markdown/${otherWorkspaceId}/${seed.userId}/${Date.now()}-${randomUUID()}.zip`;
    const res = await app.request("/api/import/markdown", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: await signSessionCookie(seed.userId),
      },
      body: JSON.stringify({
        workspaceId: seed.workspaceId,
        zipObjectKey: crossWsKey,
        originalName: "vault.zip",
        target: { kind: "new" },
      }),
    });
    expect(res.status).toBe(403);
    expect(startSpy).not.toHaveBeenCalled();
  });

  const traversalKeys = [
    `imports/markdown/${"<wsId>"}/${"<userId>"}/../../../other-ws/other-user/abc.zip`,
    `imports/markdown/${"<wsId>"}/${"<userId>"}//etc/passwd`,
    `imports/markdown/${"<wsId>"}/${"<userId>"}/sub\\..\\victim.zip`,
  ];
  for (const tpl of traversalKeys) {
    it(`rejects path-traversal in zipObjectKey: ${tpl}`, async () => {
      const app = createApp();
      const key = tpl
        .replace("<wsId>", seed.workspaceId)
        .replace("<userId>", seed.userId);
      const res = await app.request("/api/import/markdown", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: await signSessionCookie(seed.userId),
        },
        body: JSON.stringify({
          workspaceId: seed.workspaceId,
          zipObjectKey: key,
          originalName: "vault.zip",
          target: { kind: "new" },
        }),
      });
      expect(res.status).toBe(403);
      expect(startSpy).not.toHaveBeenCalled();
    });
  }
});
