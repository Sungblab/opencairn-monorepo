import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createApp } from "../src/app.js";
import { db, user, eq } from "@opencairn/db";
import { seedWorkspace, createUser, type SeedResult } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";
import { _resetVisualizeLocks } from "../src/lib/visualize-lock.js";

// ─── Plan 5 KG Phase 2 · Task 11 · POST /api/visualize ──────────────────
//
// Wires together: better-auth session → canRead → in-memory concurrency
// lock → Temporal workflow.start → SSE stream from streamBuildView.
//
// We mock both `temporal-client` (so the test never reaches the real
// Temporal server) and `temporal-visualize` (so the stream body is
// deterministic and bounded). The mocks are hoisted module-mocks; their
// factories close over `vi.hoisted()` state to let individual cases tune
// the mocked stream's pacing.
//
// Test 5 (429 concurrent) is the trickiest: the first POST has to be
// in-flight when the second POST acquires the lock. We achieve this with
// a controllable streamBuildView mock — its `closeFirstStream` resolver
// is held until we explicitly release it.

const { streamCtrl } = vi.hoisted(() => {
  // Shared between the test body and the mock factory. `nextStream` is the
  // "next stream factory to use" — defaults to a tiny three-event stream
  // and individual tests override it.
  const ctrl: {
    nextStream: () => ReadableStream<Uint8Array>;
  } = {
    nextStream: () => {
      const enc = new TextEncoder();
      return new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(
            enc.encode(
              `event: tool_use\ndata: {"name":"search_concepts","callId":"1"}\n\n`,
            ),
          );
          c.enqueue(
            enc.encode(
              `event: view_spec\ndata: {"viewSpec":{"viewType":"graph","layout":"fcose","rootId":null,"nodes":[],"edges":[]}}\n\n`,
            ),
          );
          c.enqueue(enc.encode(`event: done\ndata: {}\n\n`));
          c.close();
        },
      });
    },
  };
  return { streamCtrl: ctrl };
});

// Temporal client — workflow.start resolves to a stub handle. The handle
// itself is never consumed by the route (we mock streamBuildView too), so
// any object satisfies the type.
vi.mock("../src/lib/temporal-client.js", () => ({
  getTemporalClient: async () => ({
    workflow: {
      start: vi.fn(async () => ({
        async describe() {
          return {};
        },
        async result() {
          return {};
        },
        async cancel() {},
      })),
      getHandle: vi.fn(),
    },
  }),
  taskQueue: () => "ingest",
}));

// streamBuildView — returns whatever the test's `streamCtrl.nextStream`
// closure produces. Test bodies tune the closure before issuing the POST.
vi.mock("../src/lib/temporal-visualize.js", () => ({
  streamBuildView: () => streamCtrl.nextStream(),
}));

const app = createApp();

