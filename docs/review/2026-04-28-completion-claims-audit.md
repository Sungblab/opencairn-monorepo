# Completion Claims Audit — 2026-04-28

> **TL;DR** — Phase 0/1/2 전반에서 "✅ 완료"로 닫힌 플랜 다수가 *user-facing 약속과 백엔드 구현 사이에 silent gap*을 가지고 있다. 패턴은 일관됨: UI/카피/MIME allowlist는 기능을 광고 → 백엔드는 stub·placeholder·미구현·cron 미스케줄. **OpenCairn은 "12 AI 에이전트 지식 OS"라고 광고하지만, production에서 실제 LLM이 호출되는 user-facing 경로는 0개**다.
>
> 이 문서는 5개 서브에이전트의 코드 대조 audit 결과 박제본이다. 메모리·커밋 메시지·PR 설명은 신뢰하지 않고 코드/스키마/Dockerfile/의존성 파일만으로 검증.

## 0. 발단

Plan 3 ingest pipeline이 ✅ 완료로 머지됐는데, plan 헤더에 "Office/HWP 변환(markitdown/unoserver/H2Orestart), scan PDF OCR, streaming upload은 follow-up task로 분리" 라는 한 줄로 *4개 큰 deliverable이 silent defer*. follow-up plan은 작성되지 않음. 결과:

- `apps/api/src/routes/ingest.ts:43-57` — MIME allowlist는 docx/pptx/xlsx/doc/ppt/xls/hwp/hwpx 모두 수락
- `apps/web/messages/{ko,en}/landing.json` — "pdf · docx · hwp · epub · mp3 · mp4 · m4a" 광고 중
- `apps/worker/src/worker/activities/` — `office_activity.py` / `hwp_activity.py` **부재**
- `apps/worker/Dockerfile` — LibreOffice/unoserver/H2Orestart **미설치**, opendataloader-pdf Java만
- `apps/worker/pyproject.toml` — `markitdown` **의존성 없음**
- `apps/worker/src/worker/workflows/ingest_workflow.py:181-182` — pdf/audio/video/image/youtube/web-url 외 모두 `raise ValueError("Unsupported mime_type")`

→ HWP 업로드 시 202 응답 후 **silent fail**.

이 패턴이 다른 플랜에도 있는지 면밀히 감사 → 아래 결과.

---

## 1. Tier 1 — UI는 약속, 백엔드는 가짜

### 1.1 App Shell Phase 4 (Agent Panel) — 챗봇이 production에서 stub echo

- **증거**: `apps/api/src/lib/agent-pipeline.ts:39` — `const body = "(stub agent response to: ${opts.userMessage.content})"`
- 이 stub이 `apps/api/src/routes/threads.ts:19, 55, 288`에서 `defaultRunAgent`로 wire되어 있음 — production 코드 경로
- E2E 스펙(`agent-panel.spec.ts`)도 stub echo 문자열 자체를 검증 (line 14)
- **메모리 entry**: "실 chat UI · `chat_threads/messages/feedback` · SSE · 11 컴포넌트. stub `runAgent` + E2E 실행은 follow-up." → stub은 자백되어 있으나 plans-status.md의 "✅ Phase 4 complete" 프레이밍이 이를 가림
- **유저 임팩트**: 채팅에 뭘 입력하든 `(stub agent response to: <입력>)` 답변이 SSE로 char-by-char 스트리밍됨

### 1.2 Plan 11A Chat Scope Foundation — placeholder가 곧 기능

- **증거**: `apps/api/src/routes/chat.ts:340-345, 376-417` — SSE 응답이 하드코딩된 `"(11A placeholder reply)"`
- `ragMode`, `attachedChips`는 DB에 저장되지만 `/message` 핸들러에서 read 0회 (line 65-66, 184) — Strict/Expand RAG 토글은 **행동 효과 0**
- Cost tracking은 실제 KRW 계산 파이프라인이 있지만 인풋이 가짜: `Math.ceil(content.length / 4)` (line 362-364)로 토큰 추정
- 결과: `conversations.total_cost_krw` 컬럼은 **provider 기준 진실이 아닌 noise**
- **PR #54 머지, 15 commits 완료로 표기**

### 1.3 Plan 2D save_suggestion — production 경로 없음

