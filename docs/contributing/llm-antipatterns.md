# LLM Antipatterns (OpenCairn 전용)

> Claude Code가 이 리포에서 반복한 실수 기록. 수정 시 항상 먼저 확인.

---

## 1. Schema

- ❌ `projects.user_id` 참조 → ✅ `projects.workspace_id` (Workspace 3계층, 2026-04-18)
- ❌ `pgvector(3072)` 하드코드 → ✅ `VECTOR_DIM` env 기반 customType (Plan 1 확정, 기본 768)
- ❌ `users.plan` enum으로 Pro/BYOK 체크 → ✅ `subscriptions` 테이블 + `credit_balances` (Plan 9 PAYG)
- ❌ `conversations.project_id` NOT NULL → ✅ nullable (Page/Workspace scope 고려, Plan 11A)

Provider별 VECTOR_DIM 기본값: Gemini(embedding-001 MRL)=768, Ollama(nomic)=768. 일치하므로 provider 전환해도 스키마 변경 불필요 (ADR-007).

---

## 2. LLM Provider

- ❌ `from openai import ...` / `from worker.gemini.client import GeminiClient` → ✅ `from llm import get_provider` (packages/llm, Gemini + Ollama만, 2026-04-15)
- ❌ `GeminiClient(api_key=...)` 직접 생성 → ✅ `get_provider()` 팩토리
- ❌ `EMBED_MODEL = "gemini-embedding-001"` 하드코딩 → ✅ `os.environ["EMBED_MODEL"]` (BYOK 사용자가 `embed-2-preview` 등 멀티모달 모델로 덮어쓸 수 있음)
- ❌ agent 루프 안에서 `provider.embed([single_input])` N번 호출 → ✅ 루프 밖에서 `embed_many(provider, [...], workspace_id=..., batch_submit=self._batch_submit, flag_env=...)` 한 번. `embed_many()`가 batch flag / min items / provider supports_batch_embed 분기 흡수 (Plan 3b / ADR-008, 2026-04-22). Research 경로(query-time)는 non-goal — 기존 `provider.embed()` 유지.
- ❌ Gemini function call 응답에서 `thoughtSignature` 버리기 → ✅ 다음 턴 history에 반드시 포함
- ❌ Gemini context cache 1000 토큰 시도 → ✅ 최소 4096 토큰 (Gemini spec)

### Gemini 모델 ID

| 틀린 것 | 올바른 것 |
|--------|---------|
| `gemini-2.0-flash` / `gemini-3.0-flash` | `gemini-3-flash-preview` |
| `gemini-1.5-pro` | `gemini-3.1-pro-preview` |
| `text-embedding-004` / `gemini-embedding-2-preview` | `gemini-embedding-001` (텍스트 전용 default, 2026-04-21 ADR-007) |
| `gemini-embedding-001`에 `output_dimensionality` 생략 | `VECTOR_DIM` env로 반드시 forward (pgvector 컬럼 폭과 일치 필수) |
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

**Enforcement:** `apps/worker/scripts/check_import_boundaries.py` (alias: `uv run check-import-boundaries`) fails CI when any file under `apps/worker/src/worker/agents/**/*.py` imports `langgraph`, `langchain_core`, or `langchain` directly. Spec: `docs/superpowers/specs/2026-04-20-agent-runtime-standard-design.md`.

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

## 8. Plate v49 (에디터)

Plan 2A (2026-04-21) 중 반복 확인한 v49 함정. Plan의 코드 스니펫보다 `node_modules/@platejs/*/dist/**/*.d.ts`를 신뢰할 것.

