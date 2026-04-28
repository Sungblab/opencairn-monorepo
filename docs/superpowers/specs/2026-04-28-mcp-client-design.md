# MCP Client — Design Spec

**Status**: Draft (2026-04-28). Plan 작성은 별도 세션.
**Author**: kss19558 + Claude
**Worktree/branch**: `.worktrees/mcp-spec` / `docs/mcp-client-spec`
**Roadmap entry**: `docs/architecture/agent-platform-roadmap.md` §A1
**Memory**: `feedback_byok_cost_philosophy`, `feedback_oss_hosting_split`, `feedback_llm_provider_env_only`,
`feedback_internal_api_workspace_scope`

---

## 1. 동기

OpenCairn 의 12 에이전트가 외부 도구를 호출할 때 매번 자체 activity 를 짜는 패턴 (`drive_activities.py`,
`notion_activities.py`) 은 신규 통합마다 작업량이 선형 증가한다. Model Context Protocol (MCP) 은 외부 도구를
**HTTP/JSON-RPC 표준 계약**으로 노출하므로, 사용자가 외부 MCP 서버 — Linear, GitHub, Stripe, Slack, 사내
도구 — 를 등록하기만 하면 우리 에이전트가 그 서버의 모든 툴을 호출할 수 있다.

본 spec 의 **1차 목표는 "사용자가 가져온 외부 도구를 OpenCairn 에이전트가 호출"** 이다. 즉 우리는 MCP
**클라이언트** 가 된다.

명시적 비-목표:

- **기존 ingest 통합을 MCP 로 갈아끼기 안 함.** Drive/Notion activity 는 그대로. MCP 는 add-on 레이어
  이지 대체 레이어가 아님. 이유: 결정성/Temporal retry/zip-slip 방어/MIME allowlist 등 기존 파이프라인의
  보장이 깨지는 위험을 감수할 만큼 ROI 가 크지 않음.
- **OpenCairn 자체를 MCP 서버로 노출 (Claude Code/Desktop 에서 OpenCairn 붙이기) 안 함.** 가치는
  있지만 별도 spec 으로 분리. §11 백로그 참고.
- **Sampling / Resources / Prompts** MCP feature 안 다룸. 이번 spec 은 **tools** 만.

### 1.1 사용자 시나리오

- 사용자가 Settings → Integrations → "Add MCP Server" 클릭
- displayName="My Linear", URL=`https://mcp.linear.app/sse`, Authorization Header=`Bearer lin_xxx` 입력
- "Test" 버튼 → 서버 `list_tools` 호출 → "23 tools detected (create_issue, list_issues, ...)" 표시
- 등록 완료
- 다음에 Compiler 에이전트가 "이슈 만들어" 라는 사용자 요청을 받으면 `mcp__my_linear__create_issue` 툴이
  자동으로 카탈로그에 들어가 있고, 에이전트가 호출

---

## 2. 결정사항 (요약 표)

| 영역 | 결정 | 근거 (요약) |
|---|---|---|
| 등록 단위 | **user-only**. workspace 공유는 future. | 시크릿 모델 (user_integrations / user_preferences) 과 일치. solo + team 모두 자연스러움. |
| Transport | **streamable HTTP only**. stdio 미지원. | OpenCairn 은 multi-tenant. stdio 는 컨테이너 내부에서 임의 명령어 spawn 이라 격리 깨짐. 상용 MCP 서버 대부분이 hosted HTTP. |
| 인증 | **static auth header (Bearer/API key)**. OAuth 2.1 = future. | 첫 출시 schema 1 컬럼으로 끝. OAuth 는 callback route + redirect URI whitelist + per-server client 발급 부담이 4~5배. |
| 툴 노출 | 등록 = **모든 툴 enable**. 서버 단위 신뢰. | 토큰 등록 시점에 "이 토큰의 권한 안에서 뭐든 OK" 가 이미 신뢰 모델. 툴 단위 whitelist 는 사용자 인지 부담 대비 실효 낮음. |
| Tool naming | `mcp__<server_slug>__<tool_name>` prefix 강제. | 두 서버가 같은 이름 노출 가능. built-in 툴과도 충돌 방지. Claude Code 컨벤션과 일치. |
| Scope | 어댑터 `allowed_scopes=("workspace",)` hardcode. | MCP 서버는 OpenCairn page 권한 모델을 모름. project/page-level run 에서 다른 페이지 정보 흘릴 위험 차단. |
| Tool 한도 | 서버당 **최대 50 툴**. 초과 시 등록 거부. | Gemini `tool_declarations` 폭발 방지. 사용자에게 "이 서버는 너무 큼" 명시적 거부. |
| Destructive 표시 | `delete/remove/drop` keyword 휴리스틱 → trajectory flag 만, **차단 안 함**. | 에이전트 자율 실행이 OpenCairn 가치. 사후 admin 검토용 표식. |
| Catalog 갱신 | **per-run dynamic resolution**. 정적 `_REGISTRY` 와 분리. | 한 서버 down 으로 worker 부팅 실패 막음. 멀티테넌트 격리 자연스러움. 등록 즉시 다음 run 에서 잡힘. |
| Failure mode | 서버 down = 그 서버만 비활성 + warning event. 401 = `auth_expired` 알림. | run 시작 실패 안 만듦. 다른 서버/built-in 툴 정상 동작. |
| Per-tool timeout | 기존 ToolLoopExecutor `per_tool_timeout_sec` 그대로 (30s default). MCP 툴 별도 override 안 함. | 기존 가드 재사용. 필요 시 `per_tool_timeout_overrides` 에 prefix 매칭 추가는 future. |
| Feature flag | `FEATURE_MCP_CLIENT` env. **hosted = ON, OSS = OFF**. | `feedback_oss_hosting_split` 컨벤션. self-hosted 운영자가 명시적으로 켜야 활성. |

