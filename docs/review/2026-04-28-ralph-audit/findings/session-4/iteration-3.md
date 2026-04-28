# Session 4 — Iteration 3 Findings

**영역**: Area 5 (Deep Research Phase A~E)  
**범위**: `apps/worker/src/worker/activities/deep_research/` (create_plan, iterate_plan, execute_research, persist_report, finalize, keys, cost), `apps/worker/src/worker/workflows/deep_research_workflow.py`, `apps/api/src/routes/research.ts`, `apps/api/src/routes/internal.ts` (research-related routes), `packages/shared/src/research-types.ts`

---

## 체크리스트 결과

| 항목 | 결과 |
|------|------|
| `start_interaction()` / `get_interaction()` / `stream_interaction()` API 패턴 (§13) | ✅ `get(stream=True)` wrapper 정합 |
| BYOK key는 activity 안에서만 resolve (workflow history 미노출) | ✅ `keys.py` + 각 activity 내부 |
| `KeyResolutionError` → `ApplicationError(non_retryable=True)` | ✅ create_plan, iterate_plan, execute_research 전부 |
| Temporal heartbeat (execute_research 장기 activity) | ✅ per-event + initial heartbeat |
| create_plan poll loop 무한루프 가능성 | ✅ Temporal `start_to_close_timeout=_PLAN_TIMEOUT(15m)` 상위 바운드 |
| finalize.py URL 경로 | ✅ `/api/internal/research/runs/{id}/finalize` 정확 |
| cost.py model ID = researchModelValues | ✅ `deep-research-preview-04-2026`, `deep-research-max-preview-04-2026` |
| workflow 신호 (user_feedback, approve_plan, cancel) | ✅ research.ts POST /turns → `handle.signal("user_feedback")` |
| approve/cancel 동시성 (`FOR UPDATE` 트랜잭션) | ✅ `lockRunForMutation` 패턴 |
| SSE stream 엔드포인트 (Phase D) | ✅ 2s 폴링 + abort flag + terminal 상태 close |
| `FEATURE_DEEP_RESEARCH` 기본값 | ⚠️ API측 기본 `false`, worker측 기본 `true` — 플래그 비대칭 존재 (기능적으로 안전, 설명 아래) |
| `execute_research._default_persist_event` URL 경로 | ❌ **S4-008** |
| `persist_report._production_fetch_image` URL 경로 | ❌ **S4-008** |
| `persist_report._production_post_internal("/internal/notes")` URL 경로 | ❌ **S4-008** |
| `/internal/research/{run_id}/artifacts` 엔드포인트 존재 | ❌ **S4-008** — 엔드포인트 없음 |

---

## 발견 (Findings)

### S4-008 [HIGH] Deep Research 3개 URL 경로 오류 + artifacts 쓰기 엔드포인트 미구현

**영향**: Phase C 완료 표기에도 불구, 실제 Deep Research 실행 시 notes 생성 실패 + 아티팩트 영구 유실.  
**기능 가용성**: `FEATURE_DEEP_RESEARCH`가 API 측에서 기본 `false`이므로 현재 production 미발화. 하지만 환경 변수 flip 직후 실패.

**구체적 버그 목록:**

#### A. `execute_research.py:164` — `/internal/research/{run_id}/artifacts` (이중 오류)

```python
await post_internal(
    f"/internal/research/{run_id}/artifacts",  # ← /api 접두사 누락 + 엔드포인트 없음
    {"kind": kind, "payload": payload},
)
```

- `API_BASE = "http://api:4000"` + path `/internal/research/...` → 실제 URL `http://api:4000/internal/research/...`
- 올바른 경로: `/api/internal/research/...` (app.ts: `app.route("/api/internal", internalRoutes)`)
- **더 심각**: `internal.ts`에 `/research/{run_id}/artifacts` POST 엔드포인트 자체가 없음. 코멘트 "Phase C ships this endpoint"가 있었으나 Phase C 구현 시 누락됨.
- 결과: `except Exception: pass`로 모든 실패 무음 처리 → `research_run_artifacts` 테이블 영구 빈 상태.

#### B. `persist_report.py:119` — `/internal/notes` (critical path)

```python
response = await post_internal(
    "/internal/notes",  # ← /api 접두사 누락
    {"idempotencyKey": inp.run_id, "projectId": ..., ...}
)
```

