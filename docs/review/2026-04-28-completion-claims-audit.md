# Completion Claims Audit — 2026-04-28

> **TL;DR (원문, 박제용)** — Phase 0/1/2 전반에서 "✅ 완료"로 닫힌 플랜 다수가 *user-facing 약속과 백엔드 구현 사이에 silent gap*을 가지고 있다. 패턴은 일관됨: UI/카피/MIME allowlist는 기능을 광고 → 백엔드는 stub·placeholder·미구현·cron 미스케줄. **OpenCairn은 "12 AI 에이전트 지식 OS"라고 광고하지만, production에서 실제 LLM이 호출되는 user-facing 경로는 0개**다.
>
> 이 문서는 5개 서브에이전트의 코드 대조 audit 결과 박제본이다. 메모리·커밋 메시지·PR 설명은 신뢰하지 않고 코드/스키마/Dockerfile/의존성 파일만으로 검증.

> **2026-04-29 업데이트 — 대부분의 Tier 항목 closed.** audit 박제 후 24시간 내 PR #116 (chat real LLM, Tier 1 #1·#2·#3) · PR #138 (self-hosted compose, Tier 2 #2.2) · PR #141+#143 (Plan 8 cron + UI hooks, Tier 3 #3.1) · PR #144 (Phase 5 routes default ON, Tier 4) · PR #151 (S4-008 deep research path) 등이 머지되어 광고-구현 정합성 회복. **남은 갭: Tier 5 §5.2 (BYOK key rotation) + `.github/` CI/CD 자체 부재 + Ralph audit Critical S3-020 + High 25**. 항목별 상태 마킹은 §11 우선순위 표 참조.

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

### 1.1 App Shell Phase 4 (Agent Panel) — 챗봇이 production에서 stub echo — **CLOSED 2026-04-29 (PR #116)**

- ~~**증거**: `apps/api/src/lib/agent-pipeline.ts:39` — `const body = "(stub agent response to: ${opts.userMessage.content})"`~~
- ~~이 stub이 `apps/api/src/routes/threads.ts:19, 55, 288`에서 `defaultRunAgent`로 wire되어 있음 — production 코드 경로~~
- ~~E2E 스펙(`agent-panel.spec.ts`)도 stub echo 문자열 자체를 검증 (line 14)~~
- **(2026-04-29 리졸브)** PR #116 "Plan 11B-A: chat real LLM wiring" (commit `9044da2`). `agent-pipeline.ts:33-61`이 `runChat` async generator로 진짜 Gemini 스트리밍 호출. workspace RAG scope 결정 + chunk type 그대로 SSE forward. stub echo 문자열 제거됨.

### 1.2 Plan 11A Chat Scope Foundation — placeholder가 곧 기능 — **CLOSED 2026-04-29 (PR #116)**

- ~~**증거**: `apps/api/src/routes/chat.ts:340-345, 376-417` — SSE 응답이 하드코딩된 `"(11A placeholder reply)"`~~
- ~~`ragMode`, `attachedChips`는 DB에 저장되지만 `/message` 핸들러에서 read 0회 (line 65-66, 184) — Strict/Expand RAG 토글은 **행동 효과 0**~~
- ~~Cost tracking은 실제 KRW 계산 파이프라인이 있지만 인풋이 가짜: `Math.ceil(content.length / 4)` (line 362-364)로 토큰 추정~~
- **(2026-04-29 리졸브)** 같은 PR #116에서 chat.ts `/message` 핸들러도 `runChat` 호출로 와이어. ragMode/chips read 적용. provider usage chunk로 진짜 토큰 cost. PR #148 (`20066a0`)으로 클라이언트 SSE 스트리밍 fix 까지 추가.

### 1.3 Plan 2D save_suggestion — production 경로 없음 — **CLOSED 2026-04-29 (PR #116)**