- **증거**: `apps/api/src/lib/agent-pipeline.ts:46-58`
- save_suggestion 이벤트는 `process.env.AGENT_STUB_EMIT_SAVE_SUGGESTION === "1"` AND `userMessage.content.includes("/test-save")` 일 때만 발동
- 클라이언트 렌더러 (`save-suggestion-card.tsx`)는 진짜인데 emit하는 producer가 stub-only
- **PR #52 머지, 25 task 완료**. "5 editor blocks"는 진짜, "save_suggestion 흐름"은 가짜

### 1.4 Plan 3 Office/HWP — calibration case (위 §0 참조)

### 1.5 Plan 3 Scan PDF OCR — ~~아키텍처 자체가 부재~~ → **resolved 2026-04-28** (`feat/plan-3-scan-pdf-ocr`)

- **(2026-04-28 리졸브)** `LLMProvider.ocr()` + `supports_ocr()` 추가, `GeminiProvider.ocr()` Vision inline image part 구현, `OllamaProvider.ocr()` 명시적 `NotImplementedError("Ollama OCR not supported. Use Gemini provider for scan PDF.")` 처리. `pdf_activity._ocr_scan_pdf`가 `pymupdf` 200dpi 렌더링 → 페이지마다 `provider.ocr()` 호출 → 페이지 단위 `unit_started`/`unit_parsed` SSE 이벤트. OCR 미지원 provider 또는 mid-loop `NotImplementedError` 시 `ApplicationError(non_retryable=True, "Scan PDF requires Gemini provider...")` — silent 빈 노트 차단. 4 신규 pytest (base 2 + gemini 2 + ollama 2 + pdf_activity 2). 잔여: 실제 스캔 PDF E2E (apps/web 업로드 UI 부재 → `/api/ingest/upload` 활성화 후 별도 follow-up).
- ~~증거~~: ~~`pdf_activity.py:18` 모듈 docstring — `"OCR for scans is **out of scope**"`~~ (제거됨)
- spec(`docs/superpowers/specs/2026-04-09-opencairn-design.md:712`)은 `provider.ocr()` 약속 → 충족
- ~~`packages/llm/src/llm/base.py`에 `ocr` 메서드 없음~~ → 추가됨
- ~~스캔 PDF는 `is_scan: True` + 빈 텍스트로 **성공 응답**~~ → 이제 OCR 텍스트 반환 또는 non-retryable 실패

---

## 2. Tier 2 — Plan 1 Foundation의 숨은 누락

Plan 1은 19 commits로 ✅, 메모리는 "Task B1 backup deferred"만 자백. 실제로는 plan 라인 21 "인프라 추가 결정" callout 통째로 누락:

| 약속한 것 | 실제 상태 | 증거 |
|---|---|---|
| `apps/api/Dockerfile` | **부재** | `find apps -name Dockerfile*` → hocuspocus + worker만 |
| `apps/web/Dockerfile` | **부재** | 동일 |
| `.github/workflows/ci.yml`, `build.yml`, Renovate, CodeQL | **`.github/` 디렉토리 자체 없음** | `ls .github` "No such file" |
| `EMAIL_PROVIDER=resend\|smtp` fallback | **미구현** | `.env.example` grep empty, `apps/api/src/lib/email.ts`는 Resend only |
| `SENTRY_DSN` env 와이어링 | **미설정** | `.env.example` grep empty (코드는 try/except로 silent no-op) |
| 인증 이메일 (verification, password reset) | **`console.log` stub** | `apps/api/src/lib/auth.ts:37-45` |
| Multi-arch buildx 셋업 | **부재** | 위 Dockerfile 부재로 자명 |
| Backup 스크립트 B1.1~B1.6 (`backup.sh`/`restore.sh`/`backup-verify.sh`, R2 업로드, retention cron) | **부재** | `ls scripts/` → canvas/plan-5/e2e helpers만 |

### 2.1 인증 이메일 stub의 심각성

`apps/api/src/lib/auth.ts:36`이 `requireEmailVerification: true`로 설정. 그런데 같은 파일 `:37-45`의 `sendResetPassword`/`sendVerificationEmail`은 둘 다 단순 `console.log`. SMTP/Resend 후크도 없음.

→ **셀프호스팅 OSS 사용자가 fresh install 후 회원가입을 끝내려면 서버 로그를 직접 봐야 함**. React Email 마이그레이션은 `invite.tsx` 1개 템플릿만 처리.

### 2.2 Dockerfile 부재의 심각성

OpenCairn 슬로건이 "Docker self-hosted"인데 api/web Dockerfile이 없음. `docker-compose.yml`이 deploy target인 프로젝트에서 두 핵심 앱의 production 이미지 빌드 경로가 없는 것.

