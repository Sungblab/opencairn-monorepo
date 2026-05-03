# Parser Gateway And CanonicalDocument Benchmark

> Date: 2026-05-03
> Status: Draft plan
> Scope: LLM/ingest modernization Phase B
> Branch: `codex/parser-gateway-benchmark`
> Worktree: `.worktrees/parser-gateway-benchmark`

## Goal

Introduce a worker-local Parser Gateway and `CanonicalDocument` benchmark path
without replacing OpenCairn's current ingest defaults.

Phase B is a measurement and contract-building step. The existing Temporal
ingest workflow still dispatches directly to `parse_pdf`, `parse_office`,
`parse_hwp`, `scrape_web_url`, `transcribe_audio`, `analyze_image`, and related
current activities until benchmark data proves a better default.

## Current Baseline

Current parser paths to preserve:

- PDF: `parse_pdf` with scan detection, opendataloader-pdf JSON, PyMuPDF, figure
  upload, Gemini OCR for scan PDFs.
- Office: `parse_office` with MarkItDown for OOXML/XLS plus unoconvert viewer
  PDF, and unoconvert + PyMuPDF for legacy DOC/PPT.
- HWP/HWPX: `parse_hwp` with H2Orestart/unoconvert to PDF and
  opendataloader-pdf text extraction.
- Web: `scrape_web_url` with SSRF guard, response-size cap, and trafilatura.
- Media/image: `transcribe_audio`, `ingest_youtube`, and `analyze_image` through
  provider/native or local fallback paths.

The first Parser Gateway adapter must wrap these as the baseline rather than
forking or deleting them.

## Parser Gateway Scope

Add the gateway under worker-local code:

- `apps/worker/src/worker/lib/parser_gateway.py`
- `apps/worker/src/worker/lib/canonical_document.py`
- `apps/worker/scripts/parser_benchmark.py`
- `apps/worker/benchmarks/parser-fixtures.example.json`
- focused worker tests under `apps/worker/tests/`

Out of scope for this PR:

- changing `IngestWorkflow` default dispatch
- adding DB migrations
- adding Docling, Marker, MinerU, PyTorch, CUDA, or model weights to worker core
- changing API upload/import behavior
- committing binary benchmark fixture documents

## CanonicalDocument Schema

`CanonicalDocument` starts as a worker-local Pydantic v2 model. It can move to a
shared/API contract only after benchmark output and downstream chunking needs
settle.

Shape:

- `source`: source type, MIME, original object key, parser name/version, parse
  start/end timestamps.
- `pages[]`: page number, optional dimensions, bounded page-local blocks.
- `blocks[]`: globally ordered blocks with id, type, `content`,
  `content_type`, bbox, page number, reading order, confidence, source offsets,
  relationships, metadata.
- `tables[]`, `figures[]`, `formulas[]`: structured side arrays for richer
  parser output.
- `warnings[]`: bounded parse warnings such as scan PDF, complex layout, OCR
  fallback, missing bbox coverage.
- `raw_artifact_key`: optional pointer to a parser-native JSON artifact.

Important constraints:

- Arrays have hard upper bounds: pages, blocks, per-page blocks, tables,
  figures, formulas, warnings, relationships.
- Blocks use `content` + `content_type` as the primary representation. Do not
  store duplicate `text`/`markdown`/`html` fields on every block unless a later
  benchmark proves the duplication is necessary.
- `as_plain_text()` provides a projection for existing note/chunk paths.
- The schema rejects duplicate block ids and invalid bbox/offset ordering.

## Baseline Adapter

Wrap current parser output as the baseline:

1. Call the current parser activity function in benchmark-only code.
2. Normalize today's return dicts:
   - `pages[].text` -> paragraph blocks
   - `pages[].tables[]` -> table side array + table block
   - `pages[].figures[]` -> figure side array + figure block
   - plain `text` / `transcript` / `description` -> one document block
   - `has_complex_layout` / `is_scan` -> warnings
3. Preserve current parser names such as `current.parse_pdf`,
   `current.parse_office`, and `current.parse_hwp` in `source.parser`.
4. Keep this adapter outside `IngestWorkflow` until a later PR explicitly
   gates and verifies default-path replacement.

## Candidate Policy

Docling, Marker, and MinerU are benchmark candidates only.

- Docling: likely strongest structured parser candidate, but CPU/RAM runtime
  must be measured before adding it to worker dependencies.
- Marker: optional external parser service candidate only. License, model
  weight, GPU/VRAM, and PyTorch footprint risks make it unsuitable as a worker
  core dependency in this phase.
