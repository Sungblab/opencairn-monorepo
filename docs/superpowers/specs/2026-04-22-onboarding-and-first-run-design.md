# Onboarding & First-Run Experience — Design Spec

- **Date**: 2026-04-22
- **Status**: Draft v1
- **Phase**: Plan 9a follow-up (Web Foundation 보완)
- **Scope flag**: 404 블로커 제거 + 초대 수락 플로우 닫기. Provider 선택·튜토리얼·시드 데이터 제외.

---

## 1. Context & Problem

가입 직후 워크스페이스가 하나도 없는 유저는 `/app` 진입 시
`/{locale}/onboarding`으로 리다이렉트되지만
(`apps/web/src/app/[locale]/app/page.tsx:19`) 해당 라우트가 구현되어 있지
않아 **404**가 난다. 현재 Plan 1에 workspace CRUD와 invite accept/decline
API는 완비돼 있고 Plan 9a에서 auth UI(로그인/회원가입/비밀번호 재설정/
이메일 인증)가 이미 neutral mono 테마로 정돈되어 있다. 누락된 건 **첫
워크스페이스 생성 UI**와 **이메일 초대 링크 수락 UI** 두 종류뿐이다.

이 둘을 단일 라우트 `/{locale}/onboarding`에 합쳐 "첫 사용 경험이 막히지
않는" 최소 경로를 닫는다. 샘플 데이터 시드·에디터 튜토리얼·LLM provider
선택은 본 스펙의 명시적 비범위다 (§2).

## 2. Goals & Non-goals

### Goals
- 워크스페이스 0개 + 로그인 + 이메일 인증 완료 상태인 유저가 **하나의
  페이지에서** 자기 워크스페이스를 만들거나, 받은 초대를 수락하여
  `/app/w/:slug`에 진입할 수 있다.
- 초대 토큰이 무효/만료/이메일 불일치/이미 멤버인 케이스를 모두 명확한
  문구로 처리하고 대체 경로(직접 만들기)를 제시한다.
- 모든 user-facing 문자열은 `messages/{ko,en}/onboarding.json` 키로
  관리되고 parity CI를 통과한다.
- 라우트 가드가 서버 컴포넌트에서 선제 실행되어, 잘못된 상태에서 본
  화면이 잠깐이라도 깜빡이지 않는다.

### Non-goals (명시)
- **LLM provider 선택 UI 없음** — provider는 서버 env에서 고정되고
  유저는 선택하지 않는다 (`feedback_llm_provider_env_only`).
- 샘플 프로젝트·샘플 노트 시드 없음. 빈 상태에서 시작.
- 에디터 단축키/슬래시메뉴 투어 없음 — Plan 2D가 튜토리얼 컨텐츠를
  별도로 다룬다.
- 프로필 이미지 업로드 없음. 이름은 signup 단계에서 이미 받고 있고
  재확인 단계 추가하지 않는다.
- 다중 워크스페이스 동시 생성 / 워크스페이스 삭제 취소 등 엣지
  플로우 없음. 소속 0→1 전이만.

## 3. User Flows

### 3.1 신규 가입자 (일반)
1. Signup → 이메일 인증 → `/auth/login`에서 로그인
2. 로그인 성공 → `/app`로 redirect → 서버 컴포넌트가 `GET
   /api/workspaces`로 멤버 워크스페이스 목록 조회
3. 목록 0개 → `/{locale}/onboarding`으로 redirect
4. 온보딩 페이지가 **모드 B(새 워크스페이스 만들기)** 폼 표시
5. 이름 입력 → 슬러그 자동 추천 → 제출
6. `POST /api/workspaces` 201 → `/{locale}/app/w/:slug`로 이동

### 3.2 이메일 초대 수신자
1. 운영자가 `POST /api/workspaces/:id/invites`로 초대 발송
2. 수신자 메일에 `https://{host}/{locale}/auth/signup?invite=<token>`
   링크 (§8 이메일 템플릿 변경 항목)