---

## 3. Tier 3 — 자율 에이전트 약속 깨짐

### 3.1 Plan 8 (Synthesis/Curator/Connector/Staleness/Narrator) — cron 스케줄 미걸림

- Plan §Env Vars 약속:
  - `CURATOR_CRON="0 3 * * *"` (daily orphan/duplicate detection)
  - `CONNECTOR_CRON="0 4 * * 0"` (weekly cross-project links)
  - `STALE_DAYS=90`
- **실제**: 이 env들 repo 전체 grep 시 plan doc 외 0 references
- `apps/worker/src/worker/temporal_main.py`은 workflow를 등록만 하고 Temporal Schedule **생성 0**
- 결과: 5개 에이전트가 **유저가 직접 `POST /run` 때려야만** 동작
- 더 심각: `apps/web/src` grep 시 5개 에이전트 호출하는 UI 코드 **0건** (랜딩 Hero에서만 텍스트 언급) → 유저 입장에선 5개 다 dead code path
- **메모리 entry "+ UI hooks for each"는 사실 무근**

### 3.2 Agent Runtime v2 Sub-A — 인프라는 있고 사용처는 없음

- Sub-A 자체(`run_with_tools`, ToolLoopExecutor, 6 builtin tools)는 ✅ 진짜
- 그러나 Compiler/Research/Librarian (실제 product agent 3개)은 여전히 **legacy `response.text` 정규식 파싱** — Sub-A umbrella spec §0의 problem statement가 비판한 바로 그 패턴
- 유일한 consumer는 `ToolDemoAgent` (4 chat-mode preset), 4 integration tests는 `pytest.mark.skipif(not os.environ.get("GEMINI_API_KEY_CI"))` 게이트
- Sub-B/C/D/E/F/G 모두 spec/plan 미작성 (umbrella가 honestly 자백)
- `get_concept_graph.py`는 40-line 스켈레톤 (concept-relations 테이블 Sub-B로 punt)
- 메모리 "MCP client 별도 spec" 언급되지만 실제 MCP 코드 0줄

### 3.3 Agent UX Specs (humanizer + router) — 코드 0줄

- 2026-04-22 커밋 `f41b001`로 spec 2개 추가
- Plan 11A/2D가 "humanizer 연동" 약속했지만 grep `humanizer`/`model_router` in `apps/` → 0 hits
- 유일한 흔적: `apps/web/src/components/chat-scope/ChatPanel.tsx:26-28` 코멘트 "Real LLM streaming arrives in Plan 11B alongside the chip humanizer/router specs already on disk."

---

## 4. Tier 4 — Phase 5 라우트 기본 인스톨에서 404

App Shell Phase 5 메모리: "Plan Task 3·4·5 SKIP (Phase D + ingest expansion 흡수)" → 양성으로 들리지만 실제로는 모두 feature flag OFF로 인한 404.

| 라우트 | 게이트 | 기본값 | 결과 |
|---|---|---|---|
| `/research` | `FEATURE_DEEP_RESEARCH !== "true"` → `notFound()` | `false` | 404 |
| `/research/[runId]` | 동일 | `false` | 404 |
| `/import` | `FEATURE_IMPORT_ENABLED !== "true"` → `notFound()` | `false` | 404 |

추가로 `/import` 라우트는 `(shell)` 그룹 **밖**에 있어 AppShell 프레임 안에서 안 뜸 (spec §File Structure 위반).

→ fresh OSS install에서 Phase 5 헤드라인 라우트 3개가 404. Plan §"closes the visible-feature gap" 목표 미달성.

---

## 5. Tier 5 — Deep Research 거짓말 작지만 정확성 버그 누락

### 5.1 Phase C "FU-3/7/10 대기" 메모리는 truncation

실제 plans-status §45는 **FU-1~FU-13 (13개)** 열거. 코스메틱 외 정확성 버그:

| FU | 영향 |
|---|---|
| FU-6 | `POST /turns` TOCTOU sequence race |
| FU-10 | approve insert+update에 transaction 누락 → concurrent approve 시 double-insert / data loss |
| FU-11 | approve double-click guard 부재 → frontend race 시 server inconsistency |

→ 메모리 line "FU-3/7/10만 대기"는 실제 list와 매칭 안 됨, plans-status 테이블이 아닌 *상상으로 쓴* 노트로 추정.

### 5.2 Phase E BYOK key rotation 부재

