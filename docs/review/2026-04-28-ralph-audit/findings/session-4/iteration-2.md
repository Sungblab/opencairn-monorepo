# Session 4 — Iteration 2 Findings

**영역**: Area 3 (Compiler/Research/Librarian — 워크플로 + 활동 레이어) + Area 4 (Plan 8 5 agents)  
**범위**: `apps/worker/src/worker/activities/{compiler,research,librarian,curator,staleness,narrator,synthesis,connector,doc_editor}_activity.py`, `apps/worker/src/worker/agents/{curator,connector,narrator,synthesis,temporal_agent}/`, `apps/worker/src/worker/workflows/{compiler,research,connector}_workflow.py`, `apps/api/src/routes/{synthesis,curator,connector,narrator,staleness,plan8-agents}.ts`

---

## 체크리스트 결과

| 항목 | 결과 |
|------|------|
| Compiler/Research/Librarian workflow 세마포어 acquire/release finally 패턴 | ✅ 세 workflows 모두 올바름 |
| `"run_connector"` 활동명 불일치 검토 (`temporal_main.py` alias vs decorator) | ✅ `@activity.defn(name="run_connector")` 일치, alias는 로컬 네임스페이스 충돌 회피용 |
| Plan 8 수동 트리거 API 경로 존재 | ✅ 5개 전부 (`/run`, `/run`, `/run`, `/run`, `/stale-check`) |
| Plan 8 결과 저장 경로 | ✅ Synthesis→notes, Curator/Connector→suggestions, Staleness→stale_alerts, Narrator→audio_files+MinIO |
| `tts()` Ollama graceful degrade | ✅ `LLMProvider.tts()` 기본 `return None`, NarratorAgent `if audio_bytes:` 처리 |
| Plan 8 cron: Curator/Staleness scheduled | ✅ `maintenance_schedules.py`에 daily 등록 (S4-002 부분 해소 확인) |
| Connector/Narrator cron 불필요 (per-trigger 설계) | ✅ 설계 정합 |
| `_SeqCounter` 중복 (Iteration 1 S4-004 재확인) | ⚠️ curator/connector/narrator 모두 동일 클래스 복사 — 기존 S4-004 확인 |
| LangGraph/LangChain import 없음 | ✅ |
| `automatic_function_calling` disable (Compiler/Research 도구 사용 경로) | ✅ gemini.py:477 |

---

## 발견 (Findings)

### S4-006 [MEDIUM] `HookRegistry` 생성 후 미사용 — 7개 활동에 dead code

**파일**: `compiler_activity.py:90-96`, `research_activity.py` (동일 패턴), `librarian_activity.py:68-74`, `curator_activity.py:76-82`, `staleness_activity.py:73-79`, `narrator_activity.py:76-82`, `synthesis_activity.py:76-82`

**증상**: 모든 표준 활동 파일이 동일 패턴을 반복한다:

```python
registry = HookRegistry()
registry.register(traj_hook, scope="global")
registry.register(token_hook, scope="global")

async def _emit(ev: AgentEvent) -> None:
    await traj_hook.on_event(ctx, ev)   # 직접 호출
    await token_hook.on_event(ctx, ev)  # 직접 호출
```

`registry` 객체는 hooks를 등록한 뒤 **다시 참조되지 않는다**. `_emit` 클로저는 레지스트리를 완전히 우회해 `traj_hook`/`token_hook`을 직접 호출한다. 결과:

1. **HookRegistry가 dead code**: 레지스트리에 등록된 Hook은 실제로 실행되지 않는다.
2. **확장 불가**: 외부 코드가 `registry.register(SentryHook(), scope="global")` 해도 해당 hook은 절대 호출되지 않는다.
3. **`connector_activity.py`는 HookRegistry를 아예 미임포트** — 8개 활동 중 7개는 dead-registry, 1개는 없음. 일관성 없음.

**참고**: `doc_editor_activity.py`는 `_noop_emit` 사용 — 의도적 생략이나 코멘트 오류(S4-007).

**수정 방향**:
- Option A: `_emit`을 `registry.dispatch(ctx, ev)`로 대체 (`HookRegistry.dispatch` 메서드 추가).
- Option B: `registry` 객체 제거. 대신 `HookChain([traj_hook, token_hook])` 직접 생성하고 `emit = chain.on_event` 할당.
- Option C: 현재 패턴 유지, `registry` 변수 제거 (dead code만 정리).

어느 옵션이든 `connector_activity.py`에 누락된 `TrajectoryWriterHook` + `TokenCounterHook` 추가 필요.

---

### S4-007 [LOW] `DocEditorActivity` — 궤적 훅 없음 + 오해를 주는 주석

**파일**: `apps/worker/src/worker/activities/doc_editor_activity.py:31-36`

**증상**:

```python
async def _noop_emit(_event: AgentEvent) -> None:
    """In-process activities don't subscribe to per-event hooks here; the
    AgentEnd payload is captured by the caller. Trajectory writers run via
    the runtime hook chain, not via emit."""
    return None
```

주석이 "Trajectory writers run via the runtime hook chain"이라 주장하지만 활동 코드 어디에도 `HookRegistry`, `TrajectoryWriterHook`, `TokenCounterHook`이 없다. `FEATURE_DOC_EDITOR_SLASH=false` 기본값으로 아직 prod에서 미활성화 상태이나, 활성화 시:

1. DocEditorAgent 실행이 NDJSON 궤적 파일로 저장되지 않는다.
2. 토큰 카운트가 집계되지 않는다 (S4-003과 동일 gap).
3. 주석이 허위 보안 (false safety) 제공: 개발자가 훅이 "어딘가에서" 실행된다고 믿을 수 있다.

**수정**: `_noop_emit` 대신 다른 활동과 동일한 `TrajectoryWriterHook` + `TokenCounterHook` 체인 + 올바른 `_emit` 패턴 적용. 주석 제거.

---

## 주요 안전 확인 (확인됨 ✅)

- Plan 8 전원 트리거 경로 존재: `POST /api/synthesis/run`, `/api/curator/run`, `/api/connector/run`, `/api/narrator/run`, `/api/agents/temporal/stale-check`
- Plan 8 결과 저장 경로 정합: Synthesis→notes 신규 생성, Curator/Connector→suggestions 테이블, Staleness→stale_alerts 테이블, Narrator→audio_files + MinIO
- `tts()` 기본 `return None` → Narrator graceful degrade on Ollama ✅
- CompilerWorkflow/ResearchWorkflow/ConnectorWorkflow 세마포어 finally 패턴 ✅
- `run_connector` 활동명 (decorator) = workflow execute 호출 이름 ✅
- Curator/Staleness daily cron schedule 설치됨 (maintenance_schedules.py 3:30am, 4am) ✅
- Connector/Narrator per-trigger 설계 — cron 불필요 ✅

---

## 다음 Iteration 영역

**Iteration 3**: Area 5 (Deep Research Phase A~E)  
- `apps/worker/src/worker/activities/deep_research/` 5개 활동 (create_plan, iterate_plan, execute_research, persist_report, finalize)
- `apps/worker/src/worker/workflows/deep_research_workflow.py` (이미 Iteration 1에서 확인됨, 상세 재검토)
- Interactions API 패턴 검증 (Phase A 핵심 antipattern §13 + §13.1)
- billing_path "byok"/"managed" 경로 분기
- Phase C~E (API 라우트, SSE, BYOK UI) 미검토 영역