- ❌ `from '@platejs/core/react'` 직접 import → ✅ `from 'platejs/react'` (re-export)
- ❌ `BasicNodesKit`, `MathKit` 같은 bundle export 기대 → ✅ 존재하지 않음. 개별 플러그인 import (`BoldPlugin`, `H1Plugin`, `EquationPlugin`, `HorizontalRulePlugin` 등).
- ❌ 플러그인에 컴포넌트 주입 시 `kit({ components: {...} })` → ✅ `Plugin.withComponent(Component)` 또는 `createPlatePlugin({ node: { component } })` 또는 `createPlateEditor({ components: { [Plugin.key]: Component } })`.
- ❌ `editor.tf.toggleMark(mark)` / `editor.tf.toggleBlock({ type })` → ✅ 그런 API 없음. 각 플러그인이 노출한 `editor.tf.{key}.toggle()` 호출 (예: `editor.tf.bold.toggle()`, `editor.tf.h1.toggle()`).
- ❌ `<Plate onChange={...}>` → ✅ `<Plate onValueChange={...}>`. 바디는 `<PlateContent>`.
- ❌ `editor.tf.insertNode(n)` → ✅ `editor.tf.insertNodes(n, { select: true })` (plural — 단수는 deprecated/없음).
- ❌ `editor.tf.deleteBackward("char")` → ✅ `editor.tf.deleteBackward("character")` (Slate TextUnit 이름).
- ❌ `@platejs/list`에서 별도 `UnorderedListPlugin` / `OrderedListPlugin` → ✅ v49는 indent 기반 — 단일 `ListPlugin` + `toggleList(editor, { listStyleType: "disc" | "decimal" })` 호출로 전환.
- ❌ `@platejs/math`의 `$...$` 오토포맷 기대 → ✅ v49 math 노드는 void. `editor.tf.insert.equation()` / `editor.tf.insert.inlineEquation(tex)` 트랜스폼으로만 삽입.
- ❌ `@platejs/code-block` 없이 CodePlugin만으로 코드 블록 기대 → ✅ basic-nodes의 `CodePlugin`은 **인라인 마크**. 블록이 필요하면 `@platejs/code-block`을 별도 의존성으로 추가.
- ❌ 인라인 non-void 요소에서 `{children}` 생략 → ✅ Slate 런타임이 `Cannot get the start point...` throw. 앵커/span 안에 반드시 렌더.
- ❌ 메뉴 버튼 `onClick`만 달고 에디터 선택 유실 → ✅ `onMouseDown={e => e.preventDefault()}`로 포커스 유지.

---

## 9. Next.js 16

- ❌ `middleware.ts` → ✅ `proxy.ts` (Next.js 16에서 `middleware.ts`는 deprecated)
- `NextRequest` → `NextResponse` 구조는 동일
- `config.matcher` 필수 (정적 에셋 포함 전체 실행 방지)

---

## 10. 라이브러리 참조

| 상황 | 참조 방법 |
|------|---------|
| Gemini API (google-genai) | `references/Gemini_API_docs/` 로컬 문서 |
| 그 외 모든 라이브러리 | context7 MCP 사용 |

---

## 11. Hocuspocus / Plate Yjs (Plan 2B, 2026-04-22)

Plan 2B 실행 중 발견한 함정. `node_modules/@hocuspocus/**/dist/**/*.d.ts` + `node_modules/@platejs/yjs/**/*.d.ts`를 먼저 신뢰할 것.

