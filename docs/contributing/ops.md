# Ops Guide

운영 담당자용 런북. 배치 임베딩 (Plan 3b) 프로덕션 활성화와 일상 유지관리.

---

## Batch Embeddings (Plan 3b)

### 플래그

| 환경변수 | 기본값 | 역할 |
|---|---|---|
| `BATCH_EMBED_COMPILER_ENABLED` | `false` | Compiler 경로의 배치 허용 |
| `BATCH_EMBED_LIBRARIAN_ENABLED` | `false` | Librarian 경로의 배치 허용 |
| `BATCH_EMBED_MAX_WAIT_SECONDS` | `86400` (24h) | 배치 workflow의 최대 폴링 기간 |
| `BATCH_EMBED_MIN_ITEMS` | `8` | 미만은 동기 경로 |
| `BATCH_EMBED_JSONL_TTL_DAYS` | `7` | purge 스크립트의 기본 보존 기간 |

플래그를 ON 하기 전 (프로덕션/스테이징):

1. Worker 재기동이 필요. `compile_note` / `run_librarian` 액티비티 타임아웃은 워크플로우 모듈 import 시점에 env 를 읽어 계산 (`worker/lib/batch_timeouts.py`). 플래그 변경 후 재기동 안 하면 활성화 안 됨.
2. MinIO / R2 에 `embeddings/batch/` 프리픽스 쓰기 권한 확인.
3. 아래 JSONL 회수 루틴이 걸려 있는지 확인 (R2: lifecycle rule / MinIO: cron).

### 구조화 로그 이벤트

`worker.batch_embed` / `batch_embed.fallback` 네임스페이스. JSON 필드 `event` 로 매칭.

| Event | Level | 주요 필드 |
|---|---|---|
| `batch_embed.submit` | INFO | `workspace_id`, `input_count`, `provider_batch_name`, `batch_id` |
| `batch_embed.poll_done` | INFO | `batch_id`, `state`, `success_count`, `failure_count` |
| `batch_embed.fetch` | INFO | `batch_id`, `duration_seconds`, `success_count`, `failure_count` |
| `batch_embed.fallback` | WARNING | `reason` (`provider_unsupported` \| `batch_failed`), `input_count`, `workspace_id` |

대시보드 (Loki / CloudWatch Insights) 예시:

```logql
# 일일 배치 수
sum by (workspace_id) (count_over_time({app="worker"} | json | event="batch_embed.submit" [1d]))

# 폴백률
sum by (reason) (rate({app="worker"} | json | event="batch_embed.fallback" [5m]))

# 배치 SLA p95 (fetch 시 기록되는 duration_seconds)
quantile_over_time(0.95, {app="worker"} | json | event="batch_embed.fetch" | unwrap duration_seconds [1h])
```

### JSONL 사이드카 회수 (7일 보존)

#### R2 프로덕션
버킷 lifecycle rule 적용:

```
Prefix: embeddings/batch/
Action: Expire after 7 days
```

Cloudflare R2 콘솔 → Bucket → Lifecycle rules 에서 설정. 7 일은 SLA 디버깅 + 재임베드 여유. 단축할 이유 없음.

#### MinIO / self-host
커뮤니티 에디션은 lifecycle 제한적. 대신 worker 컨테이너 내 cron:

```bash
# 매일 새벽 4시 (운영 시간 회피)
0 4 * * * python -m scripts.purge_embedding_jsonl >> /var/log/purge.log 2>&1
```

dry-run 먼저 확인:

```bash
python -m scripts.purge_embedding_jsonl --dry-run
```

옵션:
- `--max-age-days N` (기본 7)
- `--prefix <path/>` (기본 `embeddings/batch/`)
- `--bucket <name>` (기본 `S3_BUCKET` env)
- `--dry-run`

스크립트는 **스토리지 전용** — `embedding_batches` 테이블 행은 건드리지 않음. DB 행은 billing 재조정 / ops 감사에 보존.

### 실패 런북

#### `batch_embed.fallback{reason="provider_unsupported"}` 증가
→ Gemini API 키 또는 SDK 버전 문제. `packages/llm` 의 `GeminiProvider.supports_batch_embed` 가 `False` 를 반환하는 경로. API 키 권한 확인, `google-genai` 버전 pin 확인.

#### `batch_embed.fallback{reason="batch_failed"}` 증가
→ 워크플로우가 배치 tier 실패를 Temporal retry 를 소진할 때까지 반복. Temporal UI 에서 실패한 `BatchEmbedWorkflow` 실행 확인. 일반 원인:
- Gemini 429 (쿼터 한도) → 요청률 완화, 필요 시 `BATCH_EMBED_MIN_ITEMS` 상향
- 배치 expired (>24h 미완료) → `BATCH_EMBED_MAX_WAIT_SECONDS` 조정 또는 트래픽이 배치 tier 로 설계됐는지 재검토