async function postVisualize(
  body: unknown,
  opts: { cookie?: string } = {},
): Promise<Response> {
  return app.request("/api/visualize", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/visualize", () => {
  let ctx: SeedResult;
  let cookie: string;

  beforeEach(async () => {
    _resetVisualizeLocks();
    ctx = await seedWorkspace({ role: "owner" });
    cookie = await signSessionCookie(ctx.userId);
  });

  afterEach(async () => {
    _resetVisualizeLocks();
    await ctx.cleanup();
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await postVisualize({
      projectId: ctx.projectId,
      prompt: "show graph",
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 when prompt > 500 chars", async () => {
    const res = await postVisualize(
      { projectId: ctx.projectId, prompt: "x".repeat(501) },
      { cookie },
    );
    expect(res.status).toBe(400);
  });

  it("returns 403 when user is not a project member", async () => {
    const stranger = await createUser();
    try {
      const strangerCookie = await signSessionCookie(stranger.id);
      const res = await postVisualize(
        { projectId: ctx.projectId, prompt: "show graph" },
        { cookie: strangerCookie },
      );
      expect(res.status).toBe(403);
    } finally {
      await db.delete(user).where(eq(user.id, stranger.id));
    }
  });

  it("streams SSE events on success (tool_use, view_spec, done)", async () => {
    const res = await postVisualize(
      { projectId: ctx.projectId, prompt: "show graph" },
      { cookie },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    const body = await res.text();
    expect(body).toContain("event: tool_use");
    expect(body).toContain("event: view_spec");
    expect(body).toContain("event: done");
  });

  it("returns 429 when same user has an active visualize", async () => {
    // Hold the first stream open until we explicitly release it. Without
    // this, the in-memory lock would already be released by the time the
    // second POST arrives (the default mock auto-closes).
    let releaseFirst: (() => void) | null = null;
    const firstClosed = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    streamCtrl.nextStream = () => {
      const enc = new TextEncoder();
      return new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(
            enc.encode(
              `event: tool_use\ndata: {"name":"hold","callId":"1"}\n\n`,
            ),
          );
          await firstClosed;
          controller.enqueue(enc.encode(`event: done\ndata: {}\n\n`));
          controller.close();
        },
      });
    };

    // Fire the first request — don't await its body, just the response
    // headers. The stream stays open inside the in-memory `firstClosed`.
    const r1Promise = postVisualize(
      { projectId: ctx.projectId, prompt: "first" },
      { cookie },
    );
    const res1 = await r1Promise;
    expect(res1.status).toBe(200);

    // Restore the default fast-closing stream so the second POST (if it
    // somehow won the lock race) wouldn't itself hang the test.
    streamCtrl.nextStream = () => {
      const enc = new TextEncoder();
      return new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(enc.encode(`event: done\ndata: {}\n\n`));
          c.close();
        },
      });
    };

    // Second POST while the first stream is still in-flight. The lock is
    // held → expect 429 with the stable messageKey.
    const res2 = await postVisualize(
      { projectId: ctx.projectId, prompt: "second" },
      { cookie },
    );
    expect(res2.status).toBe(429);
    const body2 = (await res2.json()) as {
      error: string;
      messageKey: string;
    };
    expect(body2.error).toBe("concurrent-visualize");
    expect(body2.messageKey).toBe("graph.errors.concurrentVisualize");

    // Release the first stream — drain its body so the underlying reader
    // settles cleanly before the test exits.
    releaseFirst?.();
    await res1.text();
  });

  it("releases the lock immediately when the consumer cancels the stream", async () => {
    // Regression guard for the gemini-code-assist post-merge review: the
    // original TransformStream wrapper omitted `cancel`, so a client that
    // disconnected mid-stream held the per-user lock until the visualize-
    // lock TTL (~2 min) — blocking subsequent POSTs with 429. Adding
    // `cancel() { release(); }` makes the lock follow the consumer.
    let releaseFirst: (() => void) | null = null;
    const firstClosed = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    streamCtrl.nextStream = () => {
      const enc = new TextEncoder();
      return new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(
            enc.encode(
              `event: tool_use\ndata: {"name":"hold","callId":"1"}\n\n`,
            ),
          );
          await firstClosed;
          controller.enqueue(enc.encode(`event: done\ndata: {}\n\n`));
          controller.close();
        },
      });
    };

    const res1 = await postVisualize(
      { projectId: ctx.projectId, prompt: "first" },
      { cookie },
    );
    expect(res1.status).toBe(200);

    // Cancel the response body — mirrors a browser disconnect / fetch
    // abort. The TransformStream wrapper's `cancel` runs, calling release().
    await res1.body?.cancel();
    // Release the inner stream so the test doesn't dangle on the awaiter.
    releaseFirst?.();

    // Restore default fast stream and try again — should NOT hit 429 since
    // the lock was released on cancel.
    streamCtrl.nextStream = () => {
      const enc = new TextEncoder();
      return new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(enc.encode(`event: done\ndata: {}\n\n`));
          c.close();
        },
      });
    };
    const res2 = await postVisualize(
      { projectId: ctx.projectId, prompt: "second" },
      { cookie },
    );
    expect(res2.status).toBe(200);
    await res2.text();
  });
});
