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
const completeCodeProjectRunActionFromWorker = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    idempotent: false,
    action: {
      id: "00000000-0000-4000-8000-000000000010",
      status: "completed",
    },
  }),
);
const completeCodeProjectInstallActionFromWorker = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    idempotent: false,
    action: {
      id: "00000000-0000-4000-8000-000000000012",
      status: "completed",
    },
  }),
);
const completeCodeProjectRepairActionFromWorker = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    idempotent: false,
    action: {
      id: "00000000-0000-4000-8000-000000000013",
      status: "draft",
    },
  }),
);
const recordCodeProjectPreviewSmokeResult = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    idempotent: false,
    action: {
      id: "00000000-0000-4000-8000-000000000016",
      status: "completed",
    },
  }),
);
const drainDueNoteAnalysisJobs = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    results: [
      {
        status: "completed",
        jobId: "00000000-0000-4000-8000-000000000020",
      },
    ],
    summary: {
      processed: 1,
      completed: 1,
      stale: 0,
      failed: 0,
      missing: 0,
      skipped: 0,
    },
  }),
);

vi.mock("../lib/agent-actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/agent-actions")>();
  return {
    ...actual,
    cleanupExpiredCodeProjectPreviews,
    completeCodeProjectInstallActionFromWorker,
    completeCodeProjectRepairActionFromWorker,
    completeCodeProjectRunActionFromWorker,
    recordCodeProjectPreviewSmokeResult,
  };
});

vi.mock("../lib/internal-assert", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/internal-assert")>();
  return {
    ...actual,
    assertResourceWorkspace: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("../lib/note-analysis-jobs", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/note-analysis-jobs")>();
  return {
    ...actual,
    drainDueNoteAnalysisJobs,
  };
});

vi.mock("../lib/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/llm")>();
  return {
    ...actual,
    getChatProvider: vi.fn(() => ({
      embed: vi.fn(async () => [0.1]),
    })),
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

function postNoteAnalysisDrain(body: unknown, secret: string | null = SECRET) {
  return app.request("/api/internal/note-analysis-jobs/drain", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret == null ? {} : { "X-Internal-Secret": secret }),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/internal/note-analysis-jobs/drain", () => {
  it("drains due note analysis jobs through the API runner", async () => {
    drainDueNoteAnalysisJobs.mockClear();

    const res = await postNoteAnalysisDrain({ batchSize: 10 });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      results: [
        {
          status: "completed",
          jobId: "00000000-0000-4000-8000-000000000020",
        },
      ],
      summary: {
        processed: 1,
        completed: 1,
        stale: 0,
        failed: 0,
        missing: 0,
        skipped: 0,
      },
    });
    expect(drainDueNoteAnalysisJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        batchSize: 10,
        embed: expect.any(Function),
      }),
    );
  });
});

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
    expect(cleanupExpiredCodeProjectPreviews).toHaveBeenCalledWith({
      limit: 25,
    });
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

function postCodeCommandResult(body: unknown, secret: string | null = SECRET) {
  return app.request("/api/internal/agent-actions/code-command-results", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret == null ? {} : { "X-Internal-Secret": secret }),
    },
    body: JSON.stringify(body),
  });
}

function postCodeInstallResult(body: unknown, secret: string | null = SECRET) {
  return app.request("/api/internal/agent-actions/code-install-results", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret == null ? {} : { "X-Internal-Secret": secret }),
    },
    body: JSON.stringify(body),
  });
}

function postCodeRepairResult(body: unknown, secret: string | null = SECRET) {
  return app.request("/api/internal/agent-actions/code-repair-results", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret == null ? {} : { "X-Internal-Secret": secret }),
    },
    body: JSON.stringify(body),
  });
}

function postCodePreviewSmokeResult(body: unknown, secret: string | null = SECRET) {
  return app.request("/api/internal/agent-actions/code-preview-smoke-results", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret == null ? {} : { "X-Internal-Secret": secret }),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/internal/agent-actions/code-command-results", () => {
  it("finalizes a code_project.run action from the worker callback", async () => {
    completeCodeProjectRunActionFromWorker.mockClear();

    const body = codeCommandResultBody();
    const res = await postCodeCommandResult(body);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      idempotent: false,
      action: {
        id: "00000000-0000-4000-8000-000000000010",
        status: "completed",
      },
    });
    expect(completeCodeProjectRunActionFromWorker).toHaveBeenCalledWith(body);
  });

  it("rejects invalid code command callback results", async () => {
    completeCodeProjectRunActionFromWorker.mockClear();

    const res = await postCodeCommandResult({
      ...codeCommandResultBody(),
      result: { ok: true },
    });

    expect(res.status).toBe(400);
    expect(completeCodeProjectRunActionFromWorker).not.toHaveBeenCalled();
  });
});

