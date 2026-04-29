# Synthesis Export — Known Followups

Frozen 2026-04-29 at the close of Phase F (single-PR rollout of plan
`2026-04-27-multi-format-synthesis-export-plan.md`). Items below were
**knowingly out of scope** of v1 and are tracked here so they don't get
lost.

Each followup notes: where it lives in the code today, why it isn't
shipping in v1, and what the smallest fix shape looks like. Links use
in-repo paths so this doc keeps working as files move.

---

## 1. Workflow-level `failed` / `cancelled` DB flips

**Where:** `apps/worker/src/worker/workflows/synthesis_export_workflow.py`

**Today:** Activities flip `synthesis_runs.status` through `fetching →
synthesizing → compiling → completed` via the `set_status` helper inside
each activity (`apps/worker/src/worker/activities/synthesis_export/_status.py`).
A workflow that raises after the last activity scheduled — or that gets
cancelled by a Temporal signal — leaves the row stuck mid-flight; the
SSE stream only surfaces the failure when the 15-minute orphan window
closes (`apps/api/src/routes/synthesis-export.ts`, `runs/:id/stream`).

**Why deferred:** Workflows can't `patch_internal()` HTTP endpoints
directly without a small activity wrapper, and we wanted to ship the
happy path first.

**Smallest fix:** Add `set_run_status_activity(runId, status)` next to
the other status activities; call it from
`SynthesisExportWorkflow.run`'s `try/except/finally` so any uncaught
`ApplicationError` or `CancelledError` flips the row to
`failed`/`cancelled` before propagating. The SSE stream's existing
terminal-status handling will then close the connection immediately
instead of waiting on the orphan window.

---

## 2. Real semantic search in `auto-search`

**Where:** `apps/worker/src/worker/activities/synthesis_export/fetch_source.py`
(the `auto-search` branch).

**Today:** Returns an empty list. The route accepts `autoSearch: true`,
the worker logs the request, and the run continues with whatever
explicit sources/notes the user supplied.

**Why deferred:** The Phase 4 ResearchAgent's `hybrid_search` builtin
tool is the obvious source of truth, but its tool-loop integration with
`SynthesisAgent` needs more thought (token budget interaction, source
dedupe with `explicitSourceIds`).

**Smallest fix:** Reuse `apps/worker/src/runtime/builtins/hybrid_search.py`
inside the `auto-search` branch with `top_k = max(0, 20 -
len(explicit_sources))`. Plumb the resulting hits as `synthesis_sources`
rows with `source_type='note'` (or a new `kind='search'` value if we
want to keep them separable in audit).

---

## 3. `dr_result` source kind handoff

**Where:** `apps/worker/src/worker/activities/synthesis_export/fetch_source.py`,
`packages/shared/src/synthesis-types.ts` (`synthesisSourceTypeValues`).

**Today:** `dr_result` is in the type union but the fetch branch is a
501 stub. Deep-research runs can't be passed into a synthesis-export
run as a source.

**Why deferred:** Needs a contract between Deep Research artifacts
(`research_artifacts.kind` payload shape) and the synthesis fetcher.
Right now Phase D's `report` artifact is the obvious target, but the
exact `report.payload` schema is still settling.

**Smallest fix:** Add `_fetch_dr_result(sourceId)` that loads the
`research_artifacts` row, asserts `kind='report'`, and serialises the
markdown payload as a virtual document for the synthesis prompt. Keep
the citation key derivation deterministic (e.g.
`dr-{first8(researchRunId)}`).

---

## 4. `s3_object` Zod relaxation

**Where:** `packages/shared/src/synthesis-types.ts` (the `sourceId`
schema accepts `z.string().uuid()`).

**Today:** Public `POST /run` rejects raw S3 keys because
`explicitSourceIds` is typed as `uuid()`. Phase E's `SourcePicker`
hides this by always feeding through `notes.id` and `synthesisSources`,
so users never see it. The internal API is fine.

**Why deferred:** A future Source Picker dialog (followup #5 in the
plan) wanted to support pasting raw MinIO keys. We can decide whether
to relax the Zod schema once that dialog ships.

