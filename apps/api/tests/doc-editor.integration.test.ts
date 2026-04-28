import { describe, it, expect } from "vitest";

// Plan 11B Phase A T14 — opt-in real-Temporal smoke. Skipped by default in
// CI because it requires the full stack: Postgres with a seeded note,
// Better Auth session, Temporal worker registered with the DocEditor task
// queue, and FEATURE_DOC_EDITOR_SLASH=true on the API process.
//
// Mirrors the pattern used by `research-smoke.spec.ts` (Phase D web E2E)
// and the literature-search integration smokes — the CI green matrix
// stays narrow; an engineer flips `TEMPORAL_INTEGRATION=1` locally to
// exercise the wire end-to-end before flag flip.
//
// To run:
//   FEATURE_DOC_EDITOR_SLASH=true \
//   TEMPORAL_INTEGRATION=1 \
//   pnpm --filter @opencairn/api test -- doc-editor.integration

const integrationEnabled = process.env.TEMPORAL_INTEGRATION === "1";

describe.skipIf(!integrationEnabled)(
  "doc-editor real-Temporal smoke (TEMPORAL_INTEGRATION=1)",
  () => {
    it("round-trips an /improve workflow and emits a doc_editor_result frame", async () => {
      // Lazy-import the real route module so the file's top-level vi.mock
      // overrides in `doc-editor.test.ts` don't bleed into this run when
      // the suite is invoked together. Vitest mocks are file-scoped, so a
      // sibling integration file with no mocks gets the real `db` /
      // `getTemporalClient` / `requireAuth`.
      const { Hono } = await import("hono");
      const { docEditorRoutes } = await import("../src/routes/doc-editor");

      // Caller is responsible for seeding `notes` + a Better Auth session
      // out-of-band. The TEST_NOTE_ID + TEST_AUTH_COOKIE env vars are how
      // those are passed in.
      const noteId = process.env.TEST_NOTE_ID;
      const cookie = process.env.TEST_AUTH_COOKIE;
      if (!noteId || !cookie) {
        throw new Error(
          "TEMPORAL_INTEGRATION requires TEST_NOTE_ID + TEST_AUTH_COOKIE",
        );
      }

      const app = new Hono().route("/api", docEditorRoutes);
      const res = await app.request(
        `/api/notes/${noteId}/doc-editor/commands/improve`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie,
          },
          body: JSON.stringify({
            selection: {
              blockId: "b1",
              start: 0,
              end: 11,
              text: "hello world",
            },
            documentContextSnippet: "",
          }),
        },
      );
      expect(res.status).toBe(200);
      const body = await res.text();
      // SSE wire — the route writes `event: doc_editor_result` followed
      // by a JSON `data:` line on the happy path.
      expect(body).toContain("event: doc_editor_result");
      expect(body).toContain("event: done");
    });
  },
);
