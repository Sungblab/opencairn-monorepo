# Note Analysis Drain Schedule Live Smoke

This smoke verifies the mutable-note analysis drain path with the real local
Temporal server, API, worker, and database:

```text
Temporal Schedule trigger
-> NoteAnalysisDrainWorkflow
-> drain_note_analysis_jobs activity
-> POST /api/internal/note-analysis-jobs/drain
-> note_analysis_jobs terminal completed row
```

The harness seeds a temporary workspace through `/api/internal/test-seed`,
creates one due `note_analysis_jobs` row, triggers an ephemeral Temporal
Schedule, waits for the worker/API drain to complete that row, and deletes the
ephemeral schedule unless `NOTE_ANALYSIS_DRAIN_SMOKE_KEEP_SCHEDULE=1` is set.

## Preconditions

- Local Postgres has current migrations.
- Local API is running with `INTERNAL_API_SECRET` and a configured chat provider.
- Local worker is running with `FEATURE_NOTE_ANALYSIS_DRAIN=true`,
  `INTERNAL_API_URL`, the same `INTERNAL_API_SECRET`, and matching Temporal
  queue settings.
- Temporal server is reachable at `TEMPORAL_ADDRESS`.

For Windows worktrees, load the canonical root `.env` into the process and then
override ports locally. Do not edit the root `.env` just for this smoke.

## Run

```powershell
$env:API_BASE_URL = "http://127.0.0.1:4000"
$env:INTERNAL_API_URL = "http://127.0.0.1:4000"
$env:TEMPORAL_ADDRESS = "127.0.0.1:7233"
$env:TEMPORAL_TASK_QUEUE = "note-analysis-smoke"
$env:FEATURE_NOTE_ANALYSIS_DRAIN = "true"
pnpm --filter @opencairn/api exec tsx scripts/note-analysis-drain-schedule-live-smoke.mjs
```

Useful overrides:

| Variable | Default | Purpose |
| --- | --- | --- |
| `NOTE_ANALYSIS_DRAIN_SMOKE_SCHEDULE_ID` | timestamped ephemeral id | Reuse a known smoke schedule id. |
| `NOTE_ANALYSIS_DRAIN_BATCH_SIZE` | `25` | Batch size passed to `NoteAnalysisDrainWorkflow`. |
| `NOTE_ANALYSIS_DRAIN_SMOKE_TIMEOUT_MS` | `120000` | Poll timeout for the seeded job. |
| `NOTE_ANALYSIS_DRAIN_SMOKE_KEEP_SCHEDULE` | unset | Set `1` to leave the schedule for Temporal UI inspection. |

Use a smoke-specific task queue such as `note-analysis-smoke`, and start the
worker with the same `TEMPORAL_TASK_QUEUE`. Reusing a busy local `ingest` queue
can make an old pending workflow run before the schedule smoke task.

## Expected Output

The command prints JSON similar to:

```json
{
  "ok": true,
  "workflowType": "NoteAnalysisDrainWorkflow",
  "taskQueue": "note-analysis-smoke",
  "status": "completed",
  "scheduleDeleted": true
}
```

If the job stays queued, check that the worker was started with
`FEATURE_NOTE_ANALYSIS_DRAIN=true` and is polling the same task queue. If the
activity fails before touching the DB row, check `INTERNAL_API_URL`,
`INTERNAL_API_SECRET`, API logs, and provider configuration.