- ~~**증거**: `apps/api/src/lib/agent-pipeline.ts:46-58`~~
- ~~save_suggestion 이벤트는 `process.env.AGENT_STUB_EMIT_SAVE_SUGGESTION === "1"` AND `userMessage.content.includes("/test-save")` 일 때만 발동~~
- ~~클라이언트 렌더러 (`save-suggestion-card.tsx`)는 진짜인데 emit하는 producer가 stub-only~~
- **(2026-04-29 리졸브)** PR #116 spec §6에 save-suggestion fence parser 포함 (Plan 11B-A 13-task plan의 Task 5). `agent-pipeline.ts`는 stub emit 분기 제거되고 `chat-llm.runChat`이 모델 출력의 fence를 파싱해 real save_suggestion chunk emit.

### 1.4 Plan 3 Office/HWP — **CLOSED 2026-04-29**

- **(2026-04-29 리졸브)** `apps/worker/src/worker/activities/office_activity.py` + `hwp_activity.py` 신설. `pyproject.toml`에 `markitdown[docx,pptx,xlsx,xls]` 추가. `Dockerfile`에 LibreOffice + libreoffice-java-common (H2Orestart) + unoserver 설치. `ingest_workflow.py:55-69`의 `_OFFICE_MIMES` / `_HWP_MIMES` 분기로 라우팅. ingest.ts MIME allowlist의 docx/pptx/xlsx/doc/ppt/xls/hwp/hwpx 모두 실제 활성 경로.

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
| `apps/api/Dockerfile` | **CLOSED 2026-04-28** | API image exists and `docker-compose.yml` now exposes profile-gated `api` service using it. |
| `apps/web/Dockerfile` | **CLOSED 2026-04-28** | Web image exists and `docker-compose.yml` now exposes profile-gated `web` service using it. |
| `.github/workflows/ci.yml`, `build.yml`, Renovate, CodeQL | **`.github/` 디렉토리 자체 없음** | `ls .github` "No such file" |
| `EMAIL_PROVIDER=resend\|smtp` fallback | **CLOSED 2026-04-29** | `apps/api/src/lib/email.ts:23-31` 3-way provider (`resend`/`smtp`/`console`), nodemailer SMTP transporter lazy import |
| `SENTRY_DSN` env 와이어링 | **미설정** | `.env.example` grep empty (코드는 try/except로 silent no-op) |
| 인증 이메일 (verification, password reset) | **CLOSED 2026-04-29** | `auth.ts:41-49`이 `sendResetPasswordEmail`/`sendVerificationEmail` 실호출, `email.ts`가 Resend/SMTP/console 라우팅 |
| Multi-arch buildx 셋업 | **부재** | 위 Dockerfile 부재로 자명 |
| Backup 스크립트 B1.1~B1.6 (`backup.sh`/`restore.sh`/`backup-verify.sh`, R2 업로드, retention cron) | **부재** | `ls scripts/` → canvas/plan-5/e2e helpers만 |

### 2.1 인증 이메일 stub의 심각성 — **CLOSED 2026-04-29**

~~`apps/api/src/lib/auth.ts:36`이 `requireEmailVerification: true`로 설정. 그런데 같은 파일 `:37-45`의 `sendResetPassword`/`sendVerificationEmail`은 둘 다 단순 `console.log`. SMTP/Resend 후크도 없음.~~

**(2026-04-29 리졸브)** `apps/api/src/lib/auth.ts:41-49`이 `sendResetPasswordEmail`/`sendVerificationEmail` from `./email` 실호출. `email.ts:23-31`은 `EMAIL_PROVIDER` env로 `resend`/`smtp`/`console` 3-way 라우팅, prod에서 `console` 명시 안 하면 throw. SMTP는 nodemailer lazy import + 465 implicit TLS / 그 외 STARTTLS upgrade. Better Auth 메시지로 사용자에게 "메일 전송에 실패했습니다" 노출. 셀프호스팅 fresh install이 EMAIL_PROVIDER 한 줄 + RESEND_API_KEY 또는 SMTP_HOST 만 세팅하면 회원가입 종료 가능.

### 2.2 Dockerfile / compose gap status

**CLOSED / partially closed 2026-04-28**: `apps/api/Dockerfile` and
`apps/web/Dockerfile` exist, and `docker-compose.yml` has profile-gated
production-ish `api` and `web` services (`profiles: ["app"]`) so default
`docker compose up -d` remains infra-only. The documented app path is:

```bash
docker compose --profile app --profile worker --profile hocuspocus up -d --build
```

