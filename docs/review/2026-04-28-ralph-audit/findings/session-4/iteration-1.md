# Session 4 — Iteration 1 Findings

**영역**: Area 1 (runtime/ facade + ToolLoopExecutor) + Area 2 (packages/llm Gemini provider)  
**범위**: `apps/worker/src/runtime/`, `packages/llm/src/llm/`, `apps/worker/src/worker/agents/{compiler,research,librarian,synthesis}/`, `apps/worker/src/worker/maintenance_schedules.py`, `apps/worker/src/worker/temporal_main.py`

---

## 체크리스트 결과 (안티패턴 §2 + §4)

| 항목 | 결과 |
|------|------|
| `from openai import` / `from worker.gemini.client import` 없음 | ✅ |
| `GeminiClient(api_key=...)` 직접 생성 없음 | ✅ |
| `EMBED_MODEL` 하드코딩 없음 (env) | ✅ |
| `from langgraph` / `from langchain_core` import 없음 | ✅ |
| `make_thread_id` 사용 (agent 핸드오프 시) | ✅ 정의됨 — 현재 아키텍처(1workflow=1agent)에서 핸드오프 없으므로 미호출은 acceptable |
| 메시지 history 직접 mutate 없음 | ✅ |
| `messages: Annotated[list, operator.add]` 없음 → `keep_last_n(50)` | ✅ reducer 올바르게 구현 |
| HITL은 `AwaitingInput` 이벤트 + `AgentAwaitingInputError` | ✅ |
| Hook은 `HookRegistry.register(hook, scope, agent_filter)` 패턴 | ✅ |
| Temporal Activity 안에서 LLM 직접 호출 없음 | ✅ runtime.Agent 경유 |
| `automatic_function_calling` disable=True 명시 | ✅ gemini.py:477 |
| 모든 parts 이터레이션 (`function_call` vs `text`) | ✅ gemini.py:512-525 |
| `function_response.id = function_call.id` | ✅ gemini.py:563 |
| `thoughtSignature` 다음 턴 포함 | ✅ 전체 `assistant_content` opaque하게 `assistant_message`에 저장, 루프가 그대로 재주입 |
| Gemini 모델 ID 정확 (§2 표) | ✅ `gemini-3.1-pro-preview`, `gemini-3-flash-preview`, `gemini-embedding-001` |
| `output_dimensionality` → `VECTOR_DIM` env forward | ✅ gemini.py:129 |
| Ollama tool calling fail fast (silent fallback 없음) | ✅ ollama.py:105-117 |
| `embed_many()` 사용 (N회 individual 호출 대신) | ✅ compiler/agent.py:198 |
| Interactions `get(stream=True)` 사용 (`.stream()` 없음) | ✅ gemini.py:657 |
| SDK 타입 `packages/llm` 경계 밖으로 누출 없음 | ✅ model_dump() at boundary |

---

## 발견 (Findings)

### S4-001 [HIGH] `_inject_loop_warning` — 동일 tool_use_id로 두 FunctionResponse 생성

**파일**: `apps/worker/src/runtime/tool_loop.py:296-320` + `tool_loop.py:198-209`

**증상**: 소프트 루프 경고(`loop_detection_threshold=3` 이후 3~4번째 반복)가 트리거될 때, `_inject_loop_warning`이 `tool_use_id=tool_use.id`로 경고 FunctionResponse를 `state.messages`에 추가한다. 직후 `_execute_tool(tu)` 가 실제로 실행되고, 동일한 `tool_use_id`로 두 번째 FunctionResponse가 추가된다.

Gemini 3은 각 `function_call.id`마다 정확히 하나의 `function_response`를 기대한다(§12 antipattern). 동일 ID의 `FunctionResponse` 두 개가 연속 메시지로 들어오면 다음 중 하나가 발생한다:
- SDK APIError (409/422)
- 첫 번째(경고)를 무시하고 두 번째(실제 결과)만 참조 → 경고 효과 없음
- 루프 메모리 오염 → subsequent turns에서 컨텍스트 손상

**재현 조건**: 하나의 ToolLoopExecutor 실행에서 동일 `(tool_name, args_hash)` 조합이 3회 이상 연속 호출될 때. 기본값 `loop_detection_threshold=3`이면 3번째 호출부터 발생.

**수정 방향**:
- Option A: `_inject_loop_warning` 이후 `return "loop_warning"` — 실제 도구 실행을 건너뜀
- Option B: 경고 메시지를 `FunctionResponse`가 아닌 별도 user-role 텍스트 메시지로 주입
- Option C: 경고에 `tool_use_id = f"_warn_{tool_use.id}_{repeat}"` 같이 synthetic prefix 부여

현재 테스트(`test_tool_loop_soft_guards.py`)가 hard stop 경로만 검증하고, 경고 + 실제 실행이 동시에 발생하는 경로를 테스트하지 않아 숨겨진 버그.

---

### S4-002 [MEDIUM] 워커 기동 후 생성된 프로젝트에 maintenance schedule 미설치

**파일**: `apps/worker/src/worker/temporal_main.py:263-268`, `apps/worker/src/worker/maintenance_schedules.py:137-148`

