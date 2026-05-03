import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "../src/app.js";
import { seedWorkspace, createUser, type SeedResult } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";
import { db, user, eq } from "@opencairn/db";

const MB = 1024 * 1024;
const GB = 1024 * MB;

describe("POST /api/import/markdown/upload-url", () => {
  let seed: SeedResult;

  beforeEach(async () => {
    seed = await seedWorkspace({ role: "editor" });
  });

  afterEach(async () => {
    await seed.cleanup();
    delete process.env.IMPORT_MARKDOWN_ZIP_MAX_BYTES;
  });

  it("returns objectKey + presigned uploadUrl for a member with write access", async () => {
    const app = createApp();
    const res = await app.request("/api/import/markdown/upload-url", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: await signSessionCookie(seed.userId),
      },
      body: JSON.stringify({
        workspaceId: seed.workspaceId,
        size: 10 * MB,
        originalName: "vault.zip",
      }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { objectKey: string; uploadUrl: string };
    expect(json.objectKey).toMatch(
      new RegExp(
        `^imports/markdown/${seed.workspaceId}/${seed.userId}/\\d+-[0-9a-f-]+\\.zip$`,
      ),
    );
    expect(json.uploadUrl).toMatch(/^https?:\/\//);
    expect(json.uploadUrl).toContain(seed.workspaceId);
  });

  it("rejects sizes above the configured ceiling with 413", async () => {
    process.env.IMPORT_MARKDOWN_ZIP_MAX_BYTES = String(1 * MB);
    const app = createApp();
    const res = await app.request("/api/import/markdown/upload-url", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: await signSessionCookie(seed.userId),
      },
      body: JSON.stringify({
        workspaceId: seed.workspaceId,
        size: 2 * MB,
        originalName: "big.zip",
      }),
    });
    expect(res.status).toBe(413);
    const json = (await res.json()) as { error: string; maxBytes: number };
    expect(json.error).toBe("zip_too_large");
    expect(json.maxBytes).toBe(1 * MB);
  });

  it("rejects sizes above the 5GB zod cap with 400 before the handler runs", async () => {
    const app = createApp();
    const res = await app.request("/api/import/markdown/upload-url", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: await signSessionCookie(seed.userId),
      },
      body: JSON.stringify({
        workspaceId: seed.workspaceId,
        size: 6 * GB,
        originalName: "huge.zip",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 403 for an authenticated non-member", async () => {
    const outsider = await createUser();
    try {
      const app = createApp();
      const res = await app.request("/api/import/markdown/upload-url", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: await signSessionCookie(outsider.id),
        },
        body: JSON.stringify({
          workspaceId: seed.workspaceId,
          size: 10 * MB,
          originalName: "vault.zip",
        }),
      });
      expect(res.status).toBe(403);
    } finally {
      await db.delete(user).where(eq(user.id, outsider.id));
    }
  });
});