#### `compile_note` / `run_librarian` 이 플래그 ON 직후 즉시 타임아웃
→ 워커를 재기동 안 했음. `worker/lib/batch_timeouts.py` 의 `start_to_close_timeout` 는 import 시점에 고정. 컨테이너 재기동.

---

## 향후 확장 (Prometheus / OTEL)

현재는 구조화 로그만. `apps/worker/pyproject.toml` 의 optional `otel` extra 를 활성화해 OTEL 배출로 전환하려면:
1. `worker/lib/batch_metrics.py` 의 `emit_event` 에 OTEL meter 호출 추가 (로그는 유지)
2. `packages/llm/src/llm/embed_helper.py` 의 `_emit_fallback` 도 동일
3. `opencairn_batch_embed_*` 이름은 Plan 3b §B4 에서 예약된 counter 네임으로 사용

---

## Plan 8 scheduled agents

Plan 8의 Curator / Connector / Staleness 에이전트는 Temporal Schedule로 자동 실행한다. worker는 이미 `CuratorWorkflow`, `ConnectorWorkflow`, `StalenessWorkflow`를 등록하므로, 운영자는 아래 ensure 스크립트로 Temporal 서버에 스케줄을 생성하거나 갱신한다.

### 환경변수

| 환경변수 | 기본값 | 역할 |
|---|---:|---|
| `CURATOR_CRON` | `0 3 * * *` | 프로젝트별 CuratorWorkflow 실행 주기 |
| `CONNECTOR_CRON` | `0 4 * * 0` | concept별 ConnectorWorkflow 실행 주기 |
| `STALENESS_CRON` | `CURATOR_CRON` 값 | 프로젝트별 StalenessWorkflow 실행 주기 |
| `STALE_DAYS` | `90` | StalenessWorkflow 입력의 `stale_days` |
| `TEMPORAL_ADDRESS` | `localhost:7233` | Temporal endpoint |
| `TEMPORAL_NAMESPACE` | `default` | Temporal namespace |
| `TEMPORAL_TASK_QUEUE` | `ingest` | worker task queue |

자동 스케줄은 사용자 트리거가 아니므로 `--user-id`에는 해당 workspace owner 또는 운영용 service user를 넣는다. 권한 우회용 API를 새로 만들지 않고 기존 workflow 입력만 예약하므로, 대상 프로젝트와 concept 목록은 운영자가 명시적으로 제공한다.

### 단일 프로젝트 ensure

```bash
cd apps/worker
python -m scripts.ensure_plan8_schedules \
  --workspace-id <workspace-uuid> \
  --project-id <project-uuid> \
  --user-id <workspace-owner-user-id> \
  --connector-concept-id <concept-uuid>
```

`--connector-concept-id`는 반복 가능하다. ConnectorWorkflow는 현재 concept 단위 workflow라 concept id가 없으면 기본 `all` 실행에서 connector 스케줄만 건너뛴다. connector만 명시한 경우에는 concept id가 없으면 실패한다.

### 여러 프로젝트 ensure

```json
[
  {
    "workspace_id": "workspace-uuid",
    "project_id": "project-uuid",
    "user_id": "workspace-owner-user-id",
    "connector_concept_ids": ["concept-uuid-1", "concept-uuid-2"]
  }
]
```

```bash
cd apps/worker
python -m scripts.ensure_plan8_schedules --targets-file plan8-targets.json
```

특정 에이전트만 갱신할 때는 `--target curator`, `--target staleness`, `--target connector`를 사용한다. 같은 schedule id에 대해 다시 실행하면 create 대신 update가 수행되므로 cron이나 `STALE_DAYS` 변경 후 같은 명령을 재실행하면 된다.

### 삭제

```bash
cd apps/worker
python -m scripts.ensure_plan8_schedules \
  --targets-file plan8-targets.json \
  --delete
```

삭제도 idempotent하게 처리한다. 이미 없는 스케줄은 `missing`으로 출력하고 계속 진행한다.

---

## canvas_outputs ops (Plan 7 Phase 2)

