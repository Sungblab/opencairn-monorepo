import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createApp } from "../src/app.js";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

const { startSpy, uploadObjectSpy } = vi.hoisted(() => ({
  startSpy: vi.fn().mockResolvedValue(undefined),
  uploadObjectSpy: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/lib/s3.js", () => ({
  uploadObject: uploadObjectSpy,
}));

vi.mock("../src/lib/temporal-client.js", () => ({
  getTemporalClient: vi.fn().mockResolvedValue({
    workflow: {
      start: startSpy,
    },
  }),
}));

describe("ingest workflow payload", () => {
  let seed: SeedResult;

  beforeEach(async () => {
    seed = await seedWorkspace({ role: "editor" });
    startSpy.mockClear();
    uploadObjectSpy.mockClear();
  });

  afterEach(async () => {
    await seed.cleanup();
  });

  it("starts upload ingest with snake_case worker input", async () => {
    const app = createApp();
    const form = new FormData();
    form.set("projectId", seed.projectId);
    form.set(
      "file",
      new File(["# smoke\n"], "smoke.md", { type: "text/markdown" }),
    );

    const res = await app.request("/api/ingest/upload", {
      method: "POST",
      headers: {
        cookie: await signSessionCookie(seed.userId),
      },
      body: form,
    });

    expect(res.status).toBe(202);
    const body = (await res.json()) as { workflowId: string; objectKey: string };
    expect(body.objectKey).toMatch(new RegExp(`^uploads/${seed.userId}/`));
    expect(uploadObjectSpy).toHaveBeenCalledOnce();
    expect(startSpy).toHaveBeenCalledOnce();

    const payload = startSpy.mock.calls[0]?.[1]?.args?.[0] as Record<
      string,
      unknown
    >;
    expect(Object.keys(payload).sort()).toEqual(
      [
        "file_name",
        "mime_type",
        "note_id",
        "object_key",
        "project_id",
        "user_id",
        "workspace_id",
        "content_enrichment_enabled",
      ].sort(),
    );
    expect(payload).toMatchObject({
      file_name: "smoke.md",
      mime_type: "text/markdown",
      note_id: null,
      object_key: body.objectKey,
      project_id: seed.projectId,
      user_id: seed.userId,
      workspace_id: seed.workspaceId,
      content_enrichment_enabled: false,
    });
  });

  it("starts URL ingest with snake_case worker input", async () => {
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
    expect(startSpy).toHaveBeenCalledOnce();

    const payload = startSpy.mock.calls[0]?.[1]?.args?.[0] as Record<
      string,
      unknown
    >;
    expect(Object.keys(payload).sort()).toEqual(
      [
        "file_name",
        "mime_type",
        "note_id",
        "object_key",
        "project_id",
        "url",
        "user_id",
        "workspace_id",
        "content_enrichment_enabled",
      ].sort(),
    );
    expect(payload).toMatchObject({
      url: "https://example.com/article",
      object_key: null,
      file_name: null,
      mime_type: "x-opencairn/web-url",
      user_id: seed.userId,
      project_id: seed.projectId,
      note_id: null,
      workspace_id: seed.workspaceId,
      content_enrichment_enabled: false,
    });
  });
});
