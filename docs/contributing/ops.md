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
