import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

// Plan 11B Phase A — flag-gate smoke test. Full end-to-end auth/perm/SSE
// tests require Postgres + Temporal + Better Auth seed (deferred to CI,
// same convention as recent Onboarding / Phase 4 / Plan 7-2 PRs). This
// file pins the cheapest contract: the router returns 404 when the flag
// is off, regardless of method/path/auth.
//
// We mock `@opencairn/db` and `../src/lib/temporal-client` so the route
// module's transitive imports don't open a real Postgres pool at test
// collection time.

vi.mock("@opencairn/db", () => ({
  db: {
    insert: () => ({ values: async () => undefined }),
    select: () => ({
      from: () => ({ where: async () => [] }),
    }),
  },
  notes: {},
  docEditorCalls: {},
  eq: () => undefined,
}));

vi.mock("../src/lib/temporal-client", () => ({
  getTemporalClient: async () => ({}),
  taskQueue: () => "ingest",
}));

vi.mock("../src/lib/permissions", () => ({
  canWrite: async () => true,
}));

vi.mock("../src/middleware/auth", () => ({
  requireAuth: async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));

const { Hono } = await import("hono");
const { docEditorRoutes } = await import("../src/routes/doc-editor");

const ORIG = process.env.FEATURE_DOC_EDITOR_SLASH;
const ORIG_RAG = process.env.FEATURE_DOC_EDITOR_RAG;

afterAll(() => {
  if (ORIG === undefined) delete process.env.FEATURE_DOC_EDITOR_SLASH;
  else process.env.FEATURE_DOC_EDITOR_SLASH = ORIG;
  if (ORIG_RAG === undefined) delete process.env.FEATURE_DOC_EDITOR_RAG;
  else process.env.FEATURE_DOC_EDITOR_RAG = ORIG_RAG;
});

describe("doc-editor flag gate", () => {
  beforeEach(() => {
    delete process.env.FEATURE_DOC_EDITOR_SLASH;
    delete process.env.FEATURE_DOC_EDITOR_RAG;
  });

  it("returns 404 when FEATURE_DOC_EDITOR_SLASH is unset", async () => {
    const app = new Hono().route("/api", docEditorRoutes);
    const res = await app.request(
      "/api/notes/00000000-0000-0000-0000-000000000000/doc-editor/commands/improve",
      { method: "POST" },
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 when flag is explicitly false", async () => {
    process.env.FEATURE_DOC_EDITOR_SLASH = "false";
    const app = new Hono().route("/api", docEditorRoutes);
    const res = await app.request(
      "/api/notes/00000000-0000-0000-0000-000000000000/doc-editor/commands/improve",
      { method: "POST" },
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 on unknown command when flag is on", async () => {
    process.env.FEATURE_DOC_EDITOR_SLASH = "true";
    const app = new Hono().route("/api", docEditorRoutes);
    const res = await app.request(
      "/api/notes/00000000-0000-0000-0000-000000000000/doc-editor/commands/outline",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          selection: { blockId: "b1", start: 0, end: 5, text: "hello" },
          documentContextSnippet: "",
        }),
      },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("command_unknown");
  });

  it("returns 404 for RAG commands when FEATURE_DOC_EDITOR_RAG is off", async () => {
    process.env.FEATURE_DOC_EDITOR_SLASH = "true";
    process.env.FEATURE_DOC_EDITOR_RAG = "false";
    const app = new Hono().route("/api", docEditorRoutes);
    const res = await app.request(
      "/api/notes/00000000-0000-0000-0000-000000000000/doc-editor/commands/cite",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          selection: { blockId: "b1", start: 0, end: 5, text: "hello" },
          documentContextSnippet: "",
        }),
      },
    );
    expect(res.status).toBe(404);
  });
});