---

## 3. Open Questions (이번 spec 에서 결정 안 함)

| ID | 질문 | 트리거 시점 |
|---|---|---|
| OQ-1 | Workspace 공유 등록을 어떻게 도입할까 (소유자 enum / 별도 테이블 / 권한 모델) | 사용자 요청 + 팀 사용 시나리오가 누적되면 별도 spec |
| OQ-2 | OAuth 2.1 + PKCE 추가 시 구조 (per-server client 발급 / 통합 callback route / refresh 회전) | 상용 MCP 서버가 OAuth 만 노출하는 사례가 늘어 사용자 요청이 들어오면 |
| OQ-3 | Tool catalog 캐시 (server_id → tools, TTL) 도입 임계 | per-run resolution 의 `list_tools` 라운드트립 latency 가 SSE 첫 토큰 지연으로 측정되면 |
| OQ-4 | MCP `sampling` / `resources` / `prompts` feature 지원 여부 | tools 만으로 못 푸는 사용자 요구가 명확히 발생 시 |
| OQ-5 | 도메인 allowlist 의 default 동작 (개방 / 명시적 enum / regex) | 첫 prod 사고 또는 hosted 운영자 요구 시 |
| OQ-6 | Per-tool destructive confirmation UI 도입 여부 | trajectory destructive flag 통계가 누적되어 사고 케이스가 보이면 |

OQ 는 **새 plan 의 trigger** 다. 본 spec 에 답을 미루어두고 trigger 발생 시 별도 spec 작성.

---

## 4. DB 변경

신규 테이블 1개. 기존 테이블 0개 변경.

### 4.1 `user_mcp_servers`

```ts
// packages/db/src/schema/user-mcp-servers.ts
import { pgTable, uuid, text, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { user } from "./users";
import { bytea } from "./custom-types";
import { mcpServerStatusEnum } from "./enums";

export const userMcpServers = pgTable(
  "user_mcp_servers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Better Auth user.id is text. FK type must match (precedent:
    // user_integrations / user_preferences).
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Stable URL-safe identifier used as the prefix in
    // `mcp__<serverSlug>__<toolName>`. Generated on the server side
    // from displayName, validated against /^[a-z0-9_]{1,32}$/.
    serverSlug: text("server_slug").notNull(),
    displayName: text("display_name").notNull(),
    serverUrl: text("server_url").notNull(),
    // Header NAME the server expects. Default Authorization but a
    // handful of servers want X-API-Key / similar — letting the user
    // override avoids per-server kludges.
    authHeaderName: text("auth_header_name").notNull().default("Authorization"),
    // AES-256-GCM with INTEGRATION_TOKEN_ENCRYPTION_KEY. iv(12)||tag(16)||ct
    // wire layout — same as user_integrations and user_preferences so the
    // worker decrypt helper round-trips. Nullable for servers requiring
    // no auth (rare).
    authHeaderValueEncrypted: bytea("auth_header_value_encrypted"),
    status: mcpServerStatusEnum("status").notNull().default("active"),
    lastSeenToolCount: integer("last_seen_tool_count").notNull().default(0),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("user_mcp_servers_user_slug_unique").on(t.userId, t.serverSlug)],
);
```