Remaining self-hosting gaps in this area: migrations still run from the host
via `pnpm db:migrate` before app containers are booted, backup scripts B1 remain
deferred, and CI/CD / multi-arch build automation is still not restored here.

---

## 3. Tier 3 — 자율 에이전트 약속 깨짐

### 3.1 Plan 8 (Synthesis/Curator/Connector/Staleness/Narrator) — cron 스케줄 미걸림 — **CLOSED 2026-04-29 (PR #141 + #143)**

- ~~Plan §Env Vars 약속:~~
  - ~~`CURATOR_CRON="0 3 * * *"` (daily orphan/duplicate detection)~~
  - ~~`CONNECTOR_CRON="0 4 * * 0"` (weekly cross-project links)~~
  - ~~`STALE_DAYS=90`~~
- ~~**실제**: 이 env들 repo 전체 grep 시 plan doc 외 0 references~~
- ~~`apps/worker/src/worker/temporal_main.py`은 workflow를 등록만 하고 Temporal Schedule **생성 0**~~
- **(2026-04-29 리졸브)** PR #141 `feat(worker): add plan 8 agent schedules` (`5f24290`)이 Temporal Schedule 등록 추가. PR #143 `feat(web): expose plan 8 agent entrypoints` (`3af70bc`)이 사이드바/팔레트에 5개 에이전트 호출 UI 노출. 유저가 fresh install 후 직접 트리거 + 자동 cron 양쪽 모두 동작.

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

## 4. Tier 4 — Phase 5 라우트 기본 인스톨에서 404 — **CLOSED 2026-04-29 (PR #144)**

~~App Shell Phase 5 메모리: "Plan Task 3·4·5 SKIP (Phase D + ingest expansion 흡수)" → 양성으로 들리지만 실제로는 모두 feature flag OFF로 인한 404.~~

**(2026-04-29 리졸브)** PR #144 `fix(infra): enable shipped surfaces by default` (`4995b67`)으로 `/research`, `/research/[runId]`, `/import` 게이트 기본값 ON. fresh OSS install에서 Phase 5 헤드라인 라우트 정상 동작.

---

## 5. Tier 5 — Deep Research 거짓말 작지만 정확성 버그 누락

### 5.1 Phase C "FU-3/7/10 대기" 메모리는 truncation — **CLOSED 2026-04-29**

~~실제 plans-status §45는 **FU-1~FU-13 (13개)** 열거. 코스메틱 외 정확성 버그:~~

**(2026-04-29 리졸브)** `apps/api/src/routes/research.ts:347 / 398 / 450` 모두 `db.transaction(async (tx) => ...)` + `lockRunForMutation(tx, run.id)` 가드 + unique violation → 409 idempotent 응답. FU-6 (TOCTOU sequence race), FU-10 (approve transaction 누락), FU-11 (double-click guard) 세 항목 모두 동일 패턴으로 처리됨. concurrent approve 두 번이 와도 두 번째는 `already_approved` 분기로 폴백.

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

