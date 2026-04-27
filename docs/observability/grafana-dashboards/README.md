# Grafana dashboards

JSON snapshots that operators import into a Grafana instance pointed at the
project's Prometheus. Drop a file in here, then in Grafana → Dashboards →
Import → upload the JSON (or paste contents). Each dashboard pins its
schema version so the import is reproducible across Grafana 10/11 minor
releases.

## Conventions

- **uid** matches the filename without extension (`canvas-outputs.json`
  → `uid: canvas-outputs`). Keeps URLs stable across re-imports.
- Datasources are exposed as a `$datasource` template variable so the
  same JSON works in dev (local Prometheus) and prod (managed). Don't
  hard-code datasource UIDs.
- Metric names follow the `opencairn_<feature>_*` namespace already
  used by the worker observability layer (see
  `docs/contributing/ops.md` § 향후 확장 (Prometheus / OTEL)).

## Dashboards

| File | Status | What it watches | Companion script |
| ---- | ------ | --------------- | ---------------- |
| `canvas-outputs.json` | Aspirational | Object count + total bytes + upload failure rate under `canvas-outputs/*` (Plan 7 Phase 2). | `apps/worker/scripts/purge_canvas_outputs.py` |

### canvas-outputs.json — current data dependencies

The panels reference metrics that **are not yet emitted** by the worker
or API (the project ships structured logs only today). Wiring them up
is a separate Phase 3 follow-up:

| Metric | Type | Suggested source |
| ------ | ---- | ---------------- |
| `opencairn_canvas_outputs_object_count{bucket}` | Gauge | Worker s3-stats scrape job; or a MinIO Prometheus exporter sidecar with a recording rule that filters `bucket="opencairn-uploads", prefix="canvas-outputs/"`. |
| `opencairn_canvas_outputs_total_bytes{bucket}` | Gauge | Same as above, sum of `Content-Length`. |
| `opencairn_canvas_upload_total{status}` | Counter | API middleware on `/api/canvas/output` — increment with `status="success"` on 2xx, `status="failure"` on 4xx/5xx. |
| `opencairn_canvas_outputs_purge_runs_total` | Counter | Bumped by `purge_canvas_outputs.py` at the start of each successful sweep — drives the annotation rail. |

Until the emitters land, the dashboard imports cleanly but the panels
show "No data" — that's expected. Don't delete the panels; the queries
become the contract that the emission code must satisfy.