### 4.2 새 enum

```ts
// packages/db/src/schema/enums.ts
export const mcpServerStatusEnum = pgEnum("mcp_server_status", [
  "active",
  "disabled",      // user manually disabled
  "auth_expired",  // 401 observed during a recent call_tool / list_tools
]);
```

### 4.3 마이그레이션

- 다음 가용 번호 = **0033** (Plan 8 가 0032 사용 — `MEMORY.md` `project_plan8_complete` 확인).
- 파일: `packages/db/drizzle/0033_user_mcp_servers.sql` + 메타 snapshot.
- 롤백: `DROP TABLE user_mcp_servers; DROP TYPE mcp_server_status;` 로 충분 (다른 테이블 참조 없음).

### 4.4 통합지점

- `notification_kind` enum 에 **새 값 추가 안 함**. `auth_expired` 는 settings UI 의 빨간 점 + 옵션 토스트로
  처리. (Plan 8 알림은 무거운 페이로드 요구하는 inbox-style. MCP 만료는 설정 페이지 한 곳에서만 의미가 있음.)
- `integrationProviderEnum` 안 건드림. MCP 는 enum 기반 provider 분류 밖 — 서버 URL 자체가 식별자.

---

## 5. API 변경 (`apps/api`)

모든 라우트는 user-owned. `workspaceId` scoping 불필요 (`feedback_internal_api_workspace_scope` 은
`/api/internal/*` 라우트의 워크스페이스-쓰기 보호 — 본 라우트는 user-owned 자원이라 적용 X).

| Method + Path | 설명 |
|---|---|
| `GET /api/mcp/servers` | 본인의 등록 서버 목록. authHeaderValue 는 절대 응답에 안 들어감 (`hasAuth: boolean` 만) |
| `POST /api/mcp/servers` | 등록. 입력: `{ displayName, serverUrl, authHeaderName?, authHeaderValue? }`. 서버측에서 `serverSlug` 생성 (displayName → snake_case → 충돌 시 suffix). |
| `PATCH /api/mcp/servers/:id` | displayName / authHeader 수정. URL 변경은 금지 (slug stability) — 새로 만들고 지우라고 안내. |
| `DELETE /api/mcp/servers/:id` | 삭제. cascade 없음 (다른 테이블 참조 0개). |
| `POST /api/mcp/servers/:id/test` | `list_tools` 1회 호출. 결과: `{ toolCount, sampleNames: string[5], status: "ok" \| "auth_failed" \| "transport_error", durationMs }`. lastSeenToolCount/lastSeenAt 갱신. |

### 5.1 등록 시 검증

`POST /api/mcp/servers` 핸들러가 등록 직후 자동으로 `/test` 와 동일 로직을 1회 실행. 결과:

- `ok` 또는 `toolCount > 50` → 등록 거부 (400, `mcp_too_many_tools`)
- `transport_error` → 등록 거부 (400, `mcp_unreachable`)
- `auth_failed` → status=`auth_expired` 로 등록 (사용자가 인증 빠뜨린 케이스 허용 — 수정으로 복구 가능)
- 정상 → status=`active`

### 5.2 Zod 스키마

`packages/shared/src/mcp.ts` 신규 파일.

```ts
export const McpServerCreateSchema = z.object({
  displayName: z.string().min(1).max(64),
  serverUrl: z.string().url().refine(
    u => u.startsWith("https://"),
    "MCP server URL must use HTTPS",
  ),
  authHeaderName: z.string().min(1).max(64).default("Authorization"),
  authHeaderValue: z.string().max(4096).optional(),
});
```

API contract 추가는 `docs/architecture/api-contract.md` 도 같이 갱신 (plan 단계 task).

---

## 6. Worker 변경 (`apps/worker`)

신규 패키지 `apps/worker/src/runtime/mcp/`. **모듈 1개 (`mcp_client.py`) 가 아닌 패키지** — adapter / resolver
/ client 가 책임 분리되며 테스트 셋이 자연스러워짐.

