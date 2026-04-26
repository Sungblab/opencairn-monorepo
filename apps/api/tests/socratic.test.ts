import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createApp } from "../src/app.js";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

// Mock Temporal client so tests don't require a running Temporal server.
vi.mock("../src/lib/temporal-client.js", () => ({
  getTemporalClient: vi.fn(),
  taskQueue: () => "ingest",
}));

import { getTemporalClient } from "../src/lib/temporal-client.js";

const app = createApp();

async function authedFetch(
  path: string,
  init: RequestInit & { userId: string },
): Promise<Response> {
  const { userId, headers, ...rest } = init;
  const cookie = await signSessionCookie(userId);
  return app.request(path, {
    ...rest,
    headers: {
      ...(headers ?? {}),
      cookie,
      "content-type": "application/json",
    },
  });
}

function mockTemporalResult(data: unknown) {
  vi.mocked(getTemporalClient).mockResolvedValue({
    workflow: {
      start: vi.fn().mockResolvedValue({
        result: vi.fn().mockResolvedValue(data),
      }),
    },
  } as unknown as any);
}

describe("Socratic API — /api/projects/:projectId/socratic", () => {
  let ctx: SeedResult;

  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "editor" });
  });

  afterEach(async () => {
    await ctx.cleanup();
    vi.clearAllMocks();
  });

  it("POST /generate returns questions from Temporal workflow", async () => {
    await mockTemporalResult({
      questions: [
        { text: "What is closure?", hint: null, difficulty: "medium" },
      ],
    });

    const res = await authedFetch(
      `/api/projects/${ctx.projectId}/socratic/generate`,
      {
        method: "POST",
        userId: ctx.userId,
        body: JSON.stringify({ conceptName: "Closures", noteContext: "A closure is..." }),
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.questions)).toBe(true);
    expect(body.questions[0].text).toBe("What is closure?");
  });

  it("POST /generate 400 for missing conceptName", async () => {
    const res = await authedFetch(
      `/api/projects/${ctx.projectId}/socratic/generate`,
      {
        method: "POST",
        userId: ctx.userId,
        body: JSON.stringify({ noteContext: "..." }),
      },
    );
    expect(res.status).toBe(400);
  });

  it("POST /generate 403 for non-member", async () => {
    const otherCtx = await seedWorkspace({ role: "editor" });
    try {
      const res = await authedFetch(
        `/api/projects/${ctx.projectId}/socratic/generate`,
        {
          method: "POST",
          userId: otherCtx.userId,
          body: JSON.stringify({ conceptName: "X", noteContext: "..." }),
        },
      );
      expect(res.status).toBe(403);
    } finally {
      await otherCtx.cleanup();
    }
  });

  it("POST /evaluate returns score and feedback", async () => {
    await mockTemporalResult({
      score: 80,
      is_correct: true,
      feedback: "Well done.",
      should_create_flashcard: false,
    });

    const res = await authedFetch(
      `/api/projects/${ctx.projectId}/socratic/evaluate`,
      {
        method: "POST",
        userId: ctx.userId,
        body: JSON.stringify({
          conceptName: "Closures",
          question: "What is closure?",
          userAnswer: "A function with outer scope access",
          noteContext: "...",
        }),
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.score).toBe(80);
    expect(body.is_correct).toBe(true);
    expect(body.feedback).toBe("Well done.");
  });

  it("POST /evaluate 400 for missing question", async () => {
    const res = await authedFetch(
      `/api/projects/${ctx.projectId}/socratic/evaluate`,
      {
        method: "POST",
        userId: ctx.userId,
        body: JSON.stringify({
          conceptName: "Closures",
          userAnswer: "answer",
          noteContext: "...",
        }),
      },
    );
    expect(res.status).toBe(400);
  });
});