- ❌ readonly enforcement를 `beforeHandleMessage`에서 `throw` → ✅ **sync-step-1 핸드셰이크 메시지까지 끊겨서 뷰어 read 경로 자체가 실패**. 대신 `onAuthenticate` payload의 `connectionConfig.readOnly`를 `ctx.readOnly`로 채우면 Hocuspocus 내부 `MessageReceiver`가 조용히 update를 drop. `onChange` 단에서 throw는 belt-and-suspenders로만 남겨두기.
- ❌ `@platejs/yjs` awareness를 `editor.getApi(YjsPlugin).yjs.awareness`로 접근 → ✅ awareness는 **플러그인 옵션**에 저장됨. `editor.getOption(YjsPlugin, 'awareness')` 또는 `usePluginOption(YjsPlugin, 'awareness')`.
- ❌ awareness state에서 user 정보를 `state.user` 또는 `state.cursors.data`로 기대 → ✅ `@slate-yjs/core`의 기본 `cursorDataField`는 `"data"`. `state.data.{name,color}`로 접근.
- ❌ Hocuspocus provider status 구독을 `provider.on('status', cb)` → ✅ `HocuspocusProviderWrapper`는 그 이벤트를 expose 안 함. Plate의 `usePluginOption(YjsPlugin, '_isConnected')` 사용.
- ❌ Plate 서버사이드 bridge를 `@platejs/yjs`로 기대 → ✅ **클라이언트 전용**. 서버(apps/hocuspocus)는 `@slate-yjs/core`의 `slateNodesToInsertDelta` + `yTextToSlateElement` 사용. ROOT key는 양쪽 동일하게 `"content"`.
- ❌ `@platejs/yjs@49` + `@hocuspocus/provider@3` peer warning → ✅ wire-compatible. 런타임 문제 없음 (Plan 2B 통합 확인). 상위 버전(`@platejs/yjs@52+`) 업그레이드는 `platejs@52+`까지 묶음이라 별도 plan 필요.
- ❌ Better Auth 세션을 hocuspocus에서 검증하려고 `betterAuth` 인스턴스 만들기 → ✅ `serializeSigned`가 생성한 쿠키는 HMAC-SHA256 단순 포맷. `crypto.subtle` 인라인 + `session` 테이블 JOIN이 훨씬 가벼움 (`apps/hocuspocus/src/auth.ts`).
- ❌ `pnpm install` 후 `.worktrees/<long-name>/node_modules/.pnpm/<long-key>/...` 경로가 Windows MAX_PATH(260) 초과 → `ERR_PACKAGE_IMPORT_NOT_DEFINED "#module-evaluator"` 등 모듈 해결 실패. 짧은 경로로 worktree 재생성 (예: `C:\cw\2b`).
- ❌ `apiClient<T>` wrapper가 204 응답에 `.json()` 호출 → ✅ `if (res.status === 204) return undefined as T;` 짧게 분기. `commentsApi.remove`가 204 반환.
- ❌ drizzle-kit `ALTER TYPE ... ADD VALUE`는 transaction 밖에서 실행되어야 함 → drizzle-kit이 자동 처리하지만, 수동 SQL에서는 `BEGIN;...COMMIT;` 감싸면 실패.

---

## 12. Gemini Tool Calling — Sub-project A (Agent Runtime v2)

Added 2026-04-22. Bit us during Agent Runtime v2 · Sub-project A and must not bite again.

- ❌ 툴이 enable된 응답에서 `response.text`만 읽음 → ✅ `response.text`는 candidate를 flatten하면서 모든 `function_call` part를 drop함. 툴 호출을 요청했는데 빈 문자열이 오는 것처럼 보여 조용히 tool invocation을 스킵하게 됨. **반드시** `response.candidates[0].content.parts`를 iterate하며 `part.function_call` vs `part.text`로 분기.
- ❌ `GenerateContentConfig`에 `automatic_function_calling` 생략 → ✅ Python `google-genai` SDK의 **기본값은 Python callable을 자동 실행**. 모든 guard/hook/log를 우회함. 런타임이 loop의 주인일 때 `types.AutomaticFunctionCallingConfig(disable=True)`를 **반드시** 명시.
- ❌ `function_response`에 `function_call.id`를 빠뜨림 → ✅ Gemini 3는 각 function call마다 고유 `id`를 생성하고 이걸로 response를 원래 call에 매핑함. 생략하면 single-tool turn만 동작하고 parallel/compositional call과 thought signature context가 깨짐.
- ❌ `thought_signature`를 옮길 때 part를 쪼개거나 합침 → ✅ Gemini 3는 assistant content의 임의 part에 thought signature를 embed함. Function Calling §497-504는 signature가 든 part를 이웃과 분리하거나 두 signature를 병합하는 것을 금지. 가장 안전한 건 `content` 전체를 opaque로 취급하고 다음 turn에 그대로 re-inject.
- ❌ `OllamaProvider.generate_with_tools`에 fallback 구현을 추가 → ✅ Sub-project A에서는 `ToolCallingNotSupported` stub으로 두고 **fail fast**. `LLM_PROVIDER=ollama`로 툴 요구 agent가 라우팅되면 `runtime.loop_runner.run_with_tools`가 즉시 예외를 던져야 함. Text-only로 조용히 fallback 금지.
- ❌ `google.genai.errors.APIError`를 테스트에서 `APIError(code=429, response=MagicMock())` 식으로 생성 → ✅ 현재 SDK 시그니처는 `APIError(code, response_json, response=None)`로 `response_json` 필수. `response_json={"error": {"message": "..."}}` 전달.