- MinerU: benchmark candidate only until license, output quality, runtime, and
  deployment footprint are measured.

The benchmark CLI may list these candidates and later call external services,
but this plan does not install them.

## Docling Candidate Wiring

The first Docling wiring is benchmark-only and intentionally optional:

- `--parser docling` is accepted by `apps/worker/scripts/parser_benchmark.py`
  for non-dry runs.
- The production Temporal ingest workflow does not call Docling.
- The worker dependency set is unchanged. `docling` is imported lazily only when
  the benchmark command selects `--parser docling`.
- If Docling is not installed, not importable, or a fixture has no local file,
  the JSONL row is recorded as `status="skipped"` with `parser="docling"`.
- The result schema remains identical to the current parser rows:
  `wall_clock_ms`, `peak_python_heap_bytes`, `peak_rss_bytes`, `pages`,
  `blocks`, `tables`, `figures`, `warnings`, `plain_text_chars`, `status`, and
  `error` are always present.
- Docling's native structured payload is normalized through
  `normalize_docling_output()` into the same worker-local `CanonicalDocument`
  contract used by the current baseline.

Command:

```bash
cd apps/worker
uv run python -m scripts.parser_benchmark \
  --manifest benchmarks/parser-fixtures.local.json \
  --local-root /path/to/private/parser-fixtures \
  --parser docling \
  --out benchmarks/results/docling.jsonl
```

This does not add an optional dependency extra yet. That is deliberate: Docling
can pull a large dependency tree depending on conversion options, and this PR's
job is candidate wiring plus skipped behavior in the default environment. A
future PR can add an explicit `docling` extra only after benchmark output and
deployment notes justify the footprint.

### Local In-Process vs External Service

The initial adapter uses local in-process Docling when the benchmark environment
has already installed it. This is the lowest-friction way to measure output
shape, wall-clock time, Python heap, and process RSS with the current fixture
manifest.

Tradeoffs:

- In-process is simple and keeps fixture I/O local, but it shares worker memory
  and CPU with Temporal activities if later promoted.
- An external parser service isolates memory spikes, allows a separate image
  with Docling/OCR dependencies, and can be scaled independently, but adds
  network failure modes, auth, artifact transfer, and service lifecycle costs.
- For Fly.io and small self-host profiles, an external service is likely safer
  if Docling requires high RSS or OCR-heavy CPU time on representative fixtures.

The benchmark should decide between these options with fixture data. This PR
does not promote either option into the production default path.

## Fixture Set

The committed manifest is a skeleton, not the binary fixture corpus. Real
fixtures should live in an object-storage prefix or private benchmark bucket.

Required fixture classes:

- clean digital PDF paper
- scanned Korean PDF
- slide-heavy PDF
- table-heavy PDF
- DOCX with headings and tables
- PPTX with images and speaker-style structure
- XLSX table workbook
- HWP/HWPX converted path
- web article
- image-only document

Each fixture records MIME, source type, object key or URL, and expected features
such as OCR, tables, heading structure, formulas, figure captions, Korean text,
reading order, and bbox coverage.

## Repeatable Command

Initial dry-run command:

```bash
cd apps/worker
uv run python -m scripts.parser_benchmark \
  --manifest benchmarks/parser-fixtures.example.json \
  --parser current \
  --out benchmarks/results/parser-benchmark.jsonl \
  --dry-run
```

Current parser non-dry command:

```bash
cd apps/worker
uv run python -m scripts.parser_benchmark \
  --manifest benchmarks/parser-fixtures.local.json \
  --local-root /path/to/private/parser-fixtures \
  --parser current \
  --out benchmarks/results/current.jsonl
```

Fixture input modes:

- `local_path`: benchmark-only local file input, relative to the manifest
  directory or `--local-root`. This path avoids S3/MinIO and patches only the
  benchmark process' activity I/O calls.
- `object_key`: production-like object storage input. This requires the normal
  S3/R2/MinIO env and uses the current activities' object-store download path.
- `url`: web fixture input for `x-opencairn/web-url`.

The current baseline executes PDF, Office, HWP/HWPX, web URL, and text/Markdown
fixtures. Image, audio, video, and YouTube fixture rows are recorded as
`skipped` until those multimodal/provider paths have deterministic local
fixtures. Existing `IngestWorkflow` dispatch is unchanged.

Metrics per fixture:

