# Session 4 — Iteration 5 Findings

**영역**: Area 7+8 (Code Agent + Visualization Agent)  
**범위**: `apps/worker/src/worker/agents/code/`, `apps/worker/src/worker/activities/code_activity.py`, `apps/worker/src/worker/workflows/code_workflow.py`, `apps/api/src/routes/code.ts`, `apps/worker/src/worker/agents/visualization/`, `apps/worker/src/worker/activities/visualize_activity.py`, `apps/worker/src/worker/workflows/visualize_workflow.py`, `apps/api/src/routes/visualize.ts`

---

## 체크리스트 결과

### Code Agent

| 항목 | 결과 |
|------|------|
| `FEATURE_CODE_AGENT=false` 기본값 | ✅ `code.ts:38` |
| `CodeAgentWorkflow` 신호 (client_feedback / cancel) | ✅ |
| `generate_code_activity` / `analyze_feedback_activity` heartbeat | ✅ 시작·완료 양쪽 heartbeat |
| 상태 플립 — `set_run_status` try/except best-effort | ✅ 실패 시 `status="failed"` 후 raise |
| `_EmitStructuredOutputTool.run()` 미실행 보장 | ✅ `RuntimeError` |
| 피드백 signal 터미널 상태 이후 무시 (`code.ts:285`) | ✅ `TERMINAL_STATUS_SET.has(run.status)` → 409 |
| SSE keepalive (`code.ts:171`) | ✅ `: keepalive\n\n` comment-frame |
| `wait_condition` 타임아웃 처리 패턴 | ❌ **S4-011** |
| Note 소프트삭제 필터 | ❌ **S4-013** |

### Visualization Agent

| 항목 | 결과 |
|------|------|
| `VisualizationFailed` → `ApplicationError(non_retryable=True)` | ✅ |
| `HeartbeatLoopHooks` — 전체 이벤트 누적 재전송 (lossy 방지) | ✅ variadic `activity.heartbeat(*self._events)` |
| `VisualizeWorkflow` heartbeat_timeout=30s (활동 타임아웃 지원) | ✅ |
| `build_view` `VisualizationFailed` non-retryable ApplicationError | ✅ |
| per-user 동시성 lock | ⚠️ **S4-012** — in-memory, 단일 인스턴스 한계 |

---

## 발견 (Findings)

### S4-011 [HIGH] `CodeAgentWorkflow` — `wait_condition` 타임아웃 경로 오작동

**파일**: `apps/worker/src/worker/workflows/code_workflow.py:97-102, 110`

```python
# code_workflow.py (잘못된 패턴)
try:
    await workflow.wait_condition(
        lambda: self._feedback is not None or self._cancelled,
        timeout=IDLE_ABANDON,
    )
except asyncio.TimeoutError:              # ← 절대 발생하지 않음
    return CodeRunResult(status="abandoned", history=history)

# ↓ 타임아웃 시 여기 도달
if self._cancelled:
    ...
fb = self._feedback            # None (타임아웃 시 신호 없음)
self._feedback = None
assert fb is not None          # ← AssertionError 발생!
```

**근거**: `temporalio>=1.8.0`에서 `workflow.wait_condition(fn, timeout=X)`는 타임아웃 시 `asyncio.TimeoutError`를 raise하지 않고 **`False`를 반환**한다. 동일 코드베이스의 `deep_research_workflow.py:151-157`가 정확한 패턴을 사용:

```python
# deep_research_workflow.py (올바른 패턴)
reached = await workflow.wait_condition(
    lambda: ...,
    timeout=_ABANDON_TIMEOUT,
)
if not reached:
    # 타임아웃 처리
```

**영향 시나리오**: 사용자가 Code Agent 실행 후 30분간 피드백을 보내지 않으면 (`IDLE_ABANDON = timedelta(minutes=30)`):

