import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createApp } from "../src/app.js";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

const { startSpy, uploadSpy } = vi.hoisted(() => ({
  startSpy: vi.fn().mockResolvedValue(undefined),
  uploadSpy: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/lib/temporal-client.js", () => ({
  getTemporalClient: vi.fn().mockResolvedValue({
    workflow: { start: startSpy },
  }),
}));

vi.mock("../src/lib/s3.js", () => ({
  uploadObject: uploadSpy,
}));

describe("POST /api/ingest dispatch workspace_id", () => {
  let seed: SeedResult;

  beforeEach(async () => {
    seed = await seedWorkspace({ role: "editor" });
    startSpy.mockClear();
    uploadSpy.mockClear();
  });

  afterEach(async () => {
    await seed.cleanup();
  });

  it("passes workspace_id to URL IngestWorkflow args", async () => {
    const app = createApp();
    const res = await app.request("/api/ingest/url", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: await signSessionCookie(seed.userId),
      },
      body: JSON.stringify({
        url: "https://example.com/article",
        projectId: seed.projectId,
      }),
    });

    expect(res.status).toBe(202);
    expect(startSpy).toHaveBeenCalledTimes(1);
    const [, opts] = startSpy.mock.calls[0];
    expect(opts.args[0].workspace_id).toBe(seed.workspaceId);
  });

  it("passes workspace_id to upload IngestWorkflow args", async () => {
    const app = createApp();
    const body = new FormData();
    body.set("projectId", seed.projectId);
    body.set("file", new File(["hello"], "hello.txt", { type: "text/plain" }));

    const res = await app.request("/api/ingest/upload", {
      method: "POST",
      headers: {
        cookie: await signSessionCookie(seed.userId),
      },
      body,
    });

    expect(res.status).toBe(202);
    expect(uploadSpy).toHaveBeenCalledTimes(1);
    expect(startSpy).toHaveBeenCalledTimes(1);
    const [, opts] = startSpy.mock.calls[0];
    expect(opts.args[0].workspace_id).toBe(seed.workspaceId);
  });
});