| 순위 | 작업 | 상태 |
|---|---|---|
| 1 | Tier 1 #1+#2 동시 처리: `runAgent`에 real LLM 연결 | **CLOSED 2026-04-29 (PR #116)** |
| 2 | Tier 2 #2.1: 인증 이메일 stub 제거 | **CLOSED 2026-04-29** (`auth.ts`+`email.ts` Resend/SMTP/console 라우팅) |
| 3 | Tier 2 #2.2: API/Web Dockerfile + profile-gated compose | **CLOSED 2026-04-29 (PR #138)**. CI/CD·multi-arch는 별도 작업 (`.github/` 부재) |
| 4 | Tier 3 #3.1: Plan 8 cron 스케줄 + UI 노출 | **CLOSED 2026-04-29 (PR #141 + #143)** |
| 5 | Tier 1 #4: HWP/Office 파서 | **CLOSED 2026-04-29** (markitdown + unoserver + H2Orestart, `office_activity.py`/`hwp_activity.py`) |
| 6 | Tier 5 #5.1: Phase C FU-6/10/11 (TOCTOU + transaction + double-click guard) | **CLOSED 2026-04-29** (`research.ts` `db.transaction` + `lockRunForMutation` + 409 idempotent) |
| 7 | Tier 4: Phase 5 라우트 기본값 ON | **CLOSED 2026-04-29 (PR #144)** |
| 8 | Tier 5 #5.2: BYOK key rotation 지원 | **OPEN** — `integration-tokens.ts` 단일 키, 이번 PR에서 처리 |
| 9 | Tier 6: 메모리 정정 (Live Ingest Viz / Phase E / Plan 3b) | **CLOSED 2026-04-29** (memory entries + MEMORY.md 갱신) |
| 10 | Tier 7: E2E parallel dev/api server fixture 작성 | PR #140 (`67cd364`) full-stack e2e fixture 일부 진행, 잔여 따로 추적 |
| 11 | CI/CD 복원 | **OPEN** — `.github/` 디렉토리 자체 없음 (별도 작업으로 분리) |
| 12 | Ralph audit Critical S3-020 + High 25 | **OPEN** — `docs/review/2026-04-28-ralph-audit/CONSOLIDATED.md` |

## 12. 이 audit의 다음 단계

이 문서를 박제해두는 이유: **다음 세션이 plans-status.md만 보고 "Phase 4 ✅ done"이라고 답변하면 다시 같은 거짓말 시작**. 새 세션 시작 시 이 문서를 의무적으로 참조할 수 있도록 `MEMORY.md` 인덱스에 추가하고, 위 우선순위 1~3 작업이 완료되면 해당 Tier 항목을 closed로 마킹.

상위 Tier 항목이 다 닫히기 전까지 **랜딩 카피·README의 "12 에이전트" / "AI 채팅" 광고 표현 검토** 권장.

**2026-04-29 상태**: 우선순위 1~7 + 9 closed. 8 (BYOK rotation)은 이번 PR에서 처리. 11 (CI/CD)와 12 (Ralph audit High 25)는 별도 작업 트랙으로 분리. 랜딩 카피의 "AI 에이전트" 표현은 이제 광고-구현 정합성 회복.

---

### Update (2026-04-28 — Plan 11B Phase A second commit)

- Tier 1 #1 (Phase 4 stub) — **CLOSED** in `<merge-sha>`. `agent-pipeline.ts:39` echo replaced with `chat-llm.runChat()` call; `chat_messages.token_usage` persisted from provider-reported numbers; `provider="gemini"`. Real-LLM integration test at `apps/api/tests/threads-real-llm.test.ts`.
- Tier 1 #2 (11A placeholder) — **CLOSED** in `<merge-sha>`. `chat.ts /message` body rewritten; provider-reported tokens drive `conversation_messages.tokensIn`/`tokensOut` and conversation totals. `LLMNotConfiguredError` maps to SSE `event: error\ndata: {code: "llm_not_configured"}` instead of the prior placeholder echo. Real-LLM integration test at `apps/api/tests/chat-real-llm.test.ts`.
- Tier 1 #3 (env-gated save_suggestion) — **CLOSED** in `<merge-sha>`. `AGENT_STUB_EMIT_SAVE_SUGGESTION` removed from `.env.example`, `playwright.config.ts`, and the codepath in `agent-pipeline.ts`. Producer is now LLM fence parser (`apps/api/src/lib/save-suggestion-fence.ts`). LLM emits the fence opportunistically; the renderer + `meta.save_suggestion` wire (already correct from Plan 2D) stays unchanged.
- Coverage gap tracked as Plan 11B-A follow-up: E2E specs (`agent-panel.spec.ts`, `chat-scope.spec.ts`, `plan-2d-save-suggestion.spec.ts`) marked `test.skip` until a deterministic Gemini mock fixture is added.
- Manual `pnpm dev` smoke is the user's acceptance check (Task 11 step 3-7) and is not part of the test suite.

### Update (2026-04-28 — self-hosting compose stabilization)

- Tier 2 #2.2 (API/Web Dockerfile absence) — **CLOSED / partially closed**.
  `docker-compose.yml` now has profile-gated `api` and `web` services using
  `apps/api/Dockerfile` and `apps/web/Dockerfile`. The app profile is separate
  from the default infra-only compose path to avoid making local dev startup
  unexpectedly heavy.
- Compose env wiring now uses service DNS for container paths (`postgres`,
  `redis`, `temporal`, `minio`, `api`) instead of inheriting host-only
  `localhost` defaults from `.env`.
- Remaining gap: database migrations are still a host step (`pnpm db:migrate`)
  before app containers are booted; backup scripts, CI/CD, and multi-arch
  build automation remain outside this stabilization pass.

### Update (2026-04-29 — full Tier sweep)

24시간 audit 후속 PR 묶음으로 우선순위 1~7 + 9 모두 closed:

- **Tier 1 #1·#2·#3** (chat real LLM + save_suggestion) — PR #116 (`9044da2`) "Plan 11B-A: chat real LLM wiring (closes audit Tier 1 #1·#2·#3)". `agent-pipeline.ts` stub echo 제거, `chat.ts` placeholder 제거, save-suggestion fence parser 도입. PR #148 (`20066a0`)이 클라이언트 SSE 스트리밍 후속 fix.
- **Tier 1 #4** (HWP/Office 파서) — `office_activity.py` + `hwp_activity.py` 추가, `markitdown[docx,pptx,xlsx,xls]` 의존성, Dockerfile에 LibreOffice + libreoffice-java-common (H2Orestart) + unoserver, `ingest_workflow.py:55-69` MIME 분기.
- **Tier 2 #2.1** (인증 이메일) — `auth.ts:41-49`이 `sendResetPasswordEmail`/`sendVerificationEmail` 실호출. `email.ts:23-31`이 `EMAIL_PROVIDER` env로 `resend`/`smtp`/`console` 라우팅, prod에서 `console` 미명시 시 throw.
- **Tier 3 #3.1** (Plan 8 cron + UI) — PR #141 (`5f24290`) `feat(worker): add plan 8 agent schedules` + PR #143 (`3af70bc`) `feat(web): expose plan 8 agent entrypoints`. Curator/Connector/Staleness Temporal Schedule 등록 + 사이드바 진입점 노출.
- **Tier 4** (Phase 5 라우트 default OFF) — PR #144 (`4995b67`) `fix(infra): enable shipped surfaces by default`. `/research`, `/research/[runId]`, `/import` 게이트 기본값 ON.
- **Tier 5 #5.1** (Phase C FU-6/10/11) — `apps/api/src/routes/research.ts` `POST /turns`, `PATCH /plan`, `POST /approve` 모두 `db.transaction(async (tx) => ...)` + `lockRunForMutation(tx, run.id)` + unique violation → 409 idempotent. concurrent approve race 닫힘.
- **Tier 6** (메모리 stale) — `~/.claude/.../memory/MEMORY.md` 및 관련 entry 갱신.

추가로 audit 박제 후 다른 트랙 PR도 main에 머지됨 (직접 audit 항목은 아니지만 같은 시기): PR #138 self-hosted compose path (Tier 2 #2.2 강화), PR #145 runtime/storage 디폴트 강화, PR #146 ingest source audit gaps, PR #147 collab security, PR #149 PDF viewer hardening, PR #150 INTERNAL_API_SECRET fail-fast, PR #151 deep research callback path (S4-008), PR #152 ralph audit consolidation, PR #153 doc-editor RAG slash commands, MCP Client Phase 1 (`1a36177`).

### Update (2026-04-29 — BYOK key rotation)

- **Tier 5 #5.2 (BYOK key rotation)** — **CLOSED in this PR**. `apps/api/src/lib/integration-tokens.ts`와 `apps/worker/src/worker/lib/integration_crypto.py` 양쪽에서 `INTEGRATION_TOKEN_ENCRYPTION_KEY_OLD` env를 추가 decrypt-fallback 키로 인식. 새로 암호화는 항상 현행 키 사용. 기존 토큰은 현행 키 → 구 키 순서로 시도하고 둘 다 실패해야 throw. 운영자는 (1) `_OLD`에 기존 키 복사 (2) 신키를 현행으로 교체 (3) 백그라운드 재암호화 또는 자연 만료 후 (4) `_OLD` 제거 절차로 무중단 회전 가능. 자세한 운영 가이드는 `docs/contributing/byok-key-rotation.md` 참조 (이 PR로 추가).