1. `wait_condition` → `False` 반환 (예외 없음)
2. `except asyncio.TimeoutError:` — **실행되지 않음**
3. `assert fb is not None` → `AssertionError`
4. 워크플로 실패 (`status = "failed"` Temporal 내부)
5. `code_runs.status`는 `"awaiting_feedback"` 영구 고착 (activity가 `"abandoned"`로 업데이트하는 경로 없음)
6. SSE 클라이언트는 터미널 상태를 받지 못하고 `MAX_TICKS` (65분) 후 강제 종료

**`FEATURE_CODE_AGENT=false`** 기본값으로 현재 production 미발화. 플래그 flip 즉시 재현 가능.

**수정**:
```python
# for _ in range(MAX_FIX_TURNS): 루프 안
reached = await workflow.wait_condition(
    lambda: self._feedback is not None or self._cancelled,
    timeout=IDLE_ABANDON,
)
if not reached:
    return CodeRunResult(status="abandoned", history=history)
```

---

### S4-012 [LOW] `visualize.ts` — per-user 동시성 lock 단일 인스턴스 한계

**파일**: `apps/api/src/routes/visualize.ts:72-79` + `apps/api/src/lib/visualize-lock.ts` (추정)

in-memory `Set<userId>` 기반 동시성 lock. 코드 자체 주석: "Multi-instance prod deployment must swap this for a shared store before flag flip." **그러나 feature flag 없이 live 상태** (visualize.ts에 `FEATURE_KNOWLEDGE_GRAPH` 등 gate 없음). 다중 인스턴스 API 배포 시 동일 사용자의 병렬 시각화 요청이 429로 차단되지 않음.

**영향**: Docker self-hosted 단일 인스턴스에서는 무해. 수평 확장 배포 시 동시 LLM 비용 배가. `FEATURE_CODE_AGENT`처럼 flag gate가 없어 알림 없이 확장 배포 시 무력화.

**참고**: `rate-limit.ts`도 동일 인메모리 패턴 — 알려진 아키텍처 한계.

---

### S4-013 [LOW] `code.ts` — Note 조회 `isNull(deletedAt)` 필터 누락

**파일**: `apps/api/src/routes/code.ts:82-93`

```typescript
const [note] = await db
  .select({ ... })
  .from(notes)
  .where(eq(notes.id, body.noteId));  // ← isNull(notes.deletedAt) 누락
```

S4-010 (`doc-editor.ts`) 동일 패턴. 소프트삭제 노트에 Code Agent 실행 가능.  
`FEATURE_CODE_AGENT=false` 기본값으로 현재 잠재적 상태. S4-010 수정 시 동시 적용 권장.

---

## 주요 안전 확인 (확인됨 ✅)

- `FEATURE_CODE_AGENT=false` 기본값 — bug들이 현재 미발화 ✅
- `generate_code_activity` / `analyze_feedback_activity` 양쪽 heartbeat (start + done) ✅
- 상태 플립 best-effort (`except Exception: pass`) — 워크플로가 최종 reconcile ✅
- 터미널 상태 이후 피드백 signal → 409 (`alreadyTerminal`) ✅
- SSE keepalive comment-frame (nginx/Cloudflare timeout 방지) ✅
- `CodeAgent` `generate_with_tools(mode="any")` — tool use 강제 ✅
- `_EmitStructuredOutputTool` 비실행 sentinel — agent reads args directly ✅
- `VisualizationFailed` → `ApplicationError(non_retryable=True)` ✅
- `HeartbeatLoopHooks` 전체 이벤트 누적 — poll interval 내 lossy overwrite 방지 ✅
- `VisualizeWorkflow` heartbeat_timeout=30s 설정 ✅

---

## 다음 Iteration 영역

**Iteration 6**: Area 9+10 (MCP Client spec + Ollama stub)  
- `packages/llm/` Ollama provider stub 검토
- MCP Client spec 문서 검토 (구현 미시작 확인)
- `apps/worker/src/worker/agents/tool_demo/` 검토