3. 신규 가입자는 `/auth/signup?invite=<token>`에서 가입. 회원가입 완료
   후 이메일 인증 → 로그인 → `/{locale}/onboarding?invite=<token>`
   (§6 초대 토큰 승계 규칙)
4. 기가입자(이메일 인증 완료)인 경우, 링크는 여전히
   `/auth/signup?invite=<token>`로 시작하지만 signup 페이지의 세션 가드가
   `/{locale}/onboarding?invite=<token>`로 리다이렉트한다 (§8.5). 즉 이메일
   링크의 URL은 가입자/기가입자 동일.
5. 온보딩 페이지가 **모드 A(초대 수락)** 카드 표시 — 워크스페이스 이름,
   초대자 이름, 부여될 역할, **수락** CTA, **또는 내 워크스페이스
   직접 만들기** 보조 링크
6. 수락 → `POST /api/invites/:token/accept` 200 →
   `/{locale}/app/w/{slug}` 이동 (응답의 `workspaceId`로 slug 재조회
   필요 — §8 참조)

### 3.3 초대 토큰이 이상할 때 (모드 A 실패 경로)
- **404 (invite not found)**: "이 초대 링크를 찾을 수 없어요" + 직접
  만들기 폼으로 폴백
- **410 (expired)**: "초대가 만료됐어요. 초대해주신 분께 재발송을
  요청해주세요." + 직접 만들기 폼
- **403 (email mismatch)**: "이 초대는 `x@y.com`으로 발송됐어요. 해당
  이메일로 로그인해주세요." + 로그아웃/로그인 링크
- **400 (already accepted)**: "이미 수락한 초대예요." 토큰의
  `workspaceId`로 `GET /api/workspaces` 목록에서 slug를 찾으면 2초
  안내 토스트 후 해당 워크스페이스로 redirect. 못 찾으면(알 수 없는
  상태) 모드 B 폼으로 폴백.
- **409 (already member)**: 동일하게 workspaceId → slug redirect.
  API 응답에 `workspaceId`가 없으면 §8.1 GET 엔드포인트로 재조회.

### 3.4 이미 워크스페이스가 있는 유저
- `/onboarding` 직접 접근 → 서버 컴포넌트 가드가 `GET /api/workspaces`
  조회 → 1개 이상이면 첫 워크스페이스로 redirect
- 초대 토큰 들고 왔어도 동일 — **단** 토큰이 있으면 가드에서 우선 수락
  시도 로직 없이, 그대로 온보딩 모드 A를 보여준다 (유저가 능동적으로
  "수락"을 눌러야 권한 변동). 수락 후 `/app/w/{slug}` 이동.

### 3.5 상태별 라우트 가드 정리 (서버 컴포넌트)

| 유저 상태 | 토큰 유무 | 동작 |
|-----------|-----------|------|
| 세션 없음 | 무관 | `/{locale}/auth/login?return_to=/onboarding[?invite=...]` |
| 이메일 미인증 | 무관 | `/{locale}/auth/verify-email` |
| 워크스페이스 0 | 없음 | 온보딩 모드 B 렌더 |
| 워크스페이스 0 | 있음 | 온보딩 모드 A 렌더 (초대 정보 fetch) |
| 워크스페이스 ≥1 | 없음 | `/{locale}/app` (기존 동작) |
| 워크스페이스 ≥1 | 있음 | 온보딩 모드 A 렌더 — 수락 선택 허용 |

## 4. Routing & File Layout

```
apps/web/src/app/[locale]/onboarding/
├── page.tsx              # 서버 컴포넌트. 가드 + 초대 토큰 fetch + 모드 분기
├── OnboardingShell.tsx   # 클라이언트. 두 모드 카드를 하나의 shell에서 switch
├── CreateWorkspaceForm.tsx  # 클라이언트. 이름/슬러그 폼
└── AcceptInviteCard.tsx  # 클라이언트. 초대 정보 카드 + accept CTA
```

