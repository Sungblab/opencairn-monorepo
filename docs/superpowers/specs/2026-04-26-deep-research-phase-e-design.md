# Deep Research Phase E — BYOK Settings · E2E Activation · Prod Release

**Status:** Draft (2026-04-26)
**Owner:** Sungbin
**Branch:** `feat/deep-research-phase-e` (off `main` HEAD `f72044f`)
**Worktree:** `.worktrees/deep-research-phase-e`

**Related:**

- [2026-04-22-deep-research-integration-design.md](./2026-04-22-deep-research-integration-design.md) — umbrella spec (§7 Access & Billing, §8 Rollout, §11 Open Questions)
- [2026-04-25-deep-research-phase-d-web.md](../plans/2026-04-25-deep-research-phase-d-web.md) — Phase D plan (Phase D Constraints §5: BYOK 등록 UI는 Phase E로 명시 위임)
- [api-contract.md](../../architecture/api-contract.md) — Zod + requireAuth + workspace scope rules
- [llm-antipatterns.md](../../contributing/llm-antipatterns.md) — Plate v49 등 함정 모음

**Memory-driven principles:**

- BYOK 경로 게이팅 금지 — 월 사용 횟수 / 모델 제한 등 선제 차단 안 함 (`feedback_byok_cost_philosophy`)
- LLM provider 선택은 env-only — 온보딩 / 설정 UI 어디에도 provider/model 토글 노출 금지 (`feedback_llm_provider_env_only`)
- 한국어 카피 톤 — 존댓말, 경쟁사 직접 언급 금지, 기술 스택 상세 최소화 (`feedback_opencairn_copy`)

## Dependencies

