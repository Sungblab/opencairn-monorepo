# Session 3 — Ingest Pipeline & Sources — FINAL Audit Summary

**Completed**: 2026-04-28 (8 iterations)
**Stop condition met**: Critical/High 0건 × 연속 2 iteration (iter 7 + iter 8)
**Total unique findings**: 1 Critical, 13 High, 22 Medium, 26 Low, 7 Info

---

## Iteration Completion Table

| Iteration | Areas | Critical | High | New Unique C/H | Zero-H Streak |
|-----------|-------|----------|------|----------------|---------------|
| 1 | IngestWorkflow + Batch embeddings | 0 | 4 | 4 | — |
| 2 | Source expansion + Literature | 1 | 6 | 7 | reset |
| 3 | Content-aware enrichment + Live Ingest Viz | 0 | 3 | 2 (S3-052, S3-056) | reset |
| 4 | Scan PDF OCR + Regression checks | 0 | 1 | 0 (dup) | **1** |
| 5 | Infra config + Temporal + Final sweep | 0 | 4 | 3 (S3-073, S3-074, S3-075) | reset |
| 6 | Test coverage + Python deps + API security | 0 | 2 | 1 (S3-089) | reset |
| 7 | Self-hosted compose + dispatch coverage | 0 | 1 | 0 (dup) | **1** |
| 8 | Rate limiting + Temporal + Final verification | 0 | 2 | 0 (dups) | **2** ✓ |

---

## All Unique Findings

### Critical (1)
| ID | Title | File |
|----|-------|------|
| S3-020 | Drive access token NEVER injected into worker — Drive import completely broken | `apps/worker/src/worker/activities/drive_activities.py:82-98` |

### High (13 unique)
| ID | Title | File |
|----|-------|------|
| S3-001 | `workspace_id` never passed from API routes into IngestInput | `apps/api/src/routes/ingest.ts:182-245` |
| S3-002 | `ImportWorkflow._run_binary` omits `workspace_id` in child `IngestInput` | `apps/worker/src/worker/workflows/import_workflow.py:235-246` |
| S3-003 | `LitImportWorkflow._handle_paper` omits `workspace_id` in child `IngestInput` | `apps/worker/src/worker/workflows/lit_import_workflow.py:150-157` |
| S3-004 | `text/plain`/`text/markdown` MIME types fall through to `raise ValueError` | `apps/worker/src/worker/workflows/ingest_workflow.py:225-226` |
| S3-006 | No `heartbeat_timeout` on any IngestWorkflow activity — heartbeats are no-ops | `apps/worker/src/worker/workflows/ingest_workflow.py` |
| S3-021 | Drive token injected via `os.environ` in shared worker process (cross-user race) | `apps/worker/src/worker/activities/drive_activities.py:82-98` |
| S3-022 | Drive OAuth token stored per-user, not per-workspace | `packages/db/src/schema/user-integrations.ts:9-32` |
| S3-023 | Drive token refresh not implemented; expired token causes silent workflow failure | `apps/worker/src/worker/activities/drive_activities.py` |
| S3-024 | Notion ZIP object key not validated against issuing user/workspace | `apps/api/src/routes/import.ts:170-228` |
| S3-025 | Drive folder walk does not handle pagination (silent truncation at > 1000 items) | `apps/worker/src/worker/activities/drive_activities.py:157-176` |
| S3-052 | Redis/Temporal gRPC 7233/Temporal UI 8080/MinIO 9001 all exposed without auth | `docker-compose.yml` |
| S3-056 | `startRun` has no UI call site — Live Ingest Visualization completely dead in production | `apps/web/src/stores/ingest-store.ts:71` |
| S3-073 | MinIO/Worker S3 client hardcoded `minioadmin` fallback credentials | `apps/api/src/lib/s3.ts:37-38`, `apps/worker/src/worker/lib/s3_client.py:30-31` |
| S3-089 | `INTERNAL_API_SECRET` defaults to `"change-me-in-production"` in worker | `apps/worker/src/worker/lib/api_client.py:21` |

> Note: S3-052 covers Redis (6379), Temporal gRPC (7233), Temporal UI (8080), MinIO console (9001) — all unauthenticated and published to host. Originally split across S3-074/S3-075/S3-076/S3-112 in later iterations but consolidated here as one root infrastructure finding.