- success/failure and error
- wall-clock milliseconds
- peak Python heap
- peak process RSS where the OS exposes it
- pages, blocks, tables, figures, warnings
- plain text projection character count
- later scoring fields: table fidelity, heading/reading-order fidelity,
  figure/caption fidelity, formula fidelity, Korean text quality, output size,
  source-offset/bbox coverage, downstream chunk quality

Peak RSS is best-effort without adding `psutil`; Linux/self-host runs should
report it via `resource.getrusage`, while Windows dry-run may return `null`.

## Fly.io And Self-Host Constraints

Benchmark decisions must fit small hosted and self-host profiles:

- no GPU assumption
- no huge persistent disk assumption
- no local MinIO-only assumption; object storage may be R2/S3-compatible
- no single all-in-one Docker Compose assumption for hosted deployments
- external parser services must be opt-in and explicitly configured
- parser output artifacts must be bounded and eligible for object storage

The benchmark should record dependency footprint and operational notes before
any parser becomes a default.

## Regression Strategy

No default ingest source changes in this phase.

Regression guardrails:

- keep current `IngestWorkflow` MIME dispatch tests intact
- add schema tests for `CanonicalDocument` bounds and projection behavior
- add gateway tests for current parser normalization
- add CLI dry-run tests for repeatable benchmark output
- when non-dry benchmark lands, run current parser fixtures first and compare
  text projection counts before testing candidates
- Drive/Notion/literature imports remain source producers; they should not be
  rewritten to call a new parser service in this PR

## Implementation Checklist

- [x] Confirm PR #203 is merged and start from latest `origin/main`.
- [x] Create isolated worktree at `.worktrees/parser-gateway-benchmark`.
- [x] Draft Phase B plan.
- [x] Add worker-local `CanonicalDocument` schema skeleton.
- [x] Add baseline Parser Gateway adapter skeleton.
- [x] Add benchmark command dry-run skeleton.
- [x] Add fixture manifest skeleton.
- [x] Add focused tests for schema/gateway/benchmark dry-run.
- [x] Add real fixture wiring for current parser benchmark.
- [ ] Add benchmark scoring fields for quality and downstream chunk checks.
- [ ] Decide, with benchmark output, whether Docling belongs in worker core or
      an optional parser service.

## Current Parser Wiring Notes

The non-dry `current` benchmark path is intentionally benchmark-local:

- PDF/Office/HWP/HWPX local fixtures patch activity `download_to_tempfile` to
  copy from `local_path` into a temp file. Activity event publishing, uploads,
  and heartbeats are patched to no-op only inside the benchmark context.
- Text/Markdown local fixtures are read directly and normalized through the
  same `CurrentParserAdapter` path as activity outputs.
- Web fixtures call the current SSRF-safe `scrape_web_url` activity.
- Missing `local_path` rows are `skipped`, not failed, so the committed example
  manifest remains runnable without binary fixtures.
- Rows for image/audio/video/YouTube are `skipped` in this phase. They need
  deterministic provider or local-media fixtures before they are useful as a
  baseline.

Remaining gaps:

- no committed binary corpus
- no table/heading/figure/formula quality scoring yet
- no downstream chunk-quality scoring yet
- Docling candidate execution exists only when Docling is installed externally;
  default developer environments should record `skipped`
- Marker remains an external-service-only gap because licensing, model weights,
  PyTorch footprint, GPU/VRAM expectations, and commercial compatibility are not
  resolved
- MinerU remains a benchmark gap because license, model/dependency footprint,
  CPU viability, and output-quality normalization are not measured

## Production Default Path

This phase does not change the production ingest default path. PDF, Office,
HWP/HWPX, web, media, and image ingest continue through the existing activity
dispatch described in "Current Baseline". Docling rows are benchmark evidence
only until a later PR explicitly gates, tests, and documents any default-path
replacement.

## Verification

Focused commands:

```bash
cd apps/worker
uv run pytest tests/lib/test_canonical_document.py tests/lib/test_parser_gateway.py tests/test_parser_benchmark.py
uv run python -m scripts.parser_benchmark --manifest benchmarks/parser-fixtures.example.json --parser current --out benchmarks/results/parser-benchmark.jsonl --dry-run
uv run python -m scripts.parser_benchmark --manifest benchmarks/parser-fixtures.local.json --local-root /path/to/private/parser-fixtures --parser current --out benchmarks/results/current.jsonl
git diff --check
```

If worker dependency changes are proposed later, document the reason and run the
worker dependency/type/test subset before asking for review. This plan adds no
heavy parser dependency.