**Smallest fix:** If the dialog goes live, keep `uuid()` for `note_id` /
`dr_result_id` and add a discriminated union or a separate
`s3SourceSchema` that accepts the bucket-prefixed key. Don't relax
silently — make it explicit so the picker can't accidentally double up.

---

## 5. Browser singleton pool for PDF compile

**Where:** `apps/worker/src/worker/activities/synthesis_export/pdf.ts`
TODO marker (`browser-per-call → singleton pool`).

**Today:** Every `compile-document` activity launching the PDF format
spawns a fresh Playwright Chromium instance. Cold start adds ~1.5s per
run; under load this is wasted CPU/RAM.

**Why deferred:** Premature optimisation. v1 throughput is gated by
LLM latency, not browser startup.

**Smallest fix:** Hold a single `playwright.chromium.launch()` handle
on the worker process and lease pages out per call. Watch out for
Temporal worker restarts — wire the close into the worker shutdown
hook, not just `__del__`.

---

## 6. `synthesis_sources` UNIQUE constraint

**Where:** `packages/db/src/schema/synthesis-export.ts` (no unique
constraint on `(runId, sourceType, sourceId)` today).

**Today:** Worker retry of `fetch-source` activity is idempotent in
intent — same input → same row — but two parallel retries can race and
insert duplicates. Visible only as a doubled row in `SynthesisSources`
on rare flakes.

**Why deferred:** No production reports yet. Migration adds a backfill
risk if any historical run has duplicates.

**Smallest fix:** Migration `add unique (run_id, source_type, source_id)
on synthesis_sources`. Backfill plan: dedupe duplicates by `min(id)`
before adding the constraint. Worker activity already uses
`onConflictDoNothing` semantics in spirit, so behaviour change is nil.

---

## 7. Polling SSE → Redis pub/sub

**Where:** `apps/api/src/routes/synthesis-export.ts` (`runs/:id/stream`,
2 s polling loop on `synthesis_runs.status`).

**Today:** The SSE handler polls `synthesis_runs` every 2 s and emits
events when `status` advances. Works fine for the Phase F use case but
is out of step with the Live Ingest pattern (`apps/api/src/lib/ingest-events.ts`)
which subscribes to Redis pub/sub channels written by the worker.

**Why deferred:** The polling path is simple and correct; aligning with
Live Ingest is housekeeping, not a behaviour win for users.

**Smallest fix:** Worker activities publish to `synthesis-export:{runId}`
on each status flip. SSE route subscribes via `subscribeOnce` and falls
back to a single seed read for the `queued` event. Same envelope as
`synthesisStreamEventSchema`.

---

## 8. `SYNTHESIS_EXPORT_TIMEOUT_MS` operations guide

**Where:** Env knob honoured in `apps/api/src/lib/synthesis-export-client.ts`
(workflow `runTimeout` override) — defaulted to 2 hours.

**Today:** Operators have no doc telling them when to bump it (large
korean-thesis runs with the Tectonic profile can approach the limit if
the source set is wide). Today the env-only override is documented in
the design spec but not in `docs/contributing/hosted-service.md`.

**Why deferred:** No incidents yet, and the default is generous.

**Smallest fix:** Add an "Ops knobs" subsection to
`docs/contributing/hosted-service.md` listing `SYNTHESIS_EXPORT_TIMEOUT_MS`
alongside `MAX_UPLOAD_BYTES`, `INGEST_BATCH_SIZE`, etc., with the
guidance: bump above 7,200,000 ms only if Pro/Tectonic compile is on
**and** runs routinely include >30 sources or >50,000 source tokens.

---

## E2E smoke captures (Phase F)

Phase F E2E smoke captured four screenshots of the v1 happy path. Files
land outside the repo (operator local home) since binary screenshots
should not bloat the git history; the design spec has a small footer
appendix listing the absolute paths each operator chose, so this doc
cross-references that appendix.

See `docs/superpowers/specs/2026-04-27-multi-format-synthesis-export-design.md`
§ "E2E smoke captures (Phase F)" for the path list.
