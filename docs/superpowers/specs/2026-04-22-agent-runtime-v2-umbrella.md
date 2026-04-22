# Agent Runtime v2 — Umbrella

**Status:** Draft (2026-04-22)
**Owner:** Sungbin
**Type:** Umbrella (지도 역할, 구현 spec 아님)

---

## 0. 배경 & 문제

OpenCairn은 Plan 12에서 `runtime.Agent` facade 완성, Plan 4에서 Compiler/Research/Librarian 3 에이전트 구현. 그러나 감사 결과 **실제 tool-calling 루프가 부재**:

- `LLMProvider.generate()`는 `response.text`만 반환, `function_call` 파트는 전량 버림 (`packages/llm/src/llm/gemini.py:101`)
- 3 에이전트 모두 `@tool` 사용 0건, `runtime.Agent` 상속만 하고 수동 LLM 호출 + 정규식 파싱
- `build_tool_declarations()`는 선언만 있고 호출처 없는 dead code
- Gemini SDK의 automatic function calling, parallel/compositional calling, thought signatures, MCP 통합 등 **강력한 기본기를 전부 포기**한 상태

"에이전트"라 이름 붙었지만 실제로는 LLM 오케스트레이터. 이 상태로는 "tool 사용이 중요한 서비스"라는 제품 포지션이 성립하지 않음.

## 1. 목표

Provider-agnostic, 관측 가능, Temporal-native한 agentic tool-calling 런타임을 **작은 서브프로젝트 조각으로** 점진 구축. 한 번에 mega-spec으로 설계하면 분해가 늦어지고 중간 구현 방향이 어긋남.

## 2. 설계 레퍼런스

- **Claude Code (Anthropic CLI) 리버스 엔지니어링** — Tool interface + builder with safe defaults, streaming tool execution with concurrency partition, multi-level compaction with protected tail, permission rules + hooks + classifier, subagent fork with prompt cache sharing
- **Gemini API 공식 문서** (`references/Gemini_API_docs/`) — Function calling 4단계 표준, parallel/compositional, thought signatures (Gemini 3 mandatory), MCP 내장 지원, structured output + function calling, tool combination
- **기존 OpenCairn spec**:
  - `2026-04-20-agent-chat-scope-design.md` — scope/memory/RAG mode (G sub-project가 이 위에 쌓임)
  - `2026-04-22-model-router-design.md` — auto 모델 라우팅 (G와 분리되지만 인접)
  - `2026-04-22-agent-humanizer-design.md` — 스트리밍 UX (F가 통합)
  - `2026-04-22-deep-research-integration-design.md` — 긴 에이전트 런 (별도 후속)

## 3. 불변 제약 (모든 sub-project 공통)

이 제약은 각 sub-spec의 "§Non-negotiable Constraints" 섹션에서 이 문서를 앵커 참조.

1. **Provider는 env-only** — `LLM_PROVIDER` 환경변수로만 선택. UI·온보딩 노출 금지 (`feedback_llm_provider_env_only` 메모리)
2. **BYOK/PAYG 선제 차단 금지** — `max_cost_usd` 기본 None. 관리형 모드만 예치금 연동 차단 허용 (`feedback_byok_cost_philosophy`)
3. **Workspace isolation** — `workspace_id`는 runtime이 강제 주입, LLM 조작 불가
4. **`generate()` API 불변** — 기존 호출자 영향 0. 신규는 신규 메서드로만
5. **Temporal determinism** — tool 호출은 activity 안에서만
6. **Gemini SDK capability guard** — 미출시 기능 의존 금지, provider가 `supports_*()` 선언
7. **Tool 정의 서버 전용** — description/schema는 클라이언트 미노출

## 4. Sub-project 지도

| ID | 이름 | 목적 | 의존 | 상태 | Spec |
|----|------|------|------|------|------|
| **A** | Core Tool-Use Loop | Provider `generate_with_tools` + `ToolLoopExecutor` + 6 tool family + `ToolDemoAgent` | 없음 | 📘 planned | `2026-04-22-agent-runtime-v2a-core-tool-loop-design.md` |
| **B** | Agent Retrofit | Compiler/Research/Librarian을 tool-based로 재작성. `emit_structured_output` 채택. concept relations 테이블 추가 → `get_concept_graph` 완성 | A | ⏳ queued | TBD |
| **C** | Advanced Loop | Parallel tool execution, streaming tool execution, multi-level compaction (snip/microcompact/autocompact with protected tail), Gemini 3 thought signature 수동 관리 | A | ⏳ queued | TBD |
| **D** | MCP Integration | stdio/http MCP client, MCP tool → `runtime.Tool` wrapper. Gemini Python SDK의 `tools=[session]` 경로 활용. 메모리의 "MCP client 별도 spec" 흡수 | A | ⏳ queued | TBD |
| **E** | Safety & Eval | Permission rules (allow/deny patterns), telemetry hooks 실구현, AI Usage Visibility 연동, `ExpectedToolCall` eval framework 활성화, cost tracking | A | ⏳ queued | TBD |
| **F** | Streaming UI Integration | apps/web에 tool_use/tool_result 스트리밍 렌더, humanizer + router 연동, progress indicator | A + 2D 에디터 | ⏳ queued | TBD |
| **G** | Chat Mode Router | ChatMode enum (PLAIN / REFERENCE / EXTERNAL_AGENT / FULL_AGENT), entry point별 default + 사용자 override, ChatMode → tool_names 매핑. `agent-chat-scope-design.md` 위에서 실행. model-router와 분리 | A, B (공존) | 📝 added 2026-04-22 | TBD |

실행 순서 권장: **A → B → (C, D, G 병렬 가능) → E → F**.

## 5. 문서 업데이트 backlog

A 완료 후 누적으로 업데이트할 대상:

- `docs/architecture/api-contract.md` — agent activity signature에 tool loop 경로 추가
- `docs/architecture/context-budget.md` — `search_pages`/`search_concepts` 경로별 토큰 예산
- `docs/contributing/llm-antipatterns.md` — **Gemini tool calling 관련 §신규**:
  - `response.text`만 읽고 function_call 파트 버림
  - `automatic_function_calling` 기본 활성 — runtime 루프 구현 시 반드시 `disable=True`
  - `function_call.id` 누락 시 Gemini 3 context 매핑 깨짐
  - messages의 part 단위 split 금지 (thought_signature 손실)
  - Ollama tool calling은 현재 미지원 — 체크 후 명시적 실패
- Umbrella 본 문서의 Sub-project 상태 컬럼 (A 구현 완료 시 `✅ done`)

## 6. 비-목표 (이 Umbrella가 다루지 않는 것)

- 구체적 구현 지시 — 각 sub-spec이 담당
- 테스트 시나리오 상세 — 각 sub-spec
- 마이그레이션 단계 — 각 sub-spec
- 시간 추정 — plan 단계에서 결정
- 개별 Tool 스키마 — Sub-A spec이 정의, B에서 추가될 가능성

## 7. Umbrella 유지보수 규칙

- 각 sub-project 완료 시 `Status` 컬럼 갱신, 해당 spec 파일명 기입
- 새 sub-project 추가 시 ID는 알파벳 연속 (H, I, ...). 삽입 금지
- **제약 섹션 (§3)은 append-only**. 제약 완화는 별도 decision record로 논의 후
- Spec 자체는 짧게 유지 (300줄 이하). 상세는 sub-spec에

---