```
apps/worker/src/runtime/mcp/
├── __init__.py        # 공개 API: build_mcp_tools_for_user, MCPCatalogResolver
├── client.py          # ClientSession 래퍼. list_tools / call_tool. SSRF 가드.
├── adapter.py         # types.Tool → runtime.Tool 변환.
├── resolver.py        # per-run: user_id → 활성 서버 → Tool 리스트 빌드.
└── slug.py            # serverSlug 생성 + 검증 (API 와 공유 로직).
```

### 6.1 `client.py` 책임

- `streamable_http_client(url, headers={authHeaderName: authHeaderValue})` 로 연결
- `list_tools()` / `call_tool(name, args)` 만 노출. sampling/elicitation/resources 는 stub (없으면 무시)
- 모든 호출에 `read_timeout_seconds=30` 강제 (ToolLoopExecutor 의 per-tool timeout 과 동일)
- SSRF 가드: hostname DNS resolve → RFC1918 / 127.0.0.0/8 / 169.254.0.0/16 / metadata IP (`169.254.169.254`,
  `fd00:ec2::254`) 차단. resolved IP 가 다 차단 대상이면 `MCPSecurityError` raise. (User 가 입력한 URL 그대로
  호출하므로 이 가드가 worker 내부 자원으로의 접근 막는 마지막 방어선.)
- env `MCP_URL_ALLOWLIST` (regex) 가 설정되어 있으면 hostname 추가 매칭

### 6.2 `adapter.py` 책임

```python
def adapt(
    server_slug: str,
    mcp_tool: types.Tool,
    *,
    server_url: str,
    auth_header: tuple[str, str] | None,
) -> Tool:
    """MCP types.Tool → runtime.Tool. 호출 시 ClientSession 매번 새로 연다.

    - name = f"mcp__{server_slug}__{mcp_tool.name}"
    - description = mcp_tool.description (그대로)
    - input_schema = mcp_tool.inputSchema (JSON Schema 그대로 통과)
    - allowed_scopes = ("workspace",)  # hardcode
    - allowed_agents = ()  # 모든 에이전트 (단 Phase 1 은 Compiler 만 — §10)
    - redact: authHeaderValue 는 ToolContext 가 아닌 어댑터 closure 안에 있어
      run() 인자에 안 노출. 따로 redact 필요 없음.
    - run(args, ctx): client.py 로 call_tool 호출 → MCP CallToolResult →
      dict 변환. is_error=True 면 raise (ToolLoopExecutor 가 ToolResult.is_error
      로 잡음).
    """
```

destructive 휴리스틱: `mcp_tool.name` 에 `delete|remove|drop|destroy` 포함 시 `Tool` 클래스 인스턴스에
`destructive: bool = True` 속성 부여 (Protocol 확장). `TrajectoryWriterHook.on_tool_start` 가 이 속성 보고
`destructive=True` 를 ToolUse 이벤트에 함께 emit.

### 6.3 `resolver.py` 책임

```python
async def build_mcp_tools_for_user(
    user_id: str,
    *,
    db_session,
    on_warning: Callable[[str], Awaitable[None]] | None = None,
) -> list[Tool]:
    """Per-run resolution. 한 run 시작마다 호출.

    1. SELECT * FROM user_mcp_servers WHERE user_id = $1 AND status = 'active'
    2. 병렬로 각 서버 list_tools()
    3. 실패한 서버는 on_warning("server X unreachable") + status='auth_expired'
       또는 그대로 두고 다음 run 에서 재시도 (transport_error 는 일시적일 수 있음)
    4. 성공한 툴들을 adapter.adapt() 로 감싸 runtime.Tool 리스트로 반환
    """
```

호출자: 각 agent workflow 의 활동 진입 부근.

### 6.4 ToolLoopExecutor 통합

기존 `tools = static_tools` 호출지점에서 union:

```python
# 예: apps/worker/src/worker/agents/compiler/agent.py
static_tools = get_tools_for_agent("compiler", scope="workspace")
mcp_tools = await build_mcp_tools_for_user(user_id, db_session=session)
all_tools = static_tools + mcp_tools

executor = ToolLoopExecutor(
    provider=provider,
    tool_registry=registry,  # 동일. registry.execute(name, args) 가 mcp__ prefix 로 분기
    config=loop_config,
    tool_context=tool_context,
    tools=all_tools,
)
```

`tool_registry.execute` 분기 — `mcp__` prefix 면 어댑터 closure 의 `run()` 으로 라우팅. registry 는 정적
`_REGISTRY` 와 per-run mcp tools 둘 다 보는 작은 래퍼 클래스로 (현 `_REGISTRY` 글로벌 dict 안 건드림).