- `apps/api/src/lib/integration-tokens.ts` grep `rotate|rotation` → 0 matches
- 단일 버전 암호화 키. `INTEGRATION_TOKEN_KEY` 회전 시 기존 토큰 decrypt 실패 → `users.ts:165`이 `{registered: false}` 반환 → **유저의 BYOK 키가 silent하게 사라짐**
- plans-status에 "decrypt-failure recovery returns `{registered:false}`"로 기록 — 즉 rotation = silent data loss를 *기능*으로 documented

---

## 6. Tier 6 — 메모리는 stale, 코드는 OK

| MEMORY.md 주장 | 실제 (코드 기준) | 정정 |
|---|---|---|
| Live Ingest Visualization "feat/live-ingest-visualization (worktree, 미머지)" | PR #56 merge `588300e` | main에 있음, 메모리 entry 갱신 필요 |
| Deep Research Phase E "PR opened" | PR #46 merge `86bd3e8` | 머지 완료, 메모리 entry 갱신 필요 |
| Plan 3b "MAX_ITEMS split 미결" | `batch_submit.py:74` `_chunk_inputs` 이미 shipped | gap 닫힘, 메모리 entry 갱신 필요 |

---

## 7. Tier 7 — E2E "execution deferred"가 4-plan-deep 컨벤션

| 플랜 | 증거 | 메모 |
|---|---|---|
| App Shell Phase 1 | `app-shell-phase1.spec.ts` 존재, CI 안 돎 | "deferred from CI until parallel dev/api server fixture lands" |
| App Shell Phase 3-A | `tab-system.spec.ts:18` | 동일 사유 |
| App Shell Phase 3-B | `routes.spec.ts:9` | "Execution deferred (Phase 4 convention)" |
| App Shell Phase 4 | `agent-panel.spec.ts` | 스펙은 있지만 stub echo 자체를 검증 |
| Plan 7 Phase 2 | `canvas-phase-2.spec.ts:34-35` | 5/7 `test.skip(true, REQUIRES_FULL_STACK)` |
| Plan 2D | `plan-2d-save-suggestion.spec.ts:27-29` | "deferred to CI full-stack runs" |
| Onboarding | `onboarding-*.spec.ts` 4 specs | "병렬 dev 서버 이슈로 실행 deferred" |

→ "parallel dev/api server fixture" 추적 이슈 0건. **컨벤션이 institutionalized됨** — E2E 스펙은 쓰는데 절대 안 돎.

---

## 8. Tier 1 외 추가로 발견된 stub/skip

- **Ollama provider 도구 호출 미지원** (`packages/llm/src/llm/ollama.py:105-117`) — `supports_tool_calling()=False`, `generate_with_tools` raises. 의도된 것이지만 "Multi-LLM 지원" 카피로는 오해 소지
- **Hocuspocus E2E (`collab.spec.ts:14-22`)** — 자동 스폰 안 됨, CI에서 silent fail
- **Phase 9a `sitemap.ts:7`** — `ko` URL만 emit. EN은 robots.txt에서 Disallow. 메모리 "78 keys parity"가 EN deployable 의미는 아님
- **Onboarding E2E** — 스펙은 있는데 실행은 deferred로 메모리에만 남고 추적 없음

---

## 9. 거짓말이 아닌데 경계가 흐릿한 케이스

- **Plan 11A 코드 자체는 "PR #54 SSE는 placeholder, 실제 LLM은 Plan 11B에서"라고 자백** — 메모리 표현은 정확. 그러나 **plans-status.md의 ✅ Plan 11A 표기 + 카피·UI의 광고 행위가 합쳐져 production 시점에서는 거짓말과 동치**가 됨
- 같은 패턴: 2D save_suggestion, Phase 4 Agent Panel — 모두 stub임을 자백한 메모리 + 광고하는 UI 조합

---

## 10. 정직한 한 줄 결론

> **OpenCairn은 production에서 실제 LLM이 호출되는 user-facing 경로가 0개**. Phase 4 Agent Panel · 11A chat · 2D save_suggestion · Plan 8 의 5개 자동 에이전트 — 모두 stub·placeholder·manual-trigger-only이거나 cron 스케줄이 안 걸려 있음. 12 에이전트 중 *사용자가 fresh install 후 1초 안에 실제 동작을 체감할 수 있는* 에이전트는 0개.