**증상**: `ensure_project_maintenance_schedules`는 worker 시작 시 1회 호출되어 **그 시점에 존재하는** 프로젝트에만 Librarian/Curator/Staleness 스케줄을 설치한다. 워커 실행 중 생성된 프로젝트는 다음 워커 재시작 전까지 자동 유지보수 스케줄을 갖지 못한다.

**현재 영향**: 장기간 무중단 운영하는 self-hosted 인스턴스에서 신규 프로젝트가 영구적으로 스케줄 없이 방치될 수 있음.

**수정 방향**: 프로젝트 생성 API(`POST /api/workspaces/:wid/projects`) 성공 후 worker에 Temporal signal을 보내거나, `POST /api/internal/maintenance-schedule/upsert` 내부 라우트를 추가해 `ensure_project_maintenance_schedules`를 project별로 트리거.

참고: Connector와 Narrator는 설계상 per-concept/per-note 사용자 트리거 — 스케줄 불필요. 현 미설치는 이 두 에이전트가 아닌 Librarian/Curator/Staleness에 해당.

---

### S4-003 [MEDIUM] `provider.generate()` 토큰 수 미추적 — 비용 및 예산 정책 무력화

**파일**: `packages/llm/src/llm/base.py:57` (반환 타입 `str`), `apps/worker/src/worker/agents/compiler/agent.py:332-349`, `research/agent.py:228-244`, `synthesis/agent.py:206-222`, `doc_editor/agent.py:129-147` 및 기타 6개 이상 에이전트

**증상**: `LLMProvider.generate()`가 `str`만 반환. 모든 `ModelEnd` 이벤트가 `prompt_tokens=0, completion_tokens=0`으로 발행됨. 결과:

1. **비용 추적 비활성**: `ModelEnd.cost_krw=0` → SSE cost 스트림(Plan 11A) 무의미  
2. **토큰 예산 정책 미동작**: `LoopConfig.max_total_input_tokens`는 `generate_with_tools`에서만 집계되며, `generate()` 경로는 미집계  
3. **Spec B AI Usage Visibility** 전체 차단  

코드 주석에 "Plan 12 follow-up" 언급이 있으나 활성 plan이 없음. Compiler/Research/Synthesis/Librarian 등 10개+ 에이전트의 실제 LLM 비용이 DB에 기록되지 않음.

**수정 방향**: `generate()`를 `GenerateResult(text: str, usage: UsageCounts)` 반환으로 변경하거나, `generate_with_tools` 스타일의 `generate_tracked()` 오버로드 추가. 또는 Gemini SDK `response.usage_metadata`에서 토큰 수를 직접 읽어 ModelEnd 이벤트를 실제 값으로 채울 것.

---

### S4-004 [LOW] `_SeqCounter` 6개+ 에이전트 파일에 중복 정의

**파일**: `compiler/agent.py:537-545`, `research/agent.py:485-494`, `synthesis/agent.py:320-329`, `narrator/agent.py`, `connector/agent.py:43-51`, `doc_editor/agent.py:59-67`, `librarian/agent.py` 등

동일한 `_SeqCounter` 클래스(단조 증가 카운터)가 7개 이상 파일에 복사되어 있다. 유지보수 부채. `runtime.tools` 또는 새 `worker.lib._seq` 모듈에 한 번만 정의해야 한다.

---

### S4-005 [LOW] `cache_context` 4096 토큰 최소값 미검증

**파일**: `packages/llm/src/llm/gemini.py:139-152`

Gemini context caching API는 최소 4096 토큰을 요구하나 `cache_context`에 입력 길이 검증 없음. 현재는 tests에서만 호출되고 worker 코드에서는 미사용. Research/Librarian 에이전트가 cache TTL 경로를 추가할 때 짧은 시스템 프롬프트로 즉시 SDK error 발생 가능성.

**수정**: `if len(content) < 4096*4: raise ValueError(f"cache_context requires ≥ 4096 tokens (approx ≥ 16384 chars), got {len(content)}")` 또는 token 추정 후 guard.

---

## 주요 안전 확인 (확인됨 ✅)

- LangGraph/LangChain import 0건 (`check_import_boundaries.py` 통과 상태)
- Plan 8 Curator/Staleness cron: `maintenance_schedules.py`에 설치됨 (startup-time). 2026-04-28 audit 지적 사항 **부분 해소**.
- Plan 8 Connector/Narrator: per-concept/per-note 사용자 트리거 설계 — cron 불필요 ✅
- `FEATURE_DOC_EDITOR_SLASH=false` 기본값 → Plan 11B Phase A 미머지 상태와 일치 ✅
- Deep Research `FEATURE_MANAGED_DEEP_RESEARCH=false` 기본값 → prod env flip 수동 필요 확인됨 ✅
- OllamaProvider tool calling `ToolCallingNotSupported` fail-fast ✅

---

## 다음 Iteration 영역

**Iteration 2**: Area 3+4  
- Compiler/Research/Librarian workflow + 활동 레이어 (compiler_activity.py, research_activity.py 등) 상세 검토  
- Plan 8 5 agents (Curator/Connector/Staleness/Narrator) — 수동 트리거 경로 확인, 결과 저장 경로  
- `run_connector_activity` 이름 불일치 검토 (`"run_connector"` vs 함수명)
