# ADR-008: Batch Embedding — Child Workflow + MinIO Sidecar + Per-Agent Feature Flag

## Status: Accepted (2026-04-22)

## Context

ADR-007이 `gemini-embedding-001`로의 전환을 결정하면서 Batch API 50% 할인($0.15/1M → $0.075/1M)을 "별도 Plan"으로 연기. Plan 3b에서 구현할 때 세 가지 의사결정 포인트가 나타남:

1. **배치 호출 단위** — per-note / per-project queue / caller-owned batch 중 무엇?
2. **Temporal integration** — polling이 최대 24시간인 batch lifecycle을 어떻게 durable하게 유지?
3. **대형 결과 페이로드** — 2000×768×float32 ≈ 6 MiB. Temporal 기본 payload 상한 2 MiB 초과.

추가로 실제 agent 경로 두 개(Compiler / Librarian)의 latency 요구사항이 충돌:

- **Compiler**: ingest 직후 호출. 노트 업로드 → 하이브리드 서치에 등장하는 SLA가 UX를 결정. 24시간 딜레이는 regression.
- **Librarian**: overnight maintenance sweep. 수 시간 딜레이 허용 범위 내.

## Decision

### 1. Child workflow + 3 activities + 모듈레벨 Client callback

새 `BatchEmbedWorkflow`를 정의. 활동 3개(`submit_batch_embed`, `poll_batch_embed`, `fetch_batch_embed_results`) + best-effort `cancel_batch_embed`.

Compiler/Librarian은 활동(`compile_note`, `run_librarian`) 안에서 실행되므로 `workflow.execute_child_workflow`를 직접 호출할 수 없음. 따라서 `worker.lib.batch_submit.make_batch_submit()`가 **Temporal Client를 열어 sibling workflow를 시작**하고 `handle.result()`로 block. 활동은 이 호출을 하는 동안 슬롯을 점유하지만 heartbeat가 살아있어 안전. 24시간 상한은 `BATCH_EMBED_MAX_WAIT_SECONDS` env로 조정.

**거부 대안 (option b)**: `compile_note`를 `compile_extract` + `compile_persist`로 분할하고 `IngestWorkflow`가 사이에서 batch child를 spawn. 더 깔끔하지만 2배 이상의 리팩터. Phase 2에서 재검토.

### 2. JSONL 사이드카 (MinIO / R2)

요청/응답 페이로드를 `s3://opencairn-uploads/embeddings/batch/{wf_id}/(input|output).jsonl`에 저장. Temporal 페이로드에는 S3 key만 싣고 activity 내부에서 읽고 씀. 벡터는 DB에 직접 쓰지 않음(bytea bloat 방지) — `embedding_batches`에 key만 기록하고, output JSONL은 감사용.

### 3. 새로운 `embedding_batches` 테이블 (Drizzle 0009)

기존 `jobs` 테이블 재활용 대신 전용 테이블. `jobs`는 user-action 생애주기(ingest/qa/audio)에 묶여 있어 provider-level 아티팩트와 섞이면 billing 쿼리를 오염. `workspace_id`는 nullable (`ON DELETE SET NULL`) — Librarian cross-workspace sweep이 synthetic workspace를 만들 필요 없음.

스키마: `provider` / `providerBatchName` (unique, replay idempotency) / `state` (enum) / counts / `inputS3Key` / `outputS3Key` / timestamps.

### 4. 이원 flag: Compiler 따로, Librarian 따로

단일 `BATCH_EMBED_ENABLED` 대신 `BATCH_EMBED_COMPILER_ENABLED` / `BATCH_EMBED_LIBRARIAN_ENABLED`. 롤아웃 시나리오:

- Librarian 먼저 ON (overnight, SLA 관대).
- Compiler는 실측 batch latency p95가 충분히 낮을 때까지 OFF. Phase 1 운영 데이터가 p95 > 2h면 Compiler는 영구적으로 OFF 유지 (ADR-007 Batch API benefits를 Librarian만 누림).

추가 임계값: `BATCH_EMBED_MIN_ITEMS=8` — 미만은 sync fallback. 작은 batch는 할인보다 레이턴시 페널티가 큼.

### 5. Fallback은 silent + observable

`embed_many()`가 flag off / provider unsupported (Ollama) / batch 워크플로 실패를 모두 캐치해 동기 경로로 내려감. 가용성 우선. 단 Prometheus `opencairn_batch_embed_fallback_total{reason}` 카운터 (B4 후속 작업)로 관측 가능하게 하여 알람 기반 대응.

## Consequences

- **Compiler/Librarian 코드 변화 최소화**: 두 agent는 `provider.embed(...)` → `embed_many(provider, ..., batch_submit=self._batch_submit, flag_env=...)`로 직접 호출만 교체. `embed_many`가 분기 판단을 흡수.
- **Librarian loop는 현재 per-cluster 1 item 호출**이라 `BATCH_EMBED_MIN_ITEMS=8` 임계를 넘지 못해 실효 배치가 아님. **TODO(Plan 3b Phase 2)**: `_merge_duplicates` 리팩터 (cluster별 merged_summary 일괄 생성 → 한 번에 embed_many → 다시 루프) 필요. 현재 구현은 infrastructure만 완비한 상태.
- **activity slot 점유**: Compiler/Librarian 활동이 `handle.result()`로 대기하는 동안 slot 유지. Plan 4 B 시점의 `start_to_close_timeout=1h`가 v0 천장. flag ON으로 전환 전 heartbeat/timeout 재검토 필요.
- **JSONL retention**: `embeddings/batch/` prefix는 운영상 7일 후 purge하는 것이 바람직. R2는 lifecycle rule로, dev MinIO는 수동 크론(Plan 3b에서는 문서화만). 미결.
- **Idempotency**: `embedding_batches.providerBatchName` unique + upsert `ON CONFLICT DO NOTHING` → worker 크래시 후 submit activity replay 시 중복 insert 방지.

## References

- Plan 3b spec/plan: `../../contributing/roadmap.md`.
- Gemini Batch API 로컬 문서: `references/Gemini_API_docs/08-batch/Batch API.md`, `06-embeddings/Embeddings.md`.
- ADR-007 Batch API 연기 결정이 본 ADR의 선행 context: `docs/architecture/adr/007-embedding-model-switch.md`.
- 구현 PR / 커밋: feat/plan-3b-batch-embeddings 브랜치.
