# Live Product Flow Smoke

This smoke is a maintainer-run check for the current user-facing product
surfaces that are easy to overclaim from unit tests alone: note agent actions,
code workspace actions, graph rendering, PDF compilation, optional Code Agent
execution, and optional synthesis export UI.

The helper lives at `apps/api/scripts/live-product-flow-smoke.ts` and writes
artifacts under `output/playwright/`.

## Scope

The default run verifies:

- `note.create` and `note.update` preview/apply through the public agent action
  API
- `code_project.create`, `code_project.patch`, apply, and ZIP archive download
- graph API data plus a real browser screenshot of the project graph page
- internal synthesis PDF compilation and object-storage retrieval
- `/api/code/run` feature-gate behavior when Code Agent is disabled
- `/api/synthesis-export/*` feature-gate behavior when synthesis export is
  disabled

Optional strict modes add live feature-flagged checks:

- `--require-code-agent` starts a real `CodeAgentWorkflow`, waits for a
  generated HTML turn, renders the generated HTML in a browser sandbox, sends
  feedback, and requires the run to finalize as `completed`.
- `--require-synthesis-export` opens the synthesis export page in a browser,
  selects a seeded note source, clicks the export button, waits for completion,
  and downloads the generated PDF.

## Required Services

Run against local API, web, worker, Postgres, Redis, Temporal, and object
storage. The helper uses the same process environment and root `.env` loading
rules as the rest of the API scripts. In worktrees, prefer process environment
over editing the root `.env`.

For the full strict run, start the Docker stack with all required feature flags:

```powershell
$env:FEATURE_CODE_AGENT = "true"
$env:NEXT_PUBLIC_FEATURE_CODE_AGENT = "true"
$env:FEATURE_SYNTHESIS_EXPORT = "true"
$env:OPENCAIRN_WEB_ORIGIN = "http://localhost:3000"
$env:OPENCAIRN_API_BASE_URL = "http://localhost:4000"
node scripts\dev-docker.mjs
```

The Code Agent path requires a working Temporal worker and LLM credentials. The
synthesis export path requires `FEATURE_SYNTHESIS_EXPORT=true` on API, worker,
and web.

## Running

Baseline:

```powershell
pnpm --dir apps/api smoke:live-product-flow -- --keep-on-failure
```

Strict Code Agent and synthesis export:

```powershell
pnpm --dir apps/api smoke:live-product-flow -- --require-code-agent --require-synthesis-export --keep-on-failure
```

Cleanup stale smoke data:

```powershell
pnpm --dir apps/api smoke:live-product-cleanup
```

## Output QA

The final JSON report is written to
`output/playwright/live-product-flow-smoke-report.json`. Browser screenshots are
written to:

- `output/playwright/live-product-flow-graph.png`
- `output/playwright/live-product-flow-synthesis-export.png`

The report includes generated object keys so cleanup can remove temporary PDF
objects even when the smoke fails before deleting the seeded workspace.