### 6.5 Workflow / Activity 통합

활동 안에서 DB 조회 안 함 (drive_activities 의 `_DRIVE_ACCESS_TOKEN_HEX` 패턴 차용):

- Workflow 가 활동 시작 전 DB 1회 round-trip → 활성 MCP 서버 메타 (id, slug, url, decrypted-then-rehex
  auth header) 를 dict 로 직렬화 → 활동 input payload 에 포함
- 활동은 받은 payload 를 `MCPCatalogResolver.from_payload()` 로 즉석 카탈로그 빌드, 어댑터 list 만들고 끝
- 이 패턴은 활동 retry 시 같은 메타로 재실행되어 결정성 유지

### 6.6 Provider 의존성

`packages/llm` 변경 없음. `runtime.tool_loop.ToolLoopExecutor` 가 이미 `tools` 를 인자로 받는 구조라 MCP
툴은 그냥 list 에 추가만 하면 Gemini/Ollama 양쪽 declaration builder 가 자동 처리.

### 6.7 의존성 추가

`apps/worker/pyproject.toml` 에 `mcp = "^1.12"` 추가. context7 에서 확인된 SDK (`mcp.client.streamable_http`,
`mcp.ClientSession`, `mcp.types.Tool`).

---

## 7. 보안 모델

### 7.1 위협 모델

| 위협 | 완화 |
|---|---|
| 사용자가 입력한 URL 이 worker 내부 자원 (Postgres, MinIO, Redis) 을 가리킴 | §6.1 SSRF 가드 — DNS resolve 후 private IP 차단 |
| 사용자가 자기 토큰을 다른 워크스페이스 사용자에게 흘림 | per-user 등록 + per-run resolver 가 user_id 외 서버 절대 안 가져옴. 정적 registry 에 안 들어감. |
| MCP 서버가 페이지 권한을 모르고 다른 페이지 정보 흘림 | 어댑터 `allowed_scopes=("workspace",)` hardcode → page-level run 에서 노출 안 됨 |
| 사용자가 다른 사용자의 서버 ID 로 `/api/mcp/servers/:id/test` 호출 | 핸들러가 `WHERE user_id = sessionUser.id AND id = :id` 로 검증 (404 응답) |
| 토큰이 trajectory 에 평문 노출 | authHeaderValue 가 ToolContext / args 에 안 들어감 (어댑터 closure 안). trajectory 에 흐를 경로 자체 부재 |
| 한 서버의 응답이 다른 서버의 응답으로 섞임 | per-server `ClientSession` 별도. 응답 매칭은 SDK 의 request id 책임 (검증 fixture) |
| Tool name 충돌로 built-in 툴 또는 다른 서버 툴 호출됨 | `mcp__<slug>__` prefix + slug unique constraint |
| MCP 서버가 결과로 거대 payload 보내 메모리 폭발 | 기존 ToolLoopExecutor `_truncate(50_000 char)` 에 그대로 적용 |

### 7.2 암호화

- bytea 컬럼 + AES-256-GCM (`INTEGRATION_TOKEN_ENCRYPTION_KEY` env)
- Wire layout `iv(12) || tag(16) || ct` — user_integrations / user_preferences 와 동일
- Worker 측 decrypt 헬퍼: `worker.lib.integration_crypto.decrypt_token` 재사용

### 7.3 Multi-tenant 격리 invariants

- **불변식 1**: `runtime.tools._REGISTRY` 에는 MCP 툴 절대 안 들어간다 (글로벌 = 모든 사용자 공유). 들어가면
  즉시 멀티테넌트 leak.
- **불변식 2**: `MCPCatalogResolver` 는 user_id 인자 없이 호출 불가능 (시그니처 강제).
- **불변식 3**: 어댑터의 `run()` 은 closure 의 `auth_header` 만 사용. ToolContext.user_id 와 closure 의
  user_id 가 일치하는지 첫 호출 시 1회 assert (방어 심도).

### 7.4 Trajectory / Sentry 누설

- TrajectoryWriterHook: `tool_use.args` 에 authHeaderValue 가 들어갈 수 없음 (구조적). 추가 redact 불필요.
- Sentry: 어댑터 내부 예외에 url/headers 안 첨부. `MCPSecurityError`, `MCPAuthError` 같은 specific exception
  으로 분기.

---

## 8. 마이그레이션 전략