- **Bucket layout**: `canvas-outputs/<workspaceId>/<noteId>/<contentHash>.{png|svg}` under the shared `S3_BUCKET` (default `opencairn-uploads`).
- **Cleanup**: `apps/worker/scripts/purge_canvas_outputs.py` — orphan-only sweep. Lists aged keys (default >30d) under the `canvas-outputs/` prefix, filters them against `canvas_outputs.s3_key` in Postgres, and deletes only those with no matching DB row. In-use rows are left strictly alone, so an active note's figures aren't garbage-collected mid-life.
  - `python -m scripts.purge_canvas_outputs --dry-run` — preview
  - `python -m scripts.purge_canvas_outputs` — live, 30 days
  - `python -m scripts.purge_canvas_outputs --skip-db` — emergency storage-only mode (DB unreachable; expect gallery 404s afterwards)
  - TTL knob: `CANVAS_OUTPUTS_TTL_DAYS` env var (default 30).
- **Monitoring**: import `docs/observability/grafana-dashboards/canvas-outputs.json` for the standard panel set (object count, total bytes, upload failure rate, time-series + purge annotations). Metric emission is a Phase 3 follow-up — the dashboard imports cleanly but shows "No data" until `opencairn_canvas_*` counters/gauges are wired (see the dashboard README for the contract).
- **Idempotency**: SHA-256 collision on `(noteId, contentHash)` returns the existing row's id rather than re-uploading. Concurrent first-write races protected by the `canvas_outputs_note_hash_unique` UNIQUE index — losers get the existing row via the second SELECT after `ON CONFLICT DO NOTHING`.
- **Size cap**: hard 2MB enforced at `bodyLimit` middleware AND post-parse `file.size` check (defense in depth) — 413 `outputTooLarge` on overflow.
- **Mime allow-list**: `image/png`, `image/svg+xml` only — 400 `outputBadType` on others.
- **Workflow `failed` status**: if `agent.run` raises and `set_run_status("failed")` itself raises, the original exception still propagates (best-effort status flip). Worst case: status remains `running` and the workflow's `RetryPolicy(maximum_attempts=2)` plus the 1-hour `workflowExecutionTimeout` bound the damage.
- **SSE keep-alive**: every poll iteration sends either a data event or `: keepalive\n\n` comment frame, so proxies (nginx 60s, Cloudflare 100s defaults) won't drop long `awaiting_feedback` waits.

---

## Compose port exposure (S3-052)

`docker-compose.yml`은 인프라 포트(`postgres`, `redis`, `temporal`, `temporal-ui`, `minio`, `ollama`)를 디폴트로 `127.0.0.1` 에 published 한다. 운영자가 명시적으로 override 하지 않는 한 호스트 인터넷 노출이 인프라 노출로 이어지지 않는다. 정책·override 기준·인증 상태표는 [`hosted-service.md` § Compose port exposure policy](./hosted-service.md#compose-port-exposure-policy-s3-052) 참고.

운영 점검 1줄:

```bash
docker compose config | grep -E "host_ip|published"
```

모두 `host_ip: 127.0.0.1` 이어야 정상. 의도적으로 외부 노출이 필요한 서비스만 `0.0.0.0` 으로 보여야 한다.

## Ingest reliability — heartbeat budgets (S3-006)

`IngestWorkflow`의 모든 activity dispatch 는 `heartbeat_timeout` 을 명시한다.
워커 프로세스가 hang 되면 `heartbeat_timeout` 안에 Temporal 이 detect → retry,
LLM/LibreOffice 가 정상적으로 오래 걸리는 경우는 activity 본체가 `activity.heartbeat()`
로 살아있다는 신호를 보낸다.

| 위치 | heartbeat_timeout |
|------|-------------------|
| `_LONG_HEARTBEAT` (120 s) — `parse_pdf`, `transcribe_audio`, `ingest_youtube`, `parse_office`, `parse_hwp`, `enhance_with_gemini`, `enrich_document` | 120 s |
| `_SHORT_HEARTBEAT` (30 s) — `analyze_image`, `scrape_web_url`, `read_text_object`, `emit_started`, `quarantine_source`, `report_ingest_failure`, `create_source_note`, `detect_content_type`, `store_enrichment_artifact` | 30 s |

`_LONG_HEARTBEAT` 이 120 s 인 이유: Gemini `generate_multimodal` / `markitdown` / `unoconvert` 같은 단발 blocking 호출이 await 도중 heartbeat 을 부를 수 없으니 budget 이 그 호출 자체의 p99 latency 를 커버해야 한다. 향후 background-heartbeat helper 가 들어오면 30 s 로 좁힐 수 있다.

활동 본체의 heartbeat 호출 contract: 각 활동은 자기 heartbeat_timeout 안에 적어도 한 번 `activity.heartbeat()` 를 호출해야 한다 (`apps/worker/src/worker/activities/office_activity.py` 가 reference 패턴). 새 activity 추가 시 `apps/worker/tests/workflows/test_ingest_heartbeat.py` 의 정적 + 동적 회귀가 누락을 잡는다.