랜딩 카피("AI 기반 개인+팀 지식 OS, 12 에이전트")가 셀프호스팅 OSS 사용자가 받는 첫 경험과 충돌. 채팅에 뭘 보내면 `(stub agent response to: 안녕)` 응답이 나옴.

---

## 11. 우선순위 제안 (severity-ordered)

| 순위 | 작업 | 이유 |
|---|---|---|
| 1 | Tier 1 #1+#2 동시 처리: `runAgent`에 real LLM 연결 (Plan 11B Phase A 실행). Plan 11A placeholder + Phase 4 stub 동시 제거 | 광고하는 제품과 실제 제품 일치. 모든 "AI" 카피의 신뢰성 회복 |
| 2 | Tier 2 #2.1: 인증 이메일 stub 제거 (Resend 직결 또는 SMTP fallback 구현) | 셀프호스팅 인스톨 시 회원가입 자체가 broken |
| 3 | Tier 2 #2.2: `apps/api/Dockerfile` + `apps/web/Dockerfile` 작성, CI/CD 추가 | "Docker self-hosted" 슬로건의 최소 충족 |
| 4 | Tier 3 #3.1: Plan 8 cron 스케줄 + UI 노출 | "12 에이전트" 슬로건 충족 / dead code path 제거 |
| 5 | Tier 1 #4: HWP/Office 파서 (원래 A 옵션) | 카피 광고 일치. spec대로 markitdown + unoserver + H2Orestart |
| 6 | Tier 5 #5.1: Phase C FU-6/10/11 (TOCTOU + transaction + double-click guard) | 정확성 버그 |
| 7 | Tier 4: Phase 5 라우트 기본값 ON 또는 카피·메뉴에서 hide | 404 헤드라인 라우트 제거 |
| 8 | Tier 5 #5.2: BYOK key rotation 지원 | silent data loss 제거 |
| 9 | Tier 6: 메모리 정정 (Live Ingest Viz / Phase E / Plan 3b) | 다음 세션이 같은 거짓말 안 하기 위한 위생 |
| 10 | Tier 7: E2E parallel dev/api server fixture 작성, 컨벤션 회수 | 4-plan-deep 관행 종식 |

## 12. 이 audit의 다음 단계

이 문서를 박제해두는 이유: **다음 세션이 plans-status.md만 보고 "Phase 4 ✅ done"이라고 답변하면 다시 같은 거짓말 시작**. 새 세션 시작 시 이 문서를 의무적으로 참조할 수 있도록 `MEMORY.md` 인덱스에 추가하고, 위 우선순위 1~3 작업이 완료되면 해당 Tier 항목을 closed로 마킹.

상위 Tier 항목이 다 닫히기 전까지 **랜딩 카피·README의 "12 에이전트" / "AI 채팅" 광고 표현 검토** 권장.

---

### Update (2026-04-28 — Plan 11B Phase A second commit)

- Tier 1 #1 (Phase 4 stub) — **CLOSED** in `<merge-sha>`. `agent-pipeline.ts:39` echo replaced with `chat-llm.runChat()` call; `chat_messages.token_usage` persisted from provider-reported numbers; `provider="gemini"`. Real-LLM integration test at `apps/api/tests/threads-real-llm.test.ts`.
- Tier 1 #2 (11A placeholder) — **CLOSED** in `<merge-sha>`. `chat.ts /message` body rewritten; provider-reported tokens drive `conversation_messages.tokensIn`/`tokensOut` and conversation totals. `LLMNotConfiguredError` maps to SSE `event: error\ndata: {code: "llm_not_configured"}` instead of the prior placeholder echo. Real-LLM integration test at `apps/api/tests/chat-real-llm.test.ts`.
- Tier 1 #3 (env-gated save_suggestion) — **CLOSED** in `<merge-sha>`. `AGENT_STUB_EMIT_SAVE_SUGGESTION` removed from `.env.example`, `playwright.config.ts`, and the codepath in `agent-pipeline.ts`. Producer is now LLM fence parser (`apps/api/src/lib/save-suggestion-fence.ts`). LLM emits the fence opportunistically; the renderer + `meta.save_suggestion` wire (already correct from Plan 2D) stays unchanged.
- Coverage gap tracked as Plan 11B-A follow-up: E2E specs (`agent-panel.spec.ts`, `chat-scope.spec.ts`, `plan-2d-save-suggestion.spec.ts`) marked `test.skip` until a deterministic Gemini mock fixture is added.
- Manual `pnpm dev` smoke is the user's acceptance check (Task 11 step 3-7) and is not part of the test suite.
