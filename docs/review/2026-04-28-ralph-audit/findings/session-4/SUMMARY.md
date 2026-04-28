# Session 4 — Ralph Audit SUMMARY

**마지막 갱신**: Iteration 5 완료  
**커버된 영역**: Area 1 (runtime/), Area 2 (packages/llm/), Area 3 (Compiler/Research/Librarian), Area 4 (Plan 8 agents), Area 5 (Deep Research Phase A~E), Area 6 (Plan 11B DocEditorAgent), Area 7+8 (Code Agent + Visualization Agent)

---

## 발견 현황

| ID | 심각도 | 제목 | 상태 | 파일 |
|----|--------|------|------|------|
| S4-001 | **HIGH** | `_inject_loop_warning` 동일 tool_use_id로 두 FunctionResponse 생성 | 미수정 | `runtime/tool_loop.py:308-320` |
| S4-002 | MEDIUM | 워커 기동 후 생성된 프로젝트에 maintenance schedule 미설치 | 미수정 | `worker/temporal_main.py:263` |
| S4-003 | MEDIUM | `provider.generate()` 토큰 미추적 — 비용/예산 정책 무력화 | 미수정 (설계 한계) | `llm/base.py:57` + 10개+ 에이전트 |
| S4-004 | LOW | `_SeqCounter` 7개+ 에이전트에 중복 정의 | 미수정 | 여러 agents/*.py |
| S4-005 | LOW | `cache_context` 4096 토큰 최소값 미검증 | 미수정 | `llm/gemini.py:139` |
| S4-006 | MEDIUM | `HookRegistry` 생성 후 미사용 — 7개 활동에 dead code | 미수정 | `{compiler,research,librarian,curator,staleness,narrator,synthesis}_activity.py` |
| S4-007 | LOW | `DocEditorActivity` 궤적 훅 없음 + 오해를 주는 주석 | 미수정 | `doc_editor_activity.py:31-36` |
| S4-008 | **HIGH** | Deep Research 3개 URL 경로 오류(`/internal/` → `/api/internal/`) + artifacts 쓰기 엔드포인트 미구현 | 미수정 | `execute_research.py:164`, `persist_report.py:119,146` |
| S4-009 | LOW | `FEATURE_DEEP_RESEARCH` 기본값 비대칭 (API=false vs Worker=true) | 미수정 | `research.ts:40`, `deep_research_workflow.py:122` |
| S4-010 | LOW | `doc-editor.ts` Note 조회 `isNull(deletedAt)` 필터 누락 | 미수정 | `doc-editor.ts:64-67` |
| S4-011 | **HIGH** | `CodeAgentWorkflow` `wait_condition` 타임아웃 경로 오작동 — `AssertionError` 발생 | 미수정 | `code_workflow.py:97-110` |
| S4-012 | LOW | `visualize.ts` per-user 동시성 lock 단일 인스턴스 한계 (known caveat) | 미수정 | `visualize.ts:72-79` |
| S4-013 | LOW | `code.ts` Note 조회 `isNull(deletedAt)` 필터 누락 (S4-010 패턴 동일) | 미수정 | `code.ts:82-93` |

**Critical: 0 / High: 3 / Medium: 3 / Low: 7**

---

## 반복 현황

| Iteration | 영역 | Critical | High | Medium | Low |
|-----------|------|----------|------|--------|-----|
| 1 (완료) | Area 1+2 (runtime + llm provider) | 0 | 1 | 2 | 2 |
| 2 (완료) | Area 3+4 (Compiler/Research/Librarian + Plan 8 agents) | 0 | 0 | 1 | 1 |
| 3 (완료) | Area 5 (Deep Research Phase A~E) | 0 | 1 | 0 | 1 |
| 4 (완료) | Area 6 (Plan 11B DocEditorAgent) | 0 | 0 | 0 | 1 |
| 5 (완료) | Area 7+8 (Code Agent + Visualization Agent) | 0 | 1 | 0 | 2 |
| 6 (예정) | Area 9+10 (MCP Client spec + Ollama stub) | - | - | - | - |

---

## 종료 조건 추적

Critical/High 0건 × 연속 2 iteration → 종료. Iteration 5에서 S4-011 (HIGH) 신규 발견 → clean 연속 카운터 리셋. → **계속**.