- **Phase A** ✅ — `packages/llm` Interactions wrapper (PR #2/#4)
- **Phase B** ✅ — DB migration 0013 + Temporal workflow + 4 activities (PR #3)
- **Phase C** ✅ — `apps/api/src/routes/research.ts` 8 endpoints + SSE (PR #6/#7/#8/#9)
- **Phase D** ✅ — `/research` UI + Plate `research-meta` block (PR #32)
- **Plan 13** — `user_preferences.byokApiKeyEncrypted` 컬럼 (이미 마이그레이트됨)
- **Plan 1** — Better Auth + `requireAuth` 미들웨어
- **Plan 9a** — i18n parity 인프라 (`pnpm --filter @opencairn/web i18n:parity`)

---

## 1. Problem

Phase A~D는 모두 머지됐지만 두 가지 이유로 사용자에게 노출되지 못한다:

1. **사용자가 Gemini API 키를 등록할 수단이 없음** — `user_preferences.byokApiKeyEncrypted` 컬럼은 존재하나 UI도 API 엔드포인트도 없다. 워커가 `KeyResolutionError("no byok key registered")`로 fail-fast하지만 사용자에게는 "키를 등록하세요" CTA만 있을 뿐 실제 등록 화면이 404다 (Phase D에서 의도적으로 deferred — 해당 plan §5 Constraints 5번).
2. **`FEATURE_DEEP_RESEARCH` 플래그가 기본 off** — 머지된 코드는 라우트/사이드바/E2E 모두 플래그 뒤에 숨어 있다. `research-smoke.spec.ts`도 플래그가 켜지지 않으면 `test.skip`으로 빠진다 (해당 spec L25-28).

**Phase E의 목표는 두 빈틈을 한 번에 메우고, prod 환경에서 플래그 flip 한 줄로 출시 가능한 상태로 만드는 것이다.**

---

## 2. Goals & Non-Goals

### Goals (Phase E)

1. **`/[locale]/app/settings/ai` 페이지** — BYOK Gemini 키 등록 폼 (등록 / 마스킹 표시 / 교체 / 삭제). 기존 `ResearchRunView.tsx:103`의 `error.invalid_byok_cta` 링크가 가리키는 그 경로.
2. **`/api/users/me/byok-key` 3 엔드포인트** — GET 상태 / PUT 등록 / DELETE 제거. 기존 `apps/api/src/lib/integration-tokens.ts`의 `encryptToken`/`decryptToken` 재사용 (워커 측 `decrypt_token`과 wire 호환 보장됨).
3. **`research-smoke.spec.ts` CI 활성화** — Playwright runner의 `webServer.env`에 `FEATURE_DEEP_RESEARCH=true` 주입. 현재 skip 컨디션을 풀고 실제로 돌게.
4. **`settings-ai.spec.ts` 신규** — BYOK 등록 → 마스킹 표시 → 교체 → 삭제 플로우 E2E.
5. **en native review** — `messages/en/research.json` (Phase D에서 batch 번역됨, 78 키) + 신규 `messages/en/settings.json` 카피 톤 정리. 존댓말 등가물 / 경쟁사 미언급 / 기술 스택 상세 최소화 (`feedback_opencairn_copy.md`).
6. **`plans-status.md` 업데이트** — "Deep Research Phase E (features)" 항목 완료 마킹.

### Non-Goals (명시적으로 범위 밖)

- **`/settings/billing` 스텁 페이지** — Phase D `ResearchRunView.tsx:111`에 링크가 있으나 트리거 조건은 `error.code === "managed_credits_short"`이고, 이는 `FEATURE_MANAGED_DEEP_RESEARCH=true`일 때만 발생. 본 spec은 해당 플래그를 계속 false로 유지하므로 이 링크는 절대 트리거되지 않는다. Plan 9b 본격 시점에 별도 페이지 추가.
- **`/settings` 허브 / `/settings/profile`** — sidebar-footer가 후자를 가리키지만 페이지가 없다 (사전 빈틈). 본 spec은 다루지 않는다 (YAGNI). 미래의 Settings hub plan에서 같이.
- **sidebar-footer 변경** — 기존 Settings 아이콘은 `/app/w/[wsSlug]/settings`로 가는 별개 경로. AI 설정 진입점은 (a) Research hub에서 BYOK 미등록 시 CTA, (b) ResearchRunView 에러 시 CTA, (c) 직접 URL 세 군데로 충분. footer에 새 아이콘을 끼워넣지 않는다.
- **BYOK 키 라이브 검증** — 저장 시 Gemini API ping은 안 한다. spec §6.1 워커 fail-fast 계약 유지. 사용자가 잘못된 키를 등록하면 첫 리서치 실행 시 `error.code: "invalid_byok_key"` SSE 이벤트로 즉각 피드백된다.
- **provider/model 선택 UI** — `feedback_llm_provider_env_only` 메모리. provider/model은 서버 env에서만 결정, UI에 노출하지 않는다.
- **prod flag flip을 본 PR에 포함** — PR1은 features only. 머지 후 staging 수동 검증 → prod env `FEATURE_DEEP_RESEARCH=true` 한 줄 추가 (PR 아님). 코드와 출시 결정을 분리해 롤백 안전.
- **마이그레이션** — DB 스키마 변경 없음. `byokApiKeyEncrypted` (Plan 13의 마이그레이션 0013) 그대로 사용.
- **사이드바 Deep Research 아이콘 활성화 시점** — 이건 이미 Phase D에서 `FEATURE_DEEP_RESEARCH` 게이트로 처리됨. 본 spec은 해당 동작을 추가로 건드리지 않는다.

---

## 3. Architecture

```
┌────────────────────────────────┐     REST     ┌─────────────────────────────┐
│ apps/web                        │ ───────────▶ │ apps/api/src/routes/users.ts│
│ /app/settings/ai                │              │ (기존 라우터 확장)          │
│ ├ <SettingsAiPage> (Server)     │              │ ├ GET    /me/byok-key       │
│ │  └ <SettingsAiClient>         │              │ ├ PUT    /me/byok-key       │
│ │     └ <ByokKeyCard>           │              │ └ DELETE /me/byok-key       │
│ │        - TanStack Query       │              └────────────┬────────────────┘
│ │        - useMutation          │                           │
│ └ messages/{ko,en}/settings.json│                           │ encryptToken /
└────────────────────────────────┘                           │ decryptToken
                                                              │ (integration-tokens.ts)
                                                              ▼
                                              ┌────────────────────────────────┐
                                              │ packages/db                    │
                                              │ user_preferences               │
                                              │ .byokApiKeyEncrypted (bytea)   │
                                              └────────────────────────────────┘
                                                              ▲
                                                              │ worker activity
                                                              │ (read-only,
                                                              │  resolve_api_key)
                                              ┌───────────────┴────────────────┐
                                              │ apps/worker (변경 없음)        │
                                              │ activities/deep_research/keys.py│
                                              └────────────────────────────────┘
```

### 경계 원칙

- **`apps/api`만 키 쓰기** — 워커는 read-only (`db_readonly.py`). 본 spec은 워커 코드를 건드리지 않는다.
- **encryptToken/decryptToken 재사용** — `INTEGRATION_TOKEN_ENCRYPTION_KEY` 한 개의 키링이 OAuth 토큰과 BYOK 키 양쪽을 담당. wire 포맷(`iv(12) || tag(16) || ct`)이 워커 `decrypt_token`과 byte 호환임이 보장됨 (`integration-tokens.ts` 헤더 주석에 명시되어 있음).
- **lastFour는 read-time 계산** — 별도 컬럼 추가 안 함. 단일 사용자 read에서 decrypt 1회 비용 무시 가능. 별도 컬럼은 일관성 부담만 늘림.
- **`apps/web`은 `proxy.ts` 경유** — 직접 fetch 금지, TanStack Query + `api-client-byok-key.ts` (신규 작은 모듈).

---

## 4. Components & Data Model

### 4.1 DB

**스키마 변경 없음.** 기존 컬럼 사용:

```typescript
// packages/db/src/schema/user-preferences.ts:23 (이미 존재)
byokApiKeyEncrypted: bytea("byok_api_key_encrypted"),
```

### 4.2 API Contract (Zod)

```typescript
// apps/api/src/routes/users.ts (확장)
const setByokKeySchema = z.object({
  apiKey: z
    .string()
    .min(20, { message: "too_short" })
    .max(200, { message: "too_long" })
    .startsWith("AIza", { message: "wrong_prefix" }),
});

// 응답 타입 (discriminated union — lastFour는 registered: true일 때만 존재)
type ByokKeyStatus =
  | { registered: false }
  | { registered: true; lastFour: string; updatedAt: string };
```

**에러 응답 형식:** Zod 검증 실패 시 `{ error: "invalid_input", code: "too_short" | "too_long" | "wrong_prefix" }` 형태로 단일 사유만 반환 (Zod는 첫 번째 issue를 채택). i18n에서 `code`로 분기.

**검증 정책 메모:** `startsWith("AIza")`는 Google이 현재 발급하는 모든 Gemini API 키 prefix. 더 엄격한 정규식(`^AIza[0-9A-Za-z_\-]{35}$`)은 Google이 길이를 바꾸면 깨지므로 채택하지 않는다. 이게 깨질 위험 < 사용자 친화성 + 미래 호환성.

### 4.3 Web 컴포넌트

| 경로 | 역할 |
|---|---|
| `apps/web/src/app/[locale]/app/settings/layout.tsx` | 로컬 layout (auth guard + 패딩). 향후 settings 페이지가 늘면 navigation도 여기. |
| `apps/web/src/app/[locale]/app/settings/ai/page.tsx` | Server Component. i18n 메시지 prefetch + `<SettingsAiClient>` 렌더 |
| `apps/web/src/components/settings/SettingsAiClient.tsx` | TanStack Query provider 마운트 + 페이지 컨테이너 |
| `apps/web/src/components/settings/ByokKeyCard.tsx` | 폼 + 마스킹 표시 + 삭제 확인 모달 |
| `apps/web/src/components/settings/ByokKeyCard.test.tsx` | Unit: 빈 상태 / 등록 상태 / 저장 / 삭제 / 에러 |
| `apps/web/src/lib/api-client-byok-key.ts` | 3 엔드포인트 wrapper + Query key factory |
| `apps/web/src/lib/api-client-byok-key.test.ts` | Wrapper unit test |
| `apps/web/messages/ko/settings.json` | 신규 i18n 네임스페이스 (ko) |
| `apps/web/messages/en/settings.json` | 신규 i18n 네임스페이스 (en, native review 적용) |
| `apps/web/tests/e2e/settings-ai.spec.ts` | E2E: 등록 → 마스킹 → 교체 → 삭제 |
| `apps/web/src/i18n.ts` | `settings` 네임스페이스 등록 |

### 4.4 API 변경

| 경로 | 변경 |
|---|---|
| `apps/api/src/routes/users.ts` | 기존 라우터에 3 엔드포인트 추가 (GET/PUT/DELETE `/me/byok-key`) |
| `apps/api/src/routes/users.test.ts` | (기존 또는 신규) BYOK CRUD 테스트 |

**라우트 마운트:** `apps/api/src/index.ts`에서 `userRoutes`는 이미 `/api/users`에 마운트되어 있음. 추가 작업 없음.

### 4.5 ByokKeyCard UX 상태기

```
┌─ EMPTY ─────────────────────────┐
│ "Gemini API 키를 등록하세요"    │
│ [input AIza...]   [저장]        │
│ ⓘ Google AI Studio에서 발급…   │
└─────────────────────────────────┘
                ↓ PUT 200
┌─ REGISTERED ────────────────────┐
│ AIza••••XXXX                    │
│ 마지막 업데이트: 2026-04-26     │
│ [교체]  [삭제]                  │
└─────────────────────────────────┘
                ↓ 교체 클릭         ↓ 삭제 클릭
        EMPTY 상태로 (input 노출)   확인 모달 → DELETE 200 → EMPTY
```

- 폼은 `<form>` 네이티브 + `react-hook-form` 없이 가벼운 `useState` (스코프 작음, 일관성 위해 다른 단순 폼들과 같은 패턴)
- 삭제 확인 모달은 기존 `@radix-ui/react-alert-dialog` 사용 (다른 곳에서 이미 사용 중이라면)
- 저장 성공 → 로컬 toast (`useToast` 또는 inline alert. 프로젝트 컨벤션 따름)

---

## 5. Data Flow

### 5.1 키 등록 / 교체

```
[Web] 폼 submit { apiKey: "AIza..." }
  ↓
[Web] api-client-byok-key.setByokKey({ apiKey })
  ↓ PUT /api/users/me/byok-key
[API] requireAuth → Zod 검증 (startsWith AIza, length)
[API] encryptToken(apiKey) → Buffer
[API] db.insert(userPreferences).values({ userId, byokApiKeyEncrypted: buffer })
        .onConflictDoUpdate({ target: userId, set: { byokApiKeyEncrypted, updatedAt } })
[API] return 200 { registered: true, lastFour: apiKey.slice(-4), updatedAt }
  ↓
[Web] queryClient.invalidateQueries(["byok-key"])
[Web] 토스트 "저장됨" → REGISTERED 상태 렌더
```

### 5.2 키 상태 조회

```
[Web] mount → useQuery(["byok-key"], () => fetch GET /me/byok-key)
[API] requireAuth → select byokApiKeyEncrypted from user_preferences where user_id = me.id
[API] if null → return { registered: false }
[API] else  → const plain = decryptToken(buffer)
              return { registered: true, lastFour: plain.slice(-4), updatedAt }
[Web] EMPTY or REGISTERED 렌더
```

### 5.3 키 삭제

```
[Web] [삭제] 클릭 → AlertDialog 확인 → onConfirm
  ↓ DELETE /api/users/me/byok-key
[API] requireAuth → update user_preferences set byokApiKeyEncrypted = null where user_id = me
[API] return 200 { registered: false }
  ↓
[Web] invalidate → EMPTY 상태로 복귀
```

### 5.4 핵심 불변식

- **encryptToken/decryptToken은 idempotent in/out** — `decryptToken(encryptToken(x)) === x` 단언 (테스트로 보강)
- **null = 미등록** — empty buffer / 0-byte는 invalid 상태. NOT NULL 회피 + 명시적 sentinel 없음.
- **lastFour는 응답에만 존재** — DB에 저장하지 않음, 캐시 일관성 부담 회피
- **PUT은 항상 upsert** — 기존 행이 있으면 update, 없으면 insert (`user_preferences.userId`는 PK)

---

## 6. Error Handling

### 6.1 API

| 케이스 | HTTP | 응답 본문 |
|---|---|---|
| Zod fail (key 너무 짧음) | 400 | `{ error: "invalid_input", code: "too_short" }` |
| Zod fail (key 너무 김) | 400 | `{ error: "invalid_input", code: "too_long" }` |
| Zod fail (AIza prefix 없음) | 400 | `{ error: "invalid_input", code: "wrong_prefix" }` |
| 인증 누락 | 401 | (기존 `requireAuth` 미들웨어가 내려줌) |
| DB write 실패 | 500 | `{ error: "internal_error" }` (사용자에겐 "잠시 후 재시도" 카피) |
| 동시 수정 | n/a | last-write-wins 단일 사용자 자원이라 의미 없음 |

### 6.2 Web

| 케이스 | UX |
|---|---|
| 저장 중 네트워크 실패 | 토스트 + 입력 값 유지 + 재시도 |
| 저장 성공 | 토스트 "저장됨" + REGISTERED 상태 |
| 저장 실패 (400) | inline 에러 메시지 (`settings.ai.byok.error.invalid_format`) |
| 삭제 확인 모달 닫기 | no-op |
| 페이지 첫 로드 중 | 카드 영역에 skeleton |

### 6.3 보안

- **로깅** — apps/api 로그에 `apiKey` 평문 절대 출력 금지. Zod 검증 실패 시 길이/prefix만 기록.
- **CSRF** — 기존 Better Auth 쿠키 + `Origin` 검증 미들웨어 흐름 유지 (다른 mutation 라우트와 동일).
- **timing attack** — 짧은 키와 긴 키의 응답 시간 차가 의미 있는 정보가 아님 (등록되어 있는지/아닌지는 GET으로 누구나 확인 가능, 사용자 본인 한정). 추가 처리 안 함.
- **HTTP body 캐싱** — `Cache-Control: no-store` (기존 `requireAuth` 라우트 컨벤션을 그대로 상속).

---

## 7. i18n

### 7.1 신규 네임스페이스 `messages/ko/settings.json`

```json
{
  "ai": {
    "title": "AI 설정",
    "subtitle": "Deep Research에 사용할 Gemini API 키를 관리합니다.",
    "byok": {
      "heading": "Gemini API 키",
      "description": "직접 등록한 키로 Deep Research를 호출합니다. 비용은 Google이 사용자의 Google Cloud 계정에 청구합니다.",
      "input_label": "API 키",
      "input_placeholder": "AIza…",
      "save": "저장",
      "saving": "저장 중…",
      "saved": "키가 저장되었습니다.",
      "registered_label": "등록된 키",
      "last_updated": "마지막 업데이트",
      "replace": "교체",
      "delete": "삭제",
      "delete_confirm_title": "API 키를 삭제할까요?",
      "delete_confirm_body": "삭제 후에는 새 리서치를 시작할 때 다시 등록해야 합니다.",
      "delete_confirm_yes": "삭제",
      "delete_confirm_no": "취소",
      "deleted": "키가 삭제되었습니다.",
      "help_text": "Google AI Studio에서 키를 발급할 수 있습니다.",
      "help_link_label": "키 발급 방법",
      "error": {
        "wrong_prefix": "올바른 Gemini API 키 형식이 아닙니다. (AIza로 시작하는 키)",
        "too_short": "키가 너무 짧습니다.",
        "too_long": "키가 너무 깁니다.",
        "save_failed": "저장에 실패했습니다. 잠시 후 다시 시도해주세요.",
        "delete_failed": "삭제에 실패했습니다. 잠시 후 다시 시도해주세요.",
        "load_failed": "키 정보를 불러오지 못했습니다."
      }
    }
  }
}
```

### 7.2 `messages/en/settings.json` (native review pass 적용 후)

같은 키 셋, native English. 카피 가이드:

- 평어. "Manage your Gemini API key for Deep Research."
- 경쟁사 미언급 (해당 없음 — Google은 모델 제공자라 언급 OK)
- 기술 스택 디테일 최소 — "AES-256-GCM" 같은 단어 노출 금지

### 7.3 `messages/en/research.json` native review

Phase D에서 한 번에 batch 번역됨. 본 spec은 한 패스 더 — 다음 5종 점검:

1. **단일 사용자 대상의 명확한 문장** — "We're researching" → "Researching..." 같은 단순화
2. **CTA 문구가 행위 동사로 시작하는지** — "Start research" / "Approve and start" / "Open note"
3. **에러 메시지의 책임 주체 명확화** — "Your Gemini key is invalid" 처럼 사용자가 행동 가능한 표현
4. **모델명은 그대로 유지** — "Deep Research" / "Deep Research Max"는 Google 공식 제품명
5. **불필요한 가스라이팅/사과 어조 제거** — "Sorry," 남발 금지

리뷰 산출물은 **diff PR**: `messages/en/research.json` 키 값만 수정. 키 셋 자체는 변경 없음 (parity 유지).

### 7.4 i18n parity

`pnpm --filter @opencairn/web i18n:parity` CI 통과 필수. 이 스크립트가 `messages/ko/*.json` 과 `messages/en/*.json` 의 파일 셋 + 키 셋을 1:1로 비교한다. 신규 `settings.json`을 양쪽에 동시 추가하면 자동 통과 (값은 native review 후 영문화).

---

## 8. Testing

### 8.1 API Unit (Vitest, `apps/api`)

`apps/api/tests/byok-key.test.ts` (또는 `users.test.ts` 확장):

- **GET 미등록 시** — `{ registered: false }` 반환
- **PUT 빈 문자열** — 400 `too_short`
- **PUT 짧은 키** (< 20자) — 400 `too_short`
- **PUT 잘못된 prefix** ("foo123...") — 400 `wrong_prefix`
- **PUT 유효한 키** — 200 + DB 행에 ciphertext 저장됨 + decrypt 시 원본과 일치
- **GET 등록 후** — `{ registered: true, lastFour: "마지막4자", updatedAt }` 반환
- **PUT 두 번** — 같은 user_id 같은 row 업데이트 (insert 두 번 X), updatedAt 갱신
- **DELETE** — 컬럼 null
- **DELETE 미등록 상태** — 200 (멱등)
- **인증 없음** — 401 (기존 `requireAuth` 흐름)

### 8.2 Web Unit (Vitest + jsdom)

`apps/web/src/components/settings/ByokKeyCard.test.tsx`:

- 빈 상태 렌더 (`empty_hint` 표시)
- 등록 상태 렌더 (마스킹 + last_updated)
- 빈 폼 submit → inline 에러
- 잘못된 prefix submit → inline 에러
- 유효한 키 submit → mutation 호출 + 성공 토스트
- 교체 클릭 → input 다시 노출
- 삭제 확인 → DELETE mutation 호출
- API 에러 시 inline 에러 메시지

`apps/web/src/lib/api-client-byok-key.test.ts`:

- `getByokKey()` 200 응답 파싱
- `setByokKey()` 200/400 분기
- `deleteByokKey()` 200 응답
- query key factory 안정성

### 8.3 E2E (Playwright)

#### 8.3.1 신규 `apps/web/tests/e2e/settings-ai.spec.ts`

테스트 1개 (smoke): 등록 → 마스킹 표시 → 교체 → 삭제

```
seedAndSignIn
GET /[locale]/app/settings/ai
expect: heading "AI 설정"
expect: 빈 폼
fill input "AIza" + 35 random chars
click 저장
expect: "AIza••••XXXX" 마스킹 + 마지막 업데이트 라벨
click 교체
expect: 빈 input 다시 노출
click 삭제 → 확인
expect: 빈 폼 복귀
```

`FEATURE_DEEP_RESEARCH` 플래그 의존 없음 (BYOK 등록은 Deep Research가 꺼져 있어도 가능해야 함 — 기능적으로는 미래 사용을 위한 등록).

#### 8.3.2 `apps/web/tests/e2e/research-smoke.spec.ts` 활성화

현재 L25-28의 `test.skip(... FEATURE_DEEP_RESEARCH ...)` 컨디션은 그대로 유지. 대신 Playwright 설정에서 `webServer.env.FEATURE_DEEP_RESEARCH = "true"` 주입.

```typescript
// apps/web/playwright.config.ts (수정)
webServer: {
  command: "...",
  env: {
    ...process.env,
    FEATURE_DEEP_RESEARCH: "true",
  },
},
```

**API 측 플래그는 본 E2E에 영향 없음** — `research-smoke.spec.ts`는 `/api/research/*`를 fetch interceptor로 모킹하기 때문에 실제 API 라우트가 호출되지 않는다. 따라서 API의 `FEATURE_DEEP_RESEARCH` 환경 변수는 별도 주입 불필요.

#### 8.3.3 모킹 전략

`research-smoke.spec.ts`는 이미 `/api/research/*`를 fetch interceptor로 mock하고 있다 (해당 spec L34-155). Phase E는 이 mock을 그대로 두고 env 주입만 추가.

### 8.4 Non-goals (테스트 범위 밖)

- 실제 Gemini API 호출
- BYOK 키 + Deep Research 풀 플로우 (Google 호출 시점까지) — 이건 Spec B (AI Usage Visibility) / 별도 통합 환경
- 60분 long-running 시나리오 — Phase B에서 이미 테스트됨

---

## 9. Rollout

### 9.1 PR 단위

**PR1 (본 spec 범위):**
- API 3 엔드포인트 + 테스트
- Web 페이지 + 컴포넌트 + 테스트
- E2E 2개 (settings-ai 신규 + research-smoke 활성화)
- i18n ko/en + en review pass
- `plans-status.md` "Phase E (features)" 완료 마킹

**`.env.example`:** `FEATURE_DEEP_RESEARCH=false` 유지. 본 PR은 코드만, 출시는 분리.

**머지 후 (PR 외):**
- Staging 환경에 `FEATURE_DEEP_RESEARCH=true` 주입 → 수동 1회 시연 (Smoke topic으로 BYOK 키 등록 → Research 실행 → 결과 노트 확인). 가능하면 Deep Research preview 모델로만 (비용 절감).
- 검증 완료 → Prod env에 동일 플래그 주입 (운영자 콘솔 또는 deploy config). 별도 PR 없음.
- Post-deploy commit (작은 docs-only): `plans-status.md` "Deep Research prod release" → ✅, 날짜 + HEAD 기록.

### 9.2 롤백

- Prod에서 이슈 발생 시 `FEATURE_DEEP_RESEARCH=false`로 env 1줄 변경 + 재배포. 코드 롤백 불필요.
- BYOK 키는 등록된 채 남아있어도 무해 (사용 시점이 없으니).

### 9.3 Deep Research Phase F+ 후속

- **Spec B (AI Usage Visibility)** — 본 spec 머지 후 별도 plan으로. 사용량/비용 집계 + 대시보드.
- **MCP 통합** — umbrella spec §2 Non-Goals 항목.
- **`/settings/billing` + Plan 9b** — 사업자등록 후.
- **Settings hub 페이지** — `/settings`, `/settings/profile` 등의 통합 UX. 별도 plan.

---

## 10. Open Questions

1. **AlertDialog 의존성 확인** — `@radix-ui/react-alert-dialog`가 이미 설치되어 있는지 plan 단계 첫 task에서 확인. 없으면 native `<dialog>` 또는 다른 모달 컴포넌트 fallback.
2. **`useToast` 컨벤션** — 프로젝트 내 기존 토스트 헬퍼 (`sonner` / `react-hot-toast` / 자체 컴포넌트) 무엇을 쓰는지 plan task 1에서 확인. 일관성 유지.
3. **playwright env 전달 방식** — `webServer.env`로 주입 시 monorepo 워크스페이스 명령(`turbo run dev` 등)이 child process에 env를 전파하는지 확인 필요. 안 되면 envFile 또는 dotenv-cli로 우회.
4. **lastFour 타입 안정성** — apiKey가 4자 미만이면 (Zod에서 막음) 안전. but 응답 타입에 `lastFour` 필수 vs optional 어느 쪽? `registered: true` discriminated union으로 lastFour 필수가 깔끔. 채택.
5. **BYOK CSRF 보호 추가 필요성** — 기존 PUT/DELETE 라우트들이 어떤 보호를 갖고 있는지 (ex: `comments.ts`, `notes.ts`) 점검 후 동일 수준 적용. plan 단계 task 0.

---

## 11. Decomposition → Implementation Plan

본 spec은 brainstorming 출력. 실행 plan은 `superpowers:writing-plans` skill로 별도 생성한다. 다음을 포함해야 한다:

- **Task 0: Pre-flight** — AlertDialog/Toast 컨벤션 확인, 기존 PUT 라우트 보안 패턴 확인
- **Task 1~4: API** — TDD로 BYOK 라우트 3개 + 테스트 (GET → PUT → DELETE 순)
- **Task 5: Crypto integration** — encryptToken/decryptToken을 byok-key 컨텍스트에서 검증 (워커 wire 호환 확인용 round-trip 테스트)
- **Task 6~9: Web** — api-client → page route → SettingsAiClient → ByokKeyCard (TDD)
- **Task 10: i18n ko/en + parity green**
- **Task 11: en native review** — research.json + settings.json
- **Task 12: E2E settings-ai.spec.ts**
- **Task 13: E2E research-smoke 활성화** — playwright.config.ts env 주입
- **Task 14: plans-status.md + post-feature 워크플로**
- **Task 15: post-merge 단계** (별도 메모, 코드 변경 없음) — staging 검증 + prod flag flip 절차

각 Task 내부 Red-Green-Refactor TDD (`superpowers:test-driven-development`).

---

## 12. References

- `apps/web/src/components/research/ResearchRunView.tsx:103-111` — 에러 CTA 링크 경로 (`/${locale}/app/settings/ai`, `/${locale}/app/settings/billing`)
- `apps/web/tests/e2e/research-smoke.spec.ts:25-28` — 플래그 skip 컨디션
- `apps/web/src/lib/feature-flags.ts` — 플래그 헬퍼 (`isDeepResearchEnabled`, `isManagedDeepResearchEnabled`)
- `apps/api/src/routes/research.ts:52` — 라우트 마운트 게이트
- `apps/api/src/lib/integration-tokens.ts` — encrypt/decrypt 헬퍼
- `apps/worker/src/worker/lib/integration_crypto.py` — 워커 측 decrypt (wire 호환 보장)
- `apps/worker/src/worker/activities/deep_research/keys.py` — `KeyResolutionError("no byok key registered")` fail-fast
- `packages/db/src/schema/user-preferences.ts:23` — `byokApiKeyEncrypted` 컬럼
- `apps/api/src/routes/users.ts` — 확장 대상 라우터
- `docs/superpowers/specs/2026-04-22-deep-research-integration-design.md` §6.1, §7.1, §8 — BYOK · Rollout · Feature flag