- 실제 URL `http://api:4000/internal/notes` → 404
- 올바른 경로: `/api/internal/notes` (내부 라우터 line 1323)
- 결과: `response.raise_for_status()` → `httpx.HTTPStatusError(404)` → `persist_deep_research_report` activity 실패 → Temporal 재시도 5회 → 최종 실패 → `finalize_deep_research(status="failed")` — 리포트 노트가 DB에 절대 저장되지 않음.

#### C. `persist_report.py:146` — `/internal/research/image-bytes` (복합 오류)

```python
body = await post_internal(
    "/internal/research/image-bytes", {"url": url}  # ← /api 접두사 누락
)
```

- 실제 URL `http://api:4000/internal/research/image-bytes` → 404
- 올바른 경로: `/api/internal/research/image-bytes`
- 추가: `except Exception: pass` 처리이나, artifact 테이블이 빈 상태(오류 A)이므로 수정해도 항상 404.

**수정 방향**:

1. `execute_research.py:164`: 경로를 `/api/internal/research/{run_id}/artifacts`로 수정 **+ `internal.ts`에 artifact-write 엔드포인트 구현** (`researchRunArtifacts`에 INSERT). `except Exception: pass` 유지 가능(스트리밍 아티팩트는 best-effort).
2. `persist_report.py:119`: `/internal/notes` → `/api/internal/notes`
3. `persist_report.py:146`: `/internal/research/image-bytes` → `/api/internal/research/image-bytes`
4. `internal.ts`에 `POST /research/:runId/artifacts` 구현:
   ```typescript
   internal.post("/research/:runId/artifacts", ...) // INSERT INTO research_run_artifacts
   ```

**참고**: `finalize.py:48`는 `/api/internal/research/runs/{id}/finalize`로 **올바르게** 작성되어 있음 — 같은 파일 패밀리에서 일관성 없음.

---

### S4-009 [LOW] `FEATURE_DEEP_RESEARCH` 기본값 비대칭

**파일**: `apps/api/src/routes/research.ts:40`, `apps/worker/src/worker/workflows/deep_research_workflow.py:122`

```typescript
// research.ts
(process.env.FEATURE_DEEP_RESEARCH ?? "false")  // API: 기본 false
```

```python
# deep_research_workflow.py
os.environ.get("FEATURE_DEEP_RESEARCH", "true")  # Worker: 기본 true
```

API는 기본 OFF, Worker는 기본 ON. `FEATURE_DEEP_RESEARCH` 없이 API에 접근하면 404, worker가 따로 실행되면 실행됨. 현재 설계가 API-gated이므로 기능적 위험은 낮으나:
- 환경 변수 미설정 self-hosted 인스턴스에서 직접 Temporal workflow trigger 시 worker가 동작함
- CLAUDE.md에서 "prod env flip 수동 필요"로 문서화됨 — 기본값 불일치가 flip 시 예상치 못한 동작 유발 가능

**수정**: `deep_research_workflow.py:122`를 `"false"`로 통일하거나 두 값을 모두 `"true"` (feature stable 선언 시).

---

## 주요 안전 확인 (확인됨 ✅)

- Interactions API 패턴 (§13/§13.1): `start_interaction(background=True)`, `get_interaction()` 폴링, `stream_interaction()` ✅
- BYOK key 노출 없음 — Temporal event history에 key 미노출 ✅
- `KeyResolutionError` → `ApplicationError(non_retryable=True)` fail-fast ✅
- Temporal heartbeat (execute_research 70분 timeout 내 per-event) ✅
- `finalize.py` URL `/api/internal/research/runs/{id}/finalize` ✅
- research_types.ts `researchModelValues` = cost.py `_BASE_USD` 키 일치 ✅
- `approve_plan` signal 트랜잭션 잠금 (`FOR UPDATE`) + 중복 approve 방지 ✅
- SSE stream: 클라이언트 disconnect `aborted` flag + 70min 최대 대기 ✅
- `_ABANDON_TIMEOUT = 24h` + workflow finalize(cancelled) 처리 ✅

---

## 다음 Iteration 영역

**Iteration 4**: Area 6 (Plan 11B DocEditorAgent)  
- `apps/worker/src/worker/agents/doc_editor/` 4 commands 검토
- `apps/api/src/routes/doc-editor.ts`
- `DocEditorWorkflow` + `run_doc_editor` activity (FEATURE_DOC_EDITOR_SLASH=false 미활성)