- 레이아웃: `/auth`의 카드형 레이아웃(센터 고정폭)을 본 라우트에서도
  재사용한다. 기존 `app/[locale]/auth/layout.tsx`를 그대로 import해서
  import chain을 줄이지 않고, **복제해서 `apps/web/src/app/[locale]/
  onboarding/layout.tsx`**를 둔다. auth 레이아웃의 카피·풋노트는 온보딩
  맥락과 달라서 공유가 부적절.
- 스타일: neutral mono (stone 팔레트), 기존 auth 컴포넌트의 여백/타이포
  규칙 그대로. 애니메이션·italic·grain 금지 (브랜드 메모리).

## 5. UI

### 5.1 모드 B: 새 워크스페이스 만들기
- 타이틀: `onboarding.create.title` — "첫 워크스페이스를 만드세요"
- 부제: `onboarding.create.desc` — "워크스페이스는 문서·프로젝트가
  모이는 공간이에요. 나중에 이름과 주소는 바꿀 수 있어요."
- 필드:
  - `name` (text, required, min 1, max 120) — 자동완성 `organization`
  - `slug` (text, required, `[a-z0-9-]{3,40}`) — 값이 비어있거나 유저가
    건드리지 않은 상태면 `name`에서 자동 생성 (§5.3). 유저가 직접 입력
    시점부터는 자동 동기화 중단.
  - 슬러그 하단 미리보기: `opencairn.com/app/w/{slug}` 미리보기 텍스트
    (copy-only, 링크 아님)
- 제출 버튼: `onboarding.create.submit` — "워크스페이스 만들기"
- 제출 중 버튼 `disabled` + 로딩 인디케이터
- 에러 영역: aria-live="polite", 409 / 400 / 500 / 네트워크 실패 각각
  다른 카피

### 5.2 모드 A: 초대 수락 카드
- 타이틀: `onboarding.invite.title` — "{inviterName}님의 초대"
- 본문: `onboarding.invite.body` — "{workspaceName} 워크스페이스에
  {role} 역할로 참여합니다." (role은 translate: admin/member/guest)
- 주 CTA: `onboarding.invite.accept` — "수락하고 입장하기"
- 보조 링크: `onboarding.invite.declineAndCreate` — "또는 내 워크스페이스
  직접 만들기" → 같은 라우트 내부 state로 모드 B 전환 (URL은 그대로 유지,
  토큰은 state로 보관)
- 수락 중 버튼 disabled + 로딩. 실패 시 §3.3 카피 매핑.

### 5.3 슬러그 자동 생성 규칙
- 기본 알고리즘 (클라이언트):
  1. 한글/비ASCII를 `transliterate` 대신 **제거**한다 (단순성 우선 —
     한글 transliteration 라이브러리 도입은 범위 초과). 제거 후 빈
     문자열이면 자동 추천 없이 플레이스홀더만 표시.
  2. 소문자화, 공백·언더스코어 → 하이픈, 연속 하이픈 정리, 양끝 하이픈
     제거.
  3. 40자 초과 시 40자로 절단.
  4. 결과가 예약어(§5.4)거나 3자 미만이면 자동 추천 비움, 유저가 직접
     입력해야 제출 가능.
- 유저가 슬러그 필드를 한 번이라도 편집하면 이후 `name` 변경은 슬러그에
  반영하지 않는다 (`touched` flag).

### 5.4 예약어
- 차단 목록: `app`, `api`, `admin`, `auth`, `www`, `assets`, `static`,
  `public`, `health`, `onboarding`, `settings`, `billing`, `share`,
  `invite`, `invites`, `help`, `docs`, `blog`.
- 프론트 검증 + 백엔드 검증 **둘 다**. 백엔드에 추가하는 변경은 §8
  prerequisite로 분리.

## 6. Signup → Verify → Onboarding 간 초대 토큰 승계

