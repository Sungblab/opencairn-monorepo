# Session 6 — Iteration 4 Findings

**Coverage**: Area 9 (packages/templates + packages/shared) + remaining schema/infra sweep
**Date**: 2026-04-28
**Auditor**: Ralph (Claude)

---

## Critical

_None._

---

## High

_None._

---

## Medium

### S6-023 — `sourceTypeSchema` in `packages/shared` missing `"paper"` — Zod/DB enum drift

**Files**: `packages/shared/src/api-types.ts:39–50`, `packages/db/src/schema/enums.ts:7–19`
**Axis**: Correctness (schema drift)

Migration `0033_literature_search.sql` added `"paper"` to the `source_type` Postgres enum. The DB schema `enums.ts` includes `"paper"`. But `sourceTypeSchema` in `packages/shared` still has only 10 values — `"paper"` is absent:

```ts
// packages/shared — missing "paper":
const sourceTypeSchema = z.enum([
  "manual", "pdf", "audio", "video", "image",
  "youtube", "web", "notion", "unknown", "canvas",
]);
```

**Impact**:
1. `createNoteSchema` (used in `POST /api/notes`) validates `sourceType` via `sourceTypeSchema` — any attempt to POST a note with `sourceType: "paper"` would be rejected with a 400. (In practice, paper notes come from the literature import worker via internal APIs which define their own enum, so this path is not currently triggered by the app itself.)
2. The TS type derived from `sourceTypeSchema` misses `"paper"`, so frontend components that exhaustively switch on `sourceType` won't handle `paper` notes and may render incorrectly. Verified: no `"paper"` string found in `apps/web/src/`.

**Fix**: Add `"paper"` to `sourceTypeSchema` and sync the frontend wherever `sourceType` is used as a discriminant.

---

## Low

### S6-024 — `packages/templates` complete library but integration endpoint is a 501 stub

**Files**: `apps/api/src/routes/canvas.ts:29,64`
**Axis**: Missing Features

`POST /canvas/from-template` returns `501 templatesNotAvailable`. The `@opencairn/templates` package (9 templates, Zod-validated engine) was implemented in Plan 6 but is not referenced from any `apps/` package. The library is well-structured (engine, schema registry, KNOWN_IDS allow-list), so wiring it up is primarily a route-layer task.

**Not an urgent gap**: canvas templates are a "nice to have" feature. Document for tracking.

---

### S6-025 — `packages/templates/engine.ts` uses `readFileSync` with unvalidated `id`

**File**: `packages/templates/src/engine.ts:26`
**Axis**: Security

```ts
const filePath = resolve(TEMPLATES_DIR, `${id}.json`);
const raw = readFileSync(filePath, "utf-8");
```

If `id` ever comes from external input without going through the `KNOWN_IDS` guard, this is a path traversal vulnerability: `id = "../../src/engine"` would resolve outside the templates directory.

**Current state**: `loadTemplate` is only called with literals from `KNOWN_IDS` today (via `listTemplates()` or hardcoded strings inside `buildTemplateOutput`). When the 501 stub becomes a real route, the `id` will likely come from the request body — at that point, the route handler must validate `id ∈ KNOWN_IDS` before calling `loadTemplate`.

**Fix**: Add a guard at the top of `loadTemplate`:
```ts
if (!KNOWN_IDS.includes(id as (typeof KNOWN_IDS)[number])) {
  throw new Error(`Unknown template id: ${id}`);
}
```
This also provides defense-in-depth against future callers that skip the guard.

---

## Observations (No Severity)

- `ingestJobs.source` is `text` (not enum) — documented deliberate choice to avoid migrations for new dispatch paths. ✓
- `packages/shared/src/doc-editor.ts` Zod schema is in sync with `doc_editor_calls` DB schema. `docEditorCommandSchema` matches the v1 command set (improve/translate/summarize/expand). `docEditorSseEventSchema` matches `apps/api/src/routes/doc-editor.ts`. ✓
- `packages/shared/src/chat.ts` Zod schema is in sync with `conversations.ts` DB schema (scope_type, rag_mode, conversation_message_role). ✓
- `packages/shared/src/research-types.ts` in sync with DB research enums. ✓
- `packages/templates` 9 JSON template files (quiz/flashcard/fill-blank/mock-exam/teach-back/concept-compare/slides/mindmap/cheatsheet) are complete. The engine validates output via `schemaRegistry` — `validateOutput()` + `schema.parse()`. The KNOWN_IDS const-array allowlist prevents arbitrary file loads today. ✓
- `packages/templates` package is `private: true`, not published to NPM. ✓
- `packages/db/src/schema/` index exports: all 40+ schema files export correctly via the main `src/index.ts` (checked via Drizzle Kit being able to generate migrations). ✓