### 8.1 새 환경 (greenfield)

- `pnpm db:migrate` 가 0033 적용 → 빈 테이블만 생김
- 기존 코드 동작 0% 영향
- `FEATURE_MCP_CLIENT=false` (OSS 기본값) 면 API 라우트는 404 반환, worker 는 resolver 호출 자체 skip
  (early return)

### 8.2 기존 환경 (production / dev)

- 0033 마이그 1회 — 빈 테이블 생성. 기존 데이터 0건 영향
- 기존 user_integrations / user_preferences 테이블 0줄 변경
- 기존 에이전트 / activity / workflow 0줄 변경
- 사용자가 처음 서버 등록 전까지 모든 run 에서 `MCPCatalogResolver` 가 빈 list 반환 → 기존 동작과 동일

### 8.3 롤백

- `DROP TABLE user_mcp_servers; DROP TYPE mcp_server_status;`
- Worker 코드는 feature flag OFF 로 비활성. 코드 자체 revert 도 안전.

### 8.4 OSS 배포본

- `feedback_oss_hosting_split` 컨벤션: `FEATURE_MCP_CLIENT` env 미설정 시 OFF
- `.env.example` 에 항목 추가하되 default 는 `false`
- README 의 "advanced features" 섹션에 enable 방법 명시 (별도 작업)

---

## 9. 테스트 전략

### 9.1 Unit (workspace `apps/worker`)

| 파일 | 케이스 |
|---|---|
| `tests/runtime/mcp/test_adapter.py` | `types.Tool` → `runtime.Tool` 변환. inputSchema 통과. allowed_scopes hardcode 검증. destructive 휴리스틱. |
| `tests/runtime/mcp/test_slug.py` | 영문/한글/숫자 displayName → slug. 충돌 시 suffix. unique 검증. |
| `tests/runtime/mcp/test_client_ssrf.py` | private IP / metadata IP / IPv6 link-local 차단. allowlist regex 동작. |
| `tests/runtime/mcp/test_resolver.py` | DB 모킹 + ClientSession 모킹 (JSON fixture). 한 서버 down 시 다른 서버 정상 빌드. 50 툴 초과 거부. |
| `tests/runtime/mcp/test_truncation.py` | 거대 응답 payload → ToolLoopExecutor `_truncate` 에 걸림 검증. |

### 9.2 Integration

`mcp.server.fastmcp` 로 테스트용 echo 서버를 **stdio 로** 띄움 (테스트 환경 한정 — production stdio 미지원
원칙은 그대로). conftest fixture:

```python
# tests/conftest.py (worker)
@pytest.fixture
async def echo_mcp_server():
    """Spawn a fastmcp echo server over stdio. Test-only — production never
    spawns child processes (§2 transport decision)."""
    ...
```

streamable HTTP 라운드트립 테스트는 `pytest-asyncio` + `aiohttp` 인-프로세스 서버:

```python
# tests/runtime/mcp/test_http_roundtrip.py
async def test_call_tool_via_streamable_http(in_process_mcp_http_server):
    tools = await build_mcp_tools_for_user(...)
    result = await tools[0].run({"x": 1}, ctx=...)
    assert result == {"echo": 1}
```

### 9.3 API 레이어 (workspace `apps/api`)

| 파일 | 케이스 |
|---|---|
| `tests/mcp/servers.test.ts` | POST 등록 + auto-test 로직. 50+ 툴 거부. transport_error 거부. auth_expired 허용. |
| `tests/mcp/encryption.test.ts` | authHeaderValue 라운드트립. 응답에 평문 안 나감. |
| `tests/mcp/cross-user-access.test.ts` | A 사용자 서버 ID 로 B 사용자가 GET/PATCH/DELETE/test 시 404. |

### 9.4 Manual smoke (plan 시점)

- `mcp.server.fastmcp` 자작 서버를 ngrok 으로 노출 → /api/mcp/servers/test 200 OK + toolCount 일치 확인
- Compiler 에이전트가 등록된 서버의 echo 툴 호출 → trajectory 에 `mcp__echo__add` 잡힘 확인
- 캡처 스크린샷 한 장 commit (`docs/review/`).

### 9.5 회귀 가드

- **i18n parity 영향 없음**: 본 spec 의 user-facing 문자열은 settings UI Phase 1 에서 추가될 키만 (별도 plan).
- **CLAUDE.md 정정**: Plan 9b OSS 분리 sweep 시점에 README/landing/docs 의 "통합" 섹션에 MCP 항목 추가
  여부 결정 (지금은 보류).