초대 토큰이 여러 리다이렉트를 거쳐도 유실되지 않도록:

1. 초대 이메일 링크: `/{locale}/auth/signup?invite=<token>`로 시작.
2. `SignupForm`은 URL의 `invite` 쿼리를 읽어 `sessionStorage`에 저장
   (`opencairn:pending_invite`). Better Auth `signUp.email` 호출 시
   `callbackURL`에 `?invite=<token>`을 함께 실어 verify-email 페이지로
   넘긴다.
3. verify-email 성공 화면의 "로그인하러 가기" 링크는 `sessionStorage`에
   토큰이 있으면 `/{locale}/auth/login?return_to=/onboarding?invite=<token>`
   형태로 발급.
4. 로그인 성공 후 기본 리다이렉트 경로가 `return_to`(화이트리스트 검증)
   를 따라가도록 `LoginForm`에 분기를 추가한다 — 현재는 `/app`으로만
   이동. 화이트리스트: `/onboarding`, `/app`, `/app/w/*`.
5. `/onboarding` 서버 컴포넌트는 `sessionStorage`를 읽을 수 없으므로
   URL의 `?invite` 쿼리만 신뢰한다. 즉 4번에서 토큰을 URL에 실어 넘긴다.
6. 온보딩 페이지가 로드되면 `sessionStorage.opencairn:pending_invite`를
   **제거한다** (중복 승계 방지).

## 7. Data Flow & API 의존성

| 단계 | 엔드포인트 | 구현 여부 |
|------|-----------|-----------|
| 가드: 세션 | Better Auth `getSession` (SSR) | ✅ 기존 auth-helper 사용 |
| 가드: 이메일 인증 | Better Auth user 객체의 `emailVerified` | ✅ |
| 가드: 워크스페이스 존재 여부 | `GET /api/workspaces` | ✅ Plan 1 |
| 모드 A: 초대 조회 | **`GET /api/invites/:token`** | 🔴 **미구현** — 구현 필요 (§8.1) |
| 모드 A: 수락 | `POST /api/invites/:token/accept` | ✅ Plan 1 |
| 모드 B: 생성 | `POST /api/workspaces` | ✅ Plan 1 |
| 수락 후 slug 조회 | `GET /api/workspaces` | ✅ 생성된 멤버십이 반영된 목록에서 `workspaceId` 매칭 |

## 8. Prerequisite Work (실행 플랜에 태스크로 포함)

### 8.1 `GET /api/invites/:token` 구현 (백엔드)
- `api-contract.md` §Workspace Invites에 선언되어 있으나 라우터 미구현.
- 응답: `{ workspaceId, workspaceName, inviterName, role, email, expiresAt }`.
- 인증: 불필요 (토큰 자체가 비밀). Rate limit: 동일 IP 분당 20.
- 실패: 404 (not found), 410 (expired), 400 (already accepted).
- 본 스펙의 모드 A가 이 엔드포인트에 의존.

### 8.2 Workspace 예약어 서버 검증 (백엔드)
- `POST /api/workspaces`의 `createSchema`에 `.refine`으로 예약어
  차단 추가. §5.4 리스트 공유.
- 실패 시 `{ error: "reserved_slug" }` 400. 프론트는 i18n 카피로 안내.

### 8.3 Invite email 템플릿 경로 교정 (백엔드)
- `apps/api/src/lib/email.ts`의 `sendInviteEmail`이 렌더하는 링크
  URL을 `${WEB_BASE_URL}/${locale}/auth/signup?invite=<token>`로
  교정·통일한다. 현재 템플릿이 가리키는 경로는 작업 첫 단계에서
  코드 확인 후 고정.
- locale은 email 발송 당시 수신자 로케일을 알 수 없으므로 기본값 `ko`
  (유저 기본 설정, Plan 9a 기준). i18n routing을 위한 locale 추론은
  본 스펙 범위 초과 — 후속 과제.