### Medium (22 unique)
| ID | Title |
|----|-------|
| S3-005 | `import os` inside workflow body breaks Temporal determinism sandbox |
| S3-007 | OCR scan PDF path has no page-count or byte cap |
| S3-008 | `enrich_document`/`detect_content_type` call `provider.generate()` directly (policy TBD) |
| S3-009 | Enrichment always uses admin key, not BYOK |
| S3-010 | `purge_embedding_jsonl.py` is an unscheduled manual script |
| S3-026 | `upload_staging_to_minio` does not validate `staging_path` against staging root |
| S3-027 | SSRF guard incomplete: IPv6, reserved ranges, DNS rebinding not covered |
| S3-029 | Internal DOI lookup `exists` field not contract-tested |
| S3-030 | `fetch_and_upload_oa_pdf` buffers full 50 MiB into memory before size check |
| S3-034 | Presigned PUT URL does not enforce Content-Type `application/zip` |
| S3-035 | `LitImportInput.ids` not validated for DOI/arXiv format |
| S3-036 | No rate limiting on `POST /api/literature/import` |
| S3-045 | Re-enrichment blindly overwrites `status=done` artifact without guard |
| S3-046 | Enrichment always uses global admin key, never BYOK |
| S3-061 | Scan PDF OCR retry is non-idempotent: partial OCR costs on retry |
| S3-066 | Hardcoded `embed_model` in `create_plan.py` |
| S3-070 | `ingest_jobs` table has no `status` column; failures not persisted |
| S3-077 | No container resource limits on worker service |
| S3-078 | `BATCH_EMBED_*` flags not forwarded to worker in docker-compose |
| S3-079 | `apps/worker/.env.example` severely under-documented |
| S3-088 | `GET /api/import/jobs` lists all workspace members' jobs (information disclosure) |
| S3-090 | PostgreSQL port 5432 published to host on all interfaces |
| S3-098 | `api` service missing healthcheck causes `web` deadlock on `docker compose up` |
| S3-105 | `text/csv`/`text/plain`/`text/markdown` from Drive/Notion import also hit `raise ValueError` |
| S3-107 | No rate limit on `POST /api/ingest/upload` or `POST /api/ingest/url` |
| S3-108 | No per-user/workspace quota on ingest volume |

### Low & Info (26 unique low + 7 info — see individual iteration files for full list)

---

## Top Priority Fixes (Ordered by Risk)

### Tier 0 — Production Blockers
1. **S3-020** (Critical): Drive import broken — `_DRIVE_ACCESS_TOKEN_HEX` never set
2. **S3-052** (High): Redis 6379 + Temporal gRPC 7233 + Temporal UI 8080 + MinIO 9001 — all unauthenticated, host-published
3. **S3-001/S3-002/S3-003** (High): `workspace_id` missing in all 5 IngestWorkflow dispatch sites — enrichment silently lost
4. **S3-004/S3-105** (High): `.txt`/`.md`/`.csv` uploads quarantined silently
5. **S3-056** (High): Live Ingest Visualization completely dead — `startRun` has no UI call site

### Tier 1 — Security Fixes
6. **S3-073** (High): Remove `minioadmin` fallback from S3 clients
7. **S3-089** (High): Remove `"change-me-in-production"` default from `api_client.py`
8. **S3-021** (High): Drive token must be passed via payload, not `os.environ`
9. **S3-024** (High): Validate Notion ZIP object key against user/workspace prefix
10. **S3-088** (Medium): Add `userId` filter to `GET /api/import/jobs`

### Tier 2 — Reliability Fixes
11. **S3-006** (High): Add `heartbeat_timeout` to all IngestWorkflow activities
12. **S3-023** (High): Implement Drive token refresh before expiry
13. **S3-025** (High): Implement Drive folder walk pagination
14. **S3-070** (Medium): Add `status` column to `ingest_jobs`
15. **S3-098** (Medium): Add `api` service healthcheck to unblock self-hosted compose

### Tier 3 — Operational Hardening
16. **S3-022** (High): Scope Drive OAuth tokens per-workspace
17. **S3-010** (Medium): Register JSONL purge in `maintenance_schedules.py`
18. **S3-090** (Medium): Bind PostgreSQL to loopback only
19. **S3-077** (Medium): Add container resource limits to worker
20. **S3-107/S3-108** (Medium): Add rate limiting and quota enforcement to ingest routes
