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

---

## 13. Gemini Interactions API — Deep Research (Phase A, 2026-04-23)

Added 2026-04-23. `google-genai` 1.73.1 기준. Deep Research Phase A(`packages/llm/src/llm/gemini.py` `start_interaction` 외 3종) 구현 중 발견.

- ❌ 스트리밍을 `client.aio.interactions.stream(interaction_id=...)`로 호출 → ✅ `AsyncInteractionsResource`에 `.stream()` 메서드는 **존재하지 않음**. 노출 메서드는 `cancel / create / delete / get`. 스트리밍은 **`get(stream=True, last_event_id=...)`로 `AsyncStream[InteractionSSEEvent]` 반환** (혹은 `create(..., stream=True)` — 새 interaction 시작 시). `dir(client.aio.interactions)`로 즉시 확인 가능.
- ❌ `agent_config["type"]`에 full 모델명(예: `"deep-research-max-preview-04-2026"`)을 넣음 → ✅ SDK의 `DeepResearchAgentConfigParam.type`은 `Required[Literal["deep-research"]]` 고정 discriminator. 실제 모델명은 **top-level `agent=` 파라미터**로만 전달. `agent_config`에는 `{"type": "deep-research", "collaborative_planning": ..., "thinking_summaries": ..., "visualization": ...}`.
- ❌ `UserWarning: Interactions usage is experimental and may change in future versions.`를 CI에서 `-W error`로 막음 → ✅ SDK가 클라이언트 접근 시 1회 emit하는 **정상 경고**. 억제하지 말되 CI가 error-on-warning이면 `pytest.ini`의 `filterwarnings`에 `ignore::UserWarning:google.genai.*` 추가 고려.
- ❌ `interactions.get(interaction_id)` non-stream 호출 결과의 `outputs`를 `resp.outputs`로 바로 대입 → ✅ 서버가 `outputs=null`을 반환할 수 있음. `list(resp.outputs or [])`로 방어. 이미 `gemini.py` `get_interaction` 구현이 이 형태.
- ❌ `InteractionHandle` / `InteractionState` / `InteractionEvent`를 provider 외부(apps/worker · Temporal activity 등)에서 `google.genai` 타입으로 대체하려 시도 → ✅ 이 3종은 **경계 타입**. `packages/llm`은 SDK 타입을 외부로 누출하지 않는 것이 Phase A 합의. Phase B에서 Temporal payload 직렬화할 때도 dataclass를 그대로 사용하고 `google.genai` enum은 가두어 둘 것.

### 13.1 Phase A SDK alignment 정정 (2026-04-23)

리뷰 중 plan 코드블록을 그대로 옮긴 결과 6개 SDK 드리프트 발견. 122/122 pytest는 녹색이었지만 `MagicMock`에 수기로 `kind` / `payload` / `error`를 박아넣은 테스트라 실제 SDK 호출 시 즉시 깨지는 상태였음. 이후 모든 Interactions / Deep Research 작업은 아래 규율을 따를 것.

- ❌ `InteractionStatus = Literal["queued", "running", ...]` → ✅ SDK `Interaction.status`는 `Literal["in_progress", "requires_action", "completed", "failed", "cancelled", "incomplete"]`. plan에 "queued" / "running"이 등장해도 그대로 옮기지 말고 `interaction.py` Literal을 출처로 둘 것.
- ❌ `InteractionEventKind = Literal["thought_summary", "text", "image", "status"]` → ✅ 그건 `ContentDelta.delta` 하위타입 이름이지 SSE 이벤트 종류가 아님. SDK의 실제 discriminator는 `event_type`이고 값은 `"interaction.start" | "interaction.complete" | "interaction.status_update" | "content.start" | "content.delta" | "content.stop" | "error"` 7종. 새 변형이 추가되면 이 Literal을 갱신해야 한다는 신호.
- ❌ `InteractionSSEEvent`에 `.kind` / `.payload` 필드가 있다고 가정 (`raw.kind`, `raw.payload`) → ✅ 그런 필드는 어떤 variant에도 없음. discriminator는 `event_type`이고 payload-equivalent 필드는 variant마다 다름 (`delta` / `interaction` / `error` / `content` / `status` / `index`). 우리 boundary로 매핑할 땐 `event_type → kind`로 옮기고 나머지를 `model_dump()` 후 `event_type`/`event_id` pop해서 `payload` dict에 모은다.
- ❌ `Interaction` 스키마에 `error` 필드가 있다고 가정 (`resp.error`) → ✅ 없음. 정상 경로에서는 항상 `None`. 서버가 non-spec error를 흘려주면 pydantic `extra="allow"`로 `__pydantic_extra__`에 들어감 — `getattr(resp, "error", None)`로 방어. 실제 streaming error는 `ErrorEvent` (event_type=`"error"`, payload `error: Optional[Error]`)로 들어옴.
- ❌ `Interaction.outputs` 아이템(`Content` BaseModel = TextContent · ImageContent · …)을 그대로 boundary 밖으로 흘려보냄 → ✅ 호출자는 `state.outputs[0]["type"]`처럼 dict access를 기대. provider에서 `o.model_dump() if hasattr(o, "model_dump") else dict(o)`로 평탄화. SDK BaseModel을 `packages/llm` 밖으로 누출하지 말 것.
- ❌ `Interaction.status` / `event_type` 값을 `.value` 또는 `str(...).lower()`로 가공 → ✅ 이미 plain `Literal[...]` 문자열. enum 변환은 불필요하고 잘못된 값으로 저장될 위험만 추가.
- ❌ Interactions API 테스트를 `MagicMock()` + 수기 `setattr(m, "kind", ...)` 조합으로 작성 → ✅ 반드시 **실제 SDK 모델 인스턴스**로 mock 구성: `Interaction.model_validate({...})`, `InteractionStartEvent.model_validate({...})`, `ContentDelta.model_validate({...})` 등. 자기가 상상한 SDK 모양을 mock하면 plan-vs-SDK 드리프트가 테스트로 잡히지 않음. `MagicMock(spec=Interaction)`는 보조 수단으로만 사용 (변형이 많을 때 model_validate가 더 명확).

