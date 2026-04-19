# LLM Antipatterns (OpenCairn 전용)

> Claude Code가 이 리포에서 반복한 실수 기록. 수정 시 항상 먼저 확인.

---

## 1. Schema

- ❌ `projects.user_id` 참조 → ✅ `projects.workspace_id` (Workspace 3계층, 2026-04-18)
- ❌ `pgvector(3072)` 하드코드 → ✅ `VECTOR_DIM` env 기반 customType (Plan 1 확정)
- ❌ `users.plan` enum으로 Pro/BYOK 체크 → ✅ `subscriptions` 테이블 + `credit_balances` (Plan 9 PAYG)
- ❌ `conversations.project_id` NOT NULL → ✅ nullable (Page/Workspace scope 고려, Plan 11A)

Provider별 VECTOR_DIM 기본값: Gemini=3072, Ollama(nomic)=768. OpenAI는 제거됨.

---

## 2. LLM Provider

- ❌ `from openai import ...` / `from worker.gemini.client import GeminiClient` → ✅ `from llm import get_provider` (packages/llm, Gemini + Ollama만, 2026-04-15)
- ❌ `GeminiClient(api_key=...)` 직접 생성 → ✅ `get_provider()` 팩토리
- ❌ `EMBED_MODEL = "gemini-embedding-2-preview"` 하드코딩 → ✅ `os.environ["EMBED_MODEL"]`
- ❌ Gemini function call 응답에서 `thoughtSignature` 버리기 → ✅ 다음 턴 history에 반드시 포함
- ❌ Gemini context cache 1000 토큰 시도 → ✅ 최소 4096 토큰 (Gemini spec)

### Gemini 모델 ID

| 틀린 것 | 올바른 것 |
|--------|---------|
| `gemini-2.0-flash` / `gemini-3.0-flash` | `gemini-3-flash-preview` |
| `gemini-1.5-pro` | `gemini-3.1-pro-preview` |
| `text-embedding-004` | `gemini-embedding-2-preview` |
| `gemini-2.5-flash-tts` | `gemini-2.5-flash-preview-tts` |
| `gemini-2.5-flash-live` | `gemini-3.1-flash-live-preview` |

**Gemini API 문서는 항상 로컬 참조**: `references/Gemini_API_docs/`. 학습 데이터 의존 금지 — 모델명/메서드명이 자주 바뀜.

---

## 3. Sandbox

- ❌ `apps/sandbox/` 참조 → ✅ 폐기됨. 브라우저 Pyodide + iframe (ADR-006, 2026-04-14)
- ❌ `<iframe sandbox="allow-scripts allow-same-origin">` → ✅ `allow-scripts`만 (same-origin 절대 금지)
- ❌ `postMessage(data, '*')` → ✅ 명시적 origin 검증 (`event.origin === 'null'` + source 체크)
- ❌ 서버에서 user-generated 코드 실행 시도 → ✅ 전부 브라우저 위임. 서버 코드 실행 경로 없음.

---

## 4. Agent

- ❌ Temporal Activity에서 LLM 직접 호출 → ✅ `runtime.Agent` 서브클래스 + `@tool` 데코레이터 경유
- ❌ `from langgraph.graph import StateGraph` in 에이전트 파일 → ✅ `from runtime import Agent, tool, AgentEvent` (Plan 12 facade)
- ❌ Visualization과 Temporal 에이전트 둘 다 timeline 생성 → ✅ **Visualization 단독**. Temporal은 stale 감지만.
- ❌ 에이전트 핸드오프에 thread_id 재사용 → ✅ `make_thread_id(workflow_id, agent_name, parent_run_id)`
- ❌ LangGraph channel state mutation (`state["messages"].append(msg)`) → ✅ 리듀서 위임 (`return {"messages": [msg]}`)
- ❌ `messages: Annotated[list, operator.add]` (unbounded 누적) → ✅ `keep_last_n(50)` 윈도우 리듀서
- ❌ LangGraph `interrupt()`로 HITL → ✅ `AwaitingInput` 이벤트 yield + Temporal signal wait
- ❌ `graph.compile(callbacks=[MyCallback()])` → ✅ `HookRegistry.register(hook, scope="agent", agent_filter=[...])`

---

## 5. Permissions

- ❌ route handler에서 `db.select()` 직접 → ✅ `canRead/canWrite/requireWorkspaceRole` 헬퍼 통과
- ❌ Hocuspocus 연결 시 permissions 무시 → ✅ auth hook에서 `canWrite` 확인 후 readOnly 설정
- ❌ 자동 스케줄 에이전트가 user 권한으로 실행 → ✅ workspace `owner` 권한으로 실행 (사용자 트리거 시에만 user 권한)
- ❌ cross-workspace 데이터 조회 → ✅ 모든 쿼리 `WHERE workspace_id = $1` 강제

---

## 6. Chat / RAG

- ❌ chat scope 없이 workspace 전체 검색 → ✅ Strict mode 기본, scope 칩 기반 (Plan 11A)
- ❌ Strict mode에서 top-k 부족 시 자동 전체 검색 → ✅ Expand mode로 명시적 배지 표시 후 fallback
- ❌ `search.hybrid(query)` 시그니처 → ✅ `search.hybrid(query, scope_chips, mode='strict'|'expand')`

---

## 7. Billing

- ❌ "Pro ₩29,000 flat" 하드코드 → ✅ Pro ₩4,900 + PAYG 크레딧 (2026-04-19)
- ❌ "BYOK ₩6,900" → ✅ BYOK ₩2,900 (관리형 솔로, 팀 기능 제외)
- ❌ Toss Payments SDK 통합 task 즉시 실행 → ✅ **BLOCKED** (사업자등록 후, 2026-04-20)
- ❌ `users.plan = 'pro'`로 자격 체크 → ✅ `subscriptions` + `credit_balances` 조회

---

## 8. Next.js 16

- ❌ `middleware.ts` → ✅ `proxy.ts` (Next.js 16에서 `middleware.ts`는 deprecated)
- `NextRequest` → `NextResponse` 구조는 동일
- `config.matcher` 필수 (정적 에셋 포함 전체 실행 방지)

---

## 9. 라이브러리 참조

| 상황 | 참조 방법 |
|------|---------|
| Gemini API (google-genai) | `references/Gemini_API_docs/` 로컬 문서 |
| 그 외 모든 라이브러리 | context7 MCP 사용 |
