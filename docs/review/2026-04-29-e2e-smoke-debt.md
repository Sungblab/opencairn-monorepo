# E2E / Smoke Debt Follow-up - 2026-04-29

## Branch Baseline

- Worktree: `.worktrees/e2e-fullstack-fixture`
- Branch: `codex/e2e-fullstack-fixture`
- Initial state after `git fetch --all --prune`:
  - `git status --short --branch`: clean, tracking `origin/codex/e2e-fullstack-fixture`
  - `git log --oneline -10`: HEAD was `92e5e9e test(web): add full-stack e2e fixture`
  - `git merge-base HEAD origin/main`: `2fca4ae00d677ad9a17a656fbd4e4aa185f61103`
  - `git rev-list --left-right --count HEAD...origin/main`: `1 14`
- Rebase decision: `origin/main` had already advanced through overlapping Playwright fixture work, so this branch was rebased before new edits.
- Rebase result: `git rebase origin/main` skipped `92e5e9e` as already applied and moved local HEAD to `origin/main`. The remote feature branch was left stale until the final PR push.
- Final refresh before PR: `origin/main` advanced again during verification. The branch was rebased onto `1a3617728643038150befc3587e7347c5e0f017e`; `git rev-list --left-right --count HEAD...origin/main` then returned `0 0` before committing this change.

## What Is Now Executable

### Plan 2D save_suggestion

- File: `apps/web/tests/e2e/plan-2d-save-suggestion.spec.ts`
- The user-facing no-active-note path is now executable:
  - seeds an authenticated workspace through the E2E seed helper
  - restores a deterministic active chat thread in `oc:active_thread:<workspaceId>`
  - exercises the real App Shell Agent Panel, composer, conversation renderer, and `SaveSuggestionCard`
  - mocks only the thread messages SSE/playback API at the Playwright boundary
  - asserts the deterministic `save_suggestion` card renders
  - clicks Save and verifies the "create a new note" toast/action appears when no Plate note tab is active
- Remaining skipped path:
  - active Plate note insertion remains `test.skip`
  - reason: the current `(shell)/n/[noteId]` route renders a placeholder instead of the Plate editor, while the legacy Plate editor route does not mount the Agent Panel. This is still manual-only until editor and Agent Panel share one shell route.

### Source PDF viewer smoke

- File: `apps/web/tests/e2e/source-viewer-smoke.spec.ts`
- Adds an executable smoke that restores a persisted `source` tab, mocks `/api/notes/:id/file` with a tiny PDF, and checks source viewer chrome, open link, and download affordance.
- This avoids MinIO requirements while still exercising the real tab router and `SourceViewer` UI.

### Live ingest visualization smoke

- File: `apps/web/tests/e2e/live-ingest-visualization.spec.ts`
- Adds a mocked SSE fixture for a persisted running ingest workflow:
  - injects persisted `ingest-store` state
  - installs a browser `EventSource` fixture
  - verifies spotlight, dock, auto-collapse on progress, ingest tab open, outline, and progress percent
- Full-stack manual-only requirements remain:
  - real Postgres with migrations
  - API dev server with `INTERNAL_API_SECRET`
  - Redis for `/api/ingest/stream/:wfid`
  - MinIO/S3 credentials and bucket for uploaded source files and figures
  - worker/Temporal only when validating the real ingest workflow, not the mocked web visualization smoke

## Fixture / Config Changes

- `apps/web/tests/e2e/fixtures/mock-api-server.mjs` adds a focused mock API for the three smoke specs. It covers auth seed, workspace/project/tree/note reads, thread list/create, and chat conversation endpoints.
- `apps/web/tests/e2e/helpers/sse-fixtures.ts` adds deterministic `save_suggestion` SSE/playback helpers and a browser `EventSource` fixture for ingest events.
- `apps/web/playwright.config.ts` automatically uses the mock API for the three focused specs, while leaving other E2E specs on the real API path.
- The Playwright web server command now starts Next dev with webpack:

```text
pnpm --filter @opencairn/web exec next dev --webpack --port 3000
```

Reason: Next 16 Turbopack panics in this worktree because `apps/web/node_modules` is a junction pointing outside the project root. This blocked Playwright before tests could run.

## Command Results

Passed in this session:

```bash
pnpm --filter @opencairn/web test
```

Result: 120 files, 592 tests passed.

```bash
pnpm --filter @opencairn/web exec tsc --noEmit --pretty false
```

Result: passed.

```bash
pnpm --filter @opencairn/web i18n:parity
```

Result: all 31 namespaces passed parity.

Root Playwright command did not find the package-local Playwright binary in this workspace:

```bash
pnpm exec playwright test tests/e2e/plan-2d-save-suggestion.spec.ts tests/e2e/source-viewer-smoke.spec.ts tests/e2e/live-ingest-visualization.spec.ts --reporter=line --workers=1
```

Result: failed immediately with `Command "playwright" not found`.

Equivalent package-local Playwright command passed:

```bash
OPENCAIRN_E2E_REUSE_SERVERS=0 OPENCAIRN_E2E_MOCK_API=1 pnpm --dir apps/web exec playwright test tests/e2e/plan-2d-save-suggestion.spec.ts tests/e2e/source-viewer-smoke.spec.ts tests/e2e/live-ingest-visualization.spec.ts --reporter=line --workers=1
```

Result: 3 passed, 1 skipped.

## Earlier Full-stack Health Findings

Before the focused mock API was added, the same specs launched against the real API but failed before feature assertions because `/api/internal/test-seed` returned 500:

```text
Failed query: insert into "user" ("id", "name", "email", "email_verified", "image", "plan", "byok_gemini_key_ciphertext", "byok_gemini_key_iv", "byok_gemini_key_version", "last_viewed_workspace_id", "created_at", "updated_at") values (...)
```

This is workspace health, not feature correctness: the API was reachable, but the local database used by the API server was not at the schema expected by current code.

Also observed during real API startup:

```text
ensureBucket failed (storage unreachable?)
```

The mocked SSE/source specs do not need real MinIO for their assertions, but the API startup still attempts bucket setup when the API server is launched.

## Remaining Manual-only / Health Items

- Full-stack Playwright without the mock API still requires a migrated local Postgres. The earlier local DB failed the seed insert before tests could reach the changed UI flows.
- The live ingest real workflow remains manual-only until Redis, MinIO, API, worker, Temporal, and a real upload path are running together. The web visualization path now has a mocked SSE E2E smoke.
- Active-note `save_suggestion` insertion remains manual-only until the App Shell route mounts both the Plate editor and Agent Panel together.