---

## 14. Base UI primitives + React tree (App Shell Phase 2, 2026-04-23)

Added 2026-04-23. App Shell Phase 2 sidebar(`apps/web/src/components/sidebar/*`) 구현 중 발견. `@base-ui/react` 1.4, `react-arborist` 3.5 기준.

- ❌ shadcn-style `DropdownMenuLabel`/`ContextMenuLabel`을 `DropdownMenuGroup` 밖에서 사용 → ✅ Base UI `Menu.GroupLabel`은 `Menu.Group` root context가 **필수**. 안 감싸면 `"MenuGroupRootContext is missing"` 런타임 throw. 섹션을 label로 구분하려면 `<Group><Label/>…<Item/></Group>` 로 항상 묶을 것.
- ❌ Base UI `ContextMenu.Trigger`의 `children`을 trigger 대체 element로 기대 → ✅ `render` prop이 trigger 대체 경로. `<ContextMenuTrigger render={<div ref={...} onClick={...} />}>...children for that div...</ContextMenuTrigger>` 형태. row element 자체를 trigger로 쓰려면 이 패턴.
- ❌ Plan spec의 `<DropdownMenuItem asChild><a href...>`를 그대로 복사 → ✅ `asChild`는 radix 관용구. Base UI에 해당 prop 없음. 대안: (a) `onClick` 으로 `router.push`, (b) `<ContextMenuItem render={<a href={...} />}>`. asChild가 지원되는지는 primitive의 `.Props` type에서 먼저 확인.
- ❌ `react-arborist` `<Tree>` 에 `height` 없이 마운트 (flex 기반 레이아웃 기대) → ✅ 가상화 특성상 **number 강제**. flex slot 내부에 넣으려면 `ResizeObserver` 로 컨테이너 `clientHeight` 관찰 후 주입. 기본값(400 등)으로 두면 viewport 변경 시 overflow / 잘림.
- ❌ arborist row renderer에 props를 직접 넘기려 시도 → ✅ children-as-component API는 `NodeRendererProps<T>` 이외에 추가 prop을 받지 않음. per-tree state는 `React.Context`로 lift-up. `ProjectTreeContext` 패턴 참고.
- ❌ `<Tree>` 자체를 `render` + `@testing-library/react` 조합으로 jsdom 유닛 테스트 → ✅ `react-arborist`는 `react-dnd`의 `HTML5Backend`에 의존하며 jsdom에서 DOM event model이 일치하지 않아 선명한 타임아웃/스로우 발생. row 렌더러(`ProjectTreeNode`)만 unit 테스트, tree 전체 동작은 Playwright E2E로.
- ❌ next-intl test mock을 `useTranslations: () => (key) => key` 로 작성하여 namespace를 잃음 → ✅ namespace-aware identity 선호: `useTranslations: (ns?: string) => (key) => ns ? \`${ns}.${key}\` : key`. 컴포넌트가 `useTranslations("sidebar.project")` + `t("empty")` 를 쓰면 mock이 "sidebar.project.empty"를 반환해야 테스트 matcher가 일관.
- ❌ 인라인 rename input에서 Enter/Escape 시 `onCommitRename`만 호출, onBlur 는 그대로 둠 → ✅ input unmount 전에 blur가 한 틱 늦게 fire하면 원본 값으로 재-commit 됨. `skipBlurRef = useRef(false)` + Enter/Escape에서 `skipBlurRef.current = true` 설정 + onBlur에서 `if (skipBlurRef.current) return` 가드. isRenaming true로 전환 시 useEffect에서 reset.
- ❌ `PATCH /api/notes/:id` 에 `folderId` 를 열어둔 채 "이동은 `/:id/move` 써라" 주석만 남김 → ✅ `updateNoteSchema.omit({ content, folderId })` 로 스키마 레벨에서 strip. `notes.folder_id → folders.project_id` FK 가드가 DB에 없으므로 PATCH 경로를 열어두면 cross-project 이동이 조용히 통과 (App Shell Phase 2 Task 11 review에서 잡힘).
- ❌ Windows에서 `Sidebar.tsx`(legacy) 가 이미 존재하는데 `sidebar.tsx` 신규 생성 → ✅ NTFS case-insensitive FS는 두 파일을 같은 것으로 취급. 충돌하면 `shell-sidebar.tsx` / `ShellSidebar` 처럼 다른 이름 선택. `git mv`로 rename 하고 싶을 때도 `--force` + 두 단계 필요.
- ❌ `react-arborist` `onToggle` 핸들러에서 `node.isOpen` 기반으로 분기 → ✅ callback은 **id만** 받음. 외부 expand set(우리는 `sidebarStore.expanded`)에서 기존 상태를 읽고 분기할 것.
