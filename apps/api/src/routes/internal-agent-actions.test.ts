import { describe, expect, it, vi } from "vitest";

const cleanupExpiredCodeProjectPreviews = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    expiredCount: 2,
    actionIds: [
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
    ],
  }),
);

vi.mock("../lib/agent-actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/agent-actions")>();
  return {
    ...actual,
    cleanupExpiredCodeProjectPreviews,
  };
});

const SECRET = "test-internal-secret-agent-actions";
process.env.INTERNAL_API_SECRET = SECRET;

const { createApp } = await import("../app");
const app = createApp();

function postPreviewCleanup(body: unknown, secret: string | null = SECRET) {
  return app.request("/api/internal/agent-actions/preview-cleanup", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret == null ? {} : { "X-Internal-Secret": secret }),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/internal/agent-actions/preview-cleanup", () => {
  it("runs the expired static preview cleanup sweep", async () => {
    cleanupExpiredCodeProjectPreviews.mockClear();

    const res = await postPreviewCleanup({ limit: 25 });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      expiredCount: 2,
      actionIds: [
        "00000000-0000-4000-8000-000000000001",
        "00000000-0000-4000-8000-000000000002",
      ],
    });
    expect(cleanupExpiredCodeProjectPreviews).toHaveBeenCalledWith({ limit: 25 });
  });

  it("rejects callers without the internal secret", async () => {
    cleanupExpiredCodeProjectPreviews.mockClear();

    const res = await postPreviewCleanup({}, null);

    expect(res.status).toBe(401);
    expect(cleanupExpiredCodeProjectPreviews).not.toHaveBeenCalled();
  });

  it("rejects invalid cleanup limits", async () => {
    cleanupExpiredCodeProjectPreviews.mockClear();

    const res = await postPreviewCleanup({ limit: 0 });

    expect(res.status).toBe(400);
    expect(cleanupExpiredCodeProjectPreviews).not.toHaveBeenCalled();
  });
});