describe("POST /api/internal/agent-actions/code-install-results", () => {
  it("finalizes a code_project.install action from the worker callback", async () => {
    completeCodeProjectInstallActionFromWorker.mockClear();

    const body = codeInstallResultBody();
    const res = await postCodeInstallResult(body);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      idempotent: false,
      action: {
        id: "00000000-0000-4000-8000-000000000012",
        status: "completed",
      },
    });
    expect(completeCodeProjectInstallActionFromWorker).toHaveBeenCalledWith(
      body,
    );
  });
});

describe("POST /api/internal/agent-actions/code-repair-results", () => {
  it("finalizes a code_project.patch repair action from the worker callback", async () => {
    completeCodeProjectRepairActionFromWorker.mockClear();

    const body = codeRepairResultBody();
    const res = await postCodeRepairResult(body);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      idempotent: false,
      action: {
        id: "00000000-0000-4000-8000-000000000013",
        status: "draft",
      },
    });
    expect(completeCodeProjectRepairActionFromWorker).toHaveBeenCalledWith(
      body,
    );
  });
});

describe("POST /api/internal/agent-actions/code-preview-smoke-results", () => {
  it("records browser smoke evidence for a static preview action", async () => {
    recordCodeProjectPreviewSmokeResult.mockClear();

    const body = codePreviewSmokeResultBody();
    const res = await postCodePreviewSmokeResult(body);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      idempotent: false,
      action: {
        id: "00000000-0000-4000-8000-000000000016",
        status: "completed",
      },
    });
    expect(recordCodeProjectPreviewSmokeResult).toHaveBeenCalledWith(body);
  });

  it("rejects invalid browser smoke payloads", async () => {
    recordCodeProjectPreviewSmokeResult.mockClear();

    const res = await postCodePreviewSmokeResult({
      ...codePreviewSmokeResultBody(),
      result: { ok: true },
    });

    expect(res.status).toBe(400);
    expect(recordCodeProjectPreviewSmokeResult).not.toHaveBeenCalled();
  });
});

function codeCommandResultBody() {
  return {
    actionId: "00000000-0000-4000-8000-000000000010",
    requestId: "00000000-0000-4000-8000-000000000011",
    workflowId: "code-workspace-command-00000000-0000-4000-8000-000000000010",
    workspaceId: "00000000-0000-4000-8000-000000000001",
    projectId: "00000000-0000-4000-8000-000000000002",
    userId: "user-1",
    result: {
      ok: true,
      codeWorkspaceId: "00000000-0000-4000-8000-000000000020",
      snapshotId: "00000000-0000-4000-8000-000000000021",
      command: "test",
      exitCode: 0,
      durationMs: 42,
      logs: [{ stream: "stdout", text: "tests passed" }],
    },
  };
}

function codeInstallResultBody() {
  return {
    actionId: "00000000-0000-4000-8000-000000000012",
    requestId: "00000000-0000-4000-8000-000000000014",
    workflowId: "code-workspace-install-00000000-0000-4000-8000-000000000012",
    workspaceId: "00000000-0000-4000-8000-000000000001",
    projectId: "00000000-0000-4000-8000-000000000002",
    userId: "user-1",
    result: {
      ok: true,
      codeWorkspaceId: "00000000-0000-4000-8000-000000000020",
      snapshotId: "00000000-0000-4000-8000-000000000021",
      packageManager: "pnpm",
      installed: [{ name: "zod", dev: false }],
      exitCode: 0,
      durationMs: 42,
      logs: [{ stream: "stdout", text: "install passed" }],
    },
  };
}

function codeRepairResultBody() {
  return {
    actionId: "00000000-0000-4000-8000-000000000013",
    requestId: "00000000-0000-4000-8000-000000000015",
    workflowId:
      "code-workspace-repair-00000000-0000-4000-8000-000000000010-00000000-0000-4000-8000-000000000015",
    workspaceId: "00000000-0000-4000-8000-000000000001",
    projectId: "00000000-0000-4000-8000-000000000002",
    userId: "user-1",
    result: {
      codeWorkspaceId: "00000000-0000-4000-8000-000000000020",
      baseSnapshotId: "00000000-0000-4000-8000-000000000021",
      operations: [
        {
          op: "update",
          path: "src/App.tsx",
          beforeHash: "sha256:old",
          afterHash: "sha256:new",
          inlineContent: "export {};",
        },
      ],
      preview: {
        filesChanged: 1,
        additions: 1,
        deletions: 1,
        summary: "Repair failing test",
      },
    },
  };
}

function codePreviewSmokeResultBody() {
  return {
    actionId: "00000000-0000-4000-8000-000000000016",
    requestId: "00000000-0000-4000-8000-000000000017",
    workspaceId: "00000000-0000-4000-8000-000000000001",
    projectId: "00000000-0000-4000-8000-000000000002",
    userId: "user-1",
    result: {
      ok: true,
      status: 200,
      url: "https://preview.example.com/index.html",
      bodyChars: 42,
      screenshotPath: "output/playwright/preview.png",
      checkedAt: "2026-05-06T00:01:00.000Z",
    },
  };
}