---

## 10. 롤아웃 단계

### Phase 1 — 본 spec 의 implementation plan 범위

목표: **Compiler 에이전트 1개 + 사용자가 등록한 1개 서버**까지 end-to-end 동작.

- 0033 마이그 + `user_mcp_servers` 테이블
- API 4개 (`GET/POST/PATCH/DELETE /api/mcp/servers`) + `POST /test`
- `apps/web` settings UI 1페이지 (등록 폼 + 목록 + Test 버튼). i18n 키 ko/en parity
- worker `runtime/mcp/` 패키지 + Compiler 에이전트 진입점에 `build_mcp_tools_for_user` 호출
- `FEATURE_MCP_CLIENT` flag (default OFF). hosted env 에서만 true
- E2E smoke 1회

### Phase 2 — 다른 11 에이전트 노출

- 어댑터 자체는 변경 없음 — 각 에이전트 진입점에 1줄 추가
- 에이전트별 안전성 검토 (예: 자율 reading 만 하는 Curator 가 destructive 툴 노출되어도 되는지)
- 별도 plan 또는 Phase 1 plan 후속 task

### Phase 3 — Workspace 공유 (OQ-1) + OAuth (OQ-2)

별도 spec. 본 spec 의 schema 가 user_id 단일 컬럼이라 owner_kind enum 추가 마이그 필요 (그 시점에).

### Phase 4 — OpenCairn-as-MCP-server (방향 2)

별도 spec. 본 spec 과 코드 0% 공유 — 우리가 노출하는 서버는 별도 프로세스 (apps/api 의 새 라우트 또는
별도 패키지). §11 백로그.

---

## 11. Future Work / 백로그

| 항목 | 트리거 |
|---|---|
| Workspace-shared 등록 (OQ-1) | 팀 사용자 다수 + 같은 토큰 공유 요구 |
| OAuth 2.1 + PKCE (OQ-2) | OAuth-only 상용 MCP 서버를 사용자가 붙이고 싶어함 |
| Tool catalog 캐시 (OQ-3) | per-run `list_tools` 라운드트립이 SSE 첫 토큰 지연으로 측정됨 |
| `sampling` callback (OQ-4) | MCP 서버가 자체 LLM 호출 권한을 우리한테 위임받고 싶어함 |
| `resources` / `prompts` (OQ-4) | 사용자 등록 서버가 dataset / prompt template 노출, 에이전트가 활용 |
| stdio transport (single-tenant 모드) | 진짜 single-tenant 셀프호스팅 모드 도입 시. 별도 deploy mode |
| Per-tool destructive confirmation UI (OQ-6) | trajectory destructive flag 통계 누적 후 사고 케이스 발생 |
| Per-tool timeout override (prefix 매칭) | 특정 서버의 정상 호출이 30s 초과 |
| **OpenCairn-as-MCP-server** (방향 2) | 사용자가 Claude Code/Desktop 에서 OpenCairn 페이지/검색/위키를 툴로 쓰고 싶어함. read-only 부터. |

---

## 12. 참고 / 의존성

- `docs/architecture/agent-platform-roadmap.md` §A1 — 우선순위 1 항목
- `apps/worker/src/runtime/tools.py` — `Tool` Protocol, `_REGISTRY` 글로벌
- `apps/worker/src/runtime/tool_loop.py` — `ToolLoopExecutor`, per-tool timeout, `_truncate`
- `apps/worker/src/worker/activities/drive_activities.py` — secret-via-env 패턴 차용
- `packages/db/src/schema/user-integrations.ts` — bytea + AES-GCM 패턴
- `packages/db/src/schema/user-preferences.ts` — BYOK 암호화 wire layout
- MCP Python SDK `v1.12` (`/modelcontextprotocol/python-sdk` via context7) — `streamable_http_client`,
  `ClientSession`, `types.Tool`
- 메모리: `feedback_byok_cost_philosophy`, `feedback_llm_provider_env_only`, `feedback_oss_hosting_split`,
  `feedback_internal_api_workspace_scope`, `project_agent_platform_roadmap`

---

## 13. 변경 이력

- 2026-04-28: 초안 작성. brainstorming 세션에서 7 결정 확정 (등록 단위 / transport / 인증 / 노출 정책 /
  catalog 모델 / failure mode / 백로그 위치).