- 신규/기존 유저 분기는 signup 페이지의 세션 가드가 처리 (§8.5).

### 8.4 `LoginForm` return_to 지원 (프론트)
- 현재는 로그인 성공 후 하드코딩 경로로 이동. 쿼리 `return_to`가 있고
  화이트리스트에 맞으면 그 경로로 이동. 기본은 `/app`.

### 8.5 `/auth/signup` 세션 가드 (프론트)
- 이미 로그인된 상태에서 `/auth/signup?invite=<token>`을 열면
  `/onboarding?invite=<token>`로 리다이렉트. 토큰 없으면 `/app`으로.

## 9. Edge Cases & Error Handling

| 케이스 | 처리 |
|--------|------|
| 슬러그 409 (conflict) | 인라인 에러 + `name-2`, `name-3` 제안 (최대 3개, `GET /api/workspaces/by-slug/:slug`로 사용 가능 여부 확인) |
| 슬러그 규칙 위반 | 제출 차단 + 인라인 에러 (`[a-z0-9-] 3~40자`) |
| 이름 앞뒤 공백 | trim |
| 초대 토큰 URL 포함 문자 문제 | base64url이라 안전 |
| 네트워크 실패 | 인라인 에러 + 재시도 버튼 (폼 상태 보존) |
| 동일 슬러그로 연속 제출 | 버튼 disabled + `AbortController`로 인플라이트 요청 취소 |
| 이메일 인증은 됐지만 Better Auth 세션이 만료 | 가드에서 /auth/login 리다이렉트 |
| 초대 이메일과 가입 이메일 대소문자 차이 | 백엔드에서 이미 lowercase 비교 (`invites.ts:46`), 프론트는 동일 가정 |
| `?invite=`가 URL엔 있지만 빈 문자열/너무 짧음 | 토큰 무시하고 모드 B |

## 10. Testing

### 10.1 단위
- `apps/web/src/lib/slug.ts` (신규): `deriveSlug(name)` 함수 단위 테스트
  — 공백/언더스코어/대문자/한글/연속하이픈/길이/예약어 케이스.

### 10.2 E2E (Playwright, 기존 `apps/web/tests/e2e` 패턴)
1. `onboarding-create.spec.ts`: 신규 가입 → 이메일 인증 → 로그인 →
   `/onboarding` 도달 → 이름 입력 → 자동 슬러그 확인 → 제출 → `/app/w/:slug`
   진입 확인.
2. `onboarding-invite-accept.spec.ts`: 기존 워크스페이스 owner가 초대
   발송 → 신규 유저가 `?invite=<token>` 링크로 가입 플로우 완주 → 온보딩
   모드 A 표시 → 수락 → 해당 워크스페이스로 진입.
3. `onboarding-guards.spec.ts`:
   - 비로그인 `/onboarding` 접근 → `/auth/login`
   - 이메일 미인증 → `/auth/verify-email`
   - 워크스페이스 1개 보유 + 토큰 없음 → `/app/w/:slug`
4. `onboarding-slug-conflict.spec.ts`: 이미 존재하는 슬러그 제출 →
   409 에러 + 제안값 표시.

### 10.3 API
- `GET /api/invites/:token` 신규 엔드포인트 단위 테스트 — 404/410/400
  시나리오.

## 11. Out-of-scope / Future

- 샘플 노트·샘플 프로젝트 시드.
- 에디터 기능 투어 (→ Plan 2D).
- 프로필 이미지·이름 재편집 (→ Plan 2C의 account settings UI).
- 여러 워크스페이스 빠른 전환 온보딩 카피 (→ Plan 2E tab shell 이후).
- Usage analytics: 온보딩 완료율 측정. PostHog/GA 도입 시 event
  (`onboarding_create_submitted`, `onboarding_invite_accepted`) 추가.

## 12. Open Questions

- 없음. 본 스펙은 착수 가능한 상태.
