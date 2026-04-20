# Web Foundation: Theme + i18n + Landing Port

**Date:** 2026-04-20
**Status:** Draft
**Scope:** `apps/web` — theme system, i18n infra, landing page port from `landing/landing.html`

## Overview

Plan 1 (Foundation) 완료 직후, `apps/web`의 프레젠테이션 기반을 세 축으로 세팅한다: (1) CSS variables + `data-theme` 기반 멀티테마, (2) next-intl 기반 i18n (ko default + en 키 예약), (3) 기존 `landing/landing.html`(1936줄, warm editorial, stone+ember)을 Next.js 16 App Router 컴포넌트로 포트.

이 세 축은 **서로의 첫 consumer**다. 랜딩이 테마 토큰·i18n 키를 실제로 사용해야 인프라가 검증된다. 따라서 한 스펙으로 묶되 구현은 세 phase로 진행한다.

기존 Plan 9(billing-marketing)의 landing task는 본 스펙이 흡수하며, 그 결과 Plan 9는 `plan-9a-web-foundation-and-landing`(본 스펙 기반) + `plan-9b-billing-engine`(사업자등록 후 deferred)로 분할된다.

## 전제와 비범위

**전제:**
- Plan 1 완료 (HEAD `50eaf3b`). Better Auth, workspace/member/invite, permissions helpers 기동 중.
- `apps/web`은 Next.js 16 + React 19 + Tailwind v4 + TypeScript 5.8 스켈레톤 상태 (`src/app/page.tsx`는 placeholder, `layout.tsx`는 `lang="en"` + hard-coded dark).
- 브랜드 자산 `landing/landing.html` 존재 (Tailwind CDN, Instrument Serif + Inter + Pretendard + JetBrains Mono).

**비범위 (명시적으로 제외):**
- 앱(`/dashboard`, `/workspaces/*`) 내부 UI 구축 — 본 스펙은 인프라 + 랜딩까지만. 대시보드 본 기능은 Plan 2 이후.
- 결제 레일 연동 (Toss/PG) — Plan 9b로 이관.
- Privacy/Terms/환불 정책 본문 — 랜딩 footer 링크만 두고 빈 페이지(placeholder). 본문은 Plan 9b.
- en translation 실제 카피 — 키 구조만 예약. en 값은 빈 문자열 또는 ko fallback. 실제 영어 랜딩은 v0.3 타겟 시점 별도 trigger.
- 추가 테마 팩 (Solarized/Dracula/Nord 등) — 인프라는 N개 지원, v0.1 실제 탑재는 4개로 고정.
- E2E 테스트 자동화 — 수동 시각 확인 + Playwright smoke 1~2개까지만. 본격 E2E는 Plan 2 이후.

## 아키텍처

### Phase 1: Theme 시스템

**원칙**: 컴포넌트는 색을 **토큰명**으로만 참조한다. Hard-coded `stone-900`, `bg-white` 사용 금지(랜딩은 light 고정이라 예외 허용). 런타임 토글은 `<html data-theme="...">` 속성 한 줄 변경으로 완료.

**Tailwind v4 설정** — `apps/web/src/app/globals.css`:

```css
@import "tailwindcss";

@theme {
  /* 브랜드 불변 토큰 (테마 무관) */
  --font-serif: "Instrument Serif", Georgia, serif;
  --font-sans: "Inter", "Pretendard Variable", Pretendard, -apple-system, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;

  /* 색은 CSS variable로 간접 참조 — data-theme이 실제 값 공급 */
  --color-bg: var(--theme-bg);
  --color-surface: var(--theme-surface);
  --color-border: var(--theme-border);
  --color-fg: var(--theme-fg);
  --color-fg-muted: var(--theme-fg-muted);
  --color-accent: var(--theme-accent);
  --color-accent-fg: var(--theme-accent-fg);
  --color-danger: var(--theme-danger);
  --color-success: var(--theme-success);
}

/* === Cairn Light (default) === */
:root,
[data-theme="cairn-light"] {
  --theme-bg: #FFFFFF;
  --theme-surface: #F5F5F4;
  --theme-border: #E7E5E4;
  --theme-fg: #1C1917;
  --theme-fg-muted: #78716C;
  --theme-accent: #EA580C;
  --theme-accent-fg: #FFFFFF;
  --theme-danger: #DC2626;
  --theme-success: #16A34A;
  color-scheme: light;
}

/* === Cairn Dark === */
[data-theme="cairn-dark"] {
  --theme-bg: #0C0A09;
  --theme-surface: #1C1917;
  --theme-border: #292524;
  --theme-fg: #F5F5F4;
  --theme-fg-muted: #A8A29E;
  --theme-accent: #FB923C;
  --theme-accent-fg: #1C1917;
  --theme-danger: #F87171;
  --theme-success: #4ADE80;
  color-scheme: dark;
}

/* === Sepia (warm reading) === */
[data-theme="sepia"] {
  --theme-bg: #F7F1E5;
  --theme-surface: #EFE7D4;
  --theme-border: #D9CFB9;
  --theme-fg: #3E2E1A;
  --theme-fg-muted: #7A6A50;
  --theme-accent: #B4531A;
  --theme-accent-fg: #FFFFFF;
  --theme-danger: #9F2424;
  --theme-success: #4F7A2C;
  color-scheme: light;
}

/* === High Contrast (접근성) === */
[data-theme="high-contrast"] {
  --theme-bg: #000000;
  --theme-surface: #0A0A0A;
  --theme-border: #FFFFFF;
  --theme-fg: #FFFFFF;
  --theme-fg-muted: #E5E5E5;
  --theme-accent: #FFFF00;
  --theme-accent-fg: #000000;
  --theme-danger: #FF4444;
  --theme-success: #44FF44;
  color-scheme: dark;
}
```

**ThemeProvider** — `apps/web/src/lib/theme/provider.tsx`:

- Client component, `<html data-theme>`을 직접 set.
- 스토리지 우선순위: (1) user 설정 (DB, 로그인 시) → (2) localStorage (게스트) → (3) `prefers-color-scheme` (최초 방문) → (4) `cairn-light` fallback.
- SSR 시 flash 방지: `layout.tsx`에서 쿠키/localStorage 기반 초기 `data-theme`을 서버에서 주입 (다음 섹션 참조).
- `useTheme()` 훅: `{ theme, setTheme, themes }` 반환.

**Flash-of-incorrect-theme 방지:**
- `layout.tsx`의 `<html>`에 초기 data-theme 주입. 로그인 유저는 쿠키에 테마 저장 → 서버에서 읽어 SSR. 게스트는 초기값 `cairn-light`로 내려가고, 클라이언트 hydration 직후 localStorage/`prefers-color-scheme`에 맞춰 덮음(짧은 깜빡임은 수용).
- 더 엄격한 방법(blocking inline script)은 Next.js 16 App Router에서 권장 안 함. 쿠키 SSR 방식을 v0.1 기본으로 간다.

**테마 적용 가능 영역:**
- 앱 영역(`/dashboard` 이하 라우트): 토글 적용.
- 랜딩(`/`, `/en`): 토글 비노출, `data-theme="cairn-light"` 강제 (layout에서 override).

**랜딩 전용 브랜드 토큰:**
- 랜딩은 현재 landing.html의 stone+ember 팔레트가 **아이덴티티 자체**다. 일반 앱 테마 토큰으로는 모든 뉘앙스(그리드 배경, grain, warm shadow)를 커버 못 한다.
- 해결: `globals.css`에 별도 `[data-brand="landing"]` 블록을 열어 `--brand-stone-*`, `--brand-ember-*` 등 랜딩 전용 변수 정의. 랜딩 섹션 컴포넌트만 사용.
- **속성 조합**: 랜딩 페이지 `<html>`에는 `data-theme="cairn-light" data-brand="landing"` 둘 다 적용. `data-theme`은 일반 앱 토큰 공급, `data-brand`는 랜딩 전용 토큰 공급. 앱 페이지(`/dashboard` 이하)는 `data-theme`만 적용하며 `data-brand`는 없음.

### Phase 2: i18n 인프라

**라이브러리**: `next-intl` (App Router native, ICU message format, 한국어 조사 select 처리).

**라우팅**:
- `/` → ko (default, prefix 없음)
- `/en/...` → en
- Middleware가 Accept-Language + 쿠키 `NEXT_LOCALE`로 최초 locale 결정. 유저 override는 쿠키 영구 저장.
- `/api/*`는 locale prefix 없음 (rewrite 제외).

**디렉토리 구조**:

```
apps/web/
├── messages/
│   ├── ko/
│   │   ├── common.json       # 공통 (버튼, 에러, footer)
│   │   ├── landing.json      # 랜딩 전용
│   │   └── dashboard.json    # 앱 네비게이션 (placeholder만)
│   └── en/
│       └── (ko와 동일 구조, 값은 빈 문자열 또는 ko fallback)
├── src/
│   ├── i18n.ts               # next-intl config (getRequestConfig)
│   ├── middleware.ts         # locale 감지 + 쿠키 + 리다이렉트
│   └── app/
│       ├── [locale]/         # locale-scoped 라우트
│       │   ├── layout.tsx    # NextIntlClientProvider 래핑
│       │   ├── page.tsx      # 랜딩
│       │   └── (app)/        # 기존 dashboard 그룹 이관
│       └── api/              # locale 밖
```

**en 키 정책 (v0.1):**
- ko/*.json 전 키가 en/*.json에도 동일 경로로 존재해야 함 (type-safety 강제).
- en 값은 **빈 문자열 `""` 금지** (next-intl이 fallback 안 함). **v0.1 전략: en 파일은 초기화 시점에 ko 값 그대로 복사** — `/en/...` 방문 시 한국어가 그대로 표시되지만 키 누락은 아니라 앱이 안 깨짐. 의도된 stopgap임.
- 실제 영어 번역은 v0.3 타겟 시점(규제 산업/해외) 별도 PR. 그 시점까지 `/en`은 네비게이션/footer 링크에 노출 안 함. 검색엔진 색인 방지를 위해 **sitemap에서 제외 + robots.ts에서 `/en` Disallow**.
- 복사 스크립트: `pnpm i18n:sync` (package.json script, 단순히 ko/*.json을 en/*.json으로 덮어씀). 초기 셋업 및 ko 키 추가 시 수동 실행.

**존댓말 + ICU 예시** (한국어 카피 규칙 준수):

```json
// ko/landing.json
{
  "hero": {
    "title": "읽은 것까지 이해하는",
    "titleEm": "AI 지식 OS",
    "sub": "자료를 올려두시면 AI가 위키로 엮어드립니다.",
    "cta": "시작하기"
  },
  "pricing": {
    "pro": {
      "title": "Pro",
      "price": "₩4,900",
      "unit": "/ 월 + PAYG 크레딧"
    }
  },
  "upload": {
    "done": "{count, plural, other {#개의 자료를 업로드했어요}}"
  }
}
```

**ko에서 "OpenCairn"은 절대 번역 안 함** (상품명 고정). 이를 위해 `<Trans>` 컴포넌트 대신 인라인 interpolation으로 처리.

### Phase 3: 랜딩 포트

**소스**: `landing/landing.html` (1936줄, 10 섹션).

**섹션 → 컴포넌트 매핑** (`apps/web/src/components/landing/`):

| 섹션 | 컴포넌트 | 주요 인터랙션 |
|---|---|---|
| Hero (line 464) | `<Hero/>` | 타이포 애니메이션, typewriter caret, autocomplete list, agent hub SVG, live compile panel |
| Problem (630) | `<ProblemBand/>` | static |
| How it works (659) | `<HowItWorks/>` | scroll reveal |
| Agents (745) | `<AgentsGrid/>` | magnetic tilt cards |
| Workspace (828) | `<WorkspaceShowcase/>` | static + reveal |
| Try (Mini graph, 949) | `<MiniGraph/>` | SVG 노드 hover + edge highlight, tooltip |
| Who it's for (1042) | `<Personas/>` | static |
| VS (1165) | `<Comparison/>` | static (경쟁사 직접 언급 금지 규칙 — 기존 HTML도 이미 이 규칙 준수하는지 검증 필요. 위반 시 포트 과정에서 수정) |
| Who is it for (1230) | `<ForWhom/>` | static |
| Docs (1288) | `<DocsTeaser/>` | static |
| Pricing (1347) | `<Pricing/>` | static, 숫자는 `billing-model.md` 기준 하드코딩 (Plan 9b에서 API 연결 시 props로 교체) |
| FAQ (1493) | `<Faq/>` | `<details>` 기반 |
| CTA (1561) | `<Cta/>` | counter-up 숫자 애니메이션 |

**커스텀 훅** (`apps/web/src/lib/landing/hooks/`):

- `useScrollReveal(ref)` — IntersectionObserver, once=true, `.reveal.in` 토글
- `useMagneticTilt(ref)` — mousemove → transform rotateX/rotateY
- `useCountUp(target, duration)` — rAF 기반 숫자 증가
- `useTypewriter(words, speed)` — 문구 순환
- `useCairnStack(ref)` — 로고 클릭 시 돌 쌓기 애니메이션

훅들은 `apps/web/src/lib/hooks/` 대시보드 재사용 가능한 위치 대신 `lib/landing/hooks/`에 두어 **랜딩 전용 bundle 경계**를 유지. (대시보드에서 scroll-reveal이 필요해지면 그때 승격.)

**폰트 로딩**:
- Instrument Serif, Inter, JetBrains Mono → `next/font/google` (self-hosted, CLS 방지).
- Pretendard Variable → `next/font/local` 또는 기존 CDN CSS 유지. CDN 의존은 오프라인 self-host 시나리오(v0.3) 깨트리므로 **`next/font/local` 권장**, v0.1에선 빠른 진행 위해 CDN 유지도 허용하되 `TODO(v0.2)` 주석.

**Tailwind CDN 제거**:
- `landing.html`은 `https://cdn.tailwindcss.com` + inline `tailwind.config` 사용. 이 config의 stone/ember 팔레트를 `globals.css`의 `[data-brand="landing"]` 블록으로 이관. 전부 로컬 Tailwind v4 config로 대체.

**문자열 추출**:
- 모든 한국어 문자열을 `messages/ko/landing.json`으로 이동. JSX에서는 `useTranslations('landing')` 훅으로 참조.
- OpenGraph 메타(title/description)는 `generateMetadata`에서 `getTranslations`로 처리.
- en 값은 ko 값 복제로 초기화.

**SSG**:
- 랜딩은 `export const dynamic = 'force-static'`. locale별(ko/en) 정적 생성.
- 인터랙션 훅들은 `'use client'` 컴포넌트로 격리.

**SEO**:
- `sitemap.ts` 생성: `/`, `/en` (단, en은 robots.txt에서 `Disallow` 또는 sitemap 제외 — 실제 번역 전까지 검색엔진 index 막음).
- `robots.ts` 생성.
- hreflang 태그는 en 번역 완료 시점에 추가 (v0.1에선 생략).

## 컴포넌트 경계 & 재사용

| 경계 | 위치 | 재사용 대상 |
|---|---|---|
| 테마 토큰 | `globals.css` @theme 블록 | 랜딩 + 앱 전역 |
| 테마 Provider | `src/lib/theme/` | 앱 영역 전용 (랜딩은 고정) |
| 랜딩 브랜드 토큰 | `globals.css` `[data-brand="landing"]` | 랜딩 섹션 컴포넌트 전용 |
| 랜딩 훅 | `src/lib/landing/hooks/` | 랜딩 전용 (대시보드 승격 시 `src/lib/hooks/`로 이동) |
| 랜딩 섹션 | `src/components/landing/` | 랜딩 페이지 전용 |
| 마케팅 헤더/푸터 | `src/components/landing/chrome/` | 랜딩 전용 (앱 헤더와 분리) |
| i18n 메시지 | `messages/{locale}/*.json` | 전역 |
| i18n 클라이언트 | `src/i18n.ts` | 전역 |

## 에러·엣지 케이스

- **테마 값 손상**: localStorage에 들어있는 테마명이 허용 목록에 없으면 `cairn-light`로 silent fallback + localStorage 정리.
- **i18n 누락 키**: next-intl 기본 behavior는 개발 모드 경고 + 프로덕션 키 문자열 그대로 노출. `messages/en/*.json`은 ko 복제로 초기화되어 있으므로 기본적으로 누락 없음. CI에서 ko ↔ en 키 parity lint 추가.
- **prefers-reduced-motion**: 랜딩 훅들(useScrollReveal, useMagneticTilt, useTypewriter, useCountUp)은 전부 `matchMedia('(prefers-reduced-motion: reduce)')` 체크, 참이면 애니메이션 skip하고 final state 즉시 렌더.
- **IntersectionObserver 정리**: 10개 섹션 동시 관찰 시 성능 이슈 없음. 훅 내부에서 요소가 한 번 visible 되면 `observer.disconnect()`로 즉시 해제(once=true 의미).
- **SSR 테마 불일치**: 서버는 쿠키 기반, 클라이언트는 localStorage 우선. 충돌 시 클라이언트 값이 승리하되 초기 flash 1 프레임 수용.

## 테스팅

- **단위**: `useScrollReveal`, `useCountUp`, `useTypewriter` — React Testing Library + fake timers.
- **통합**: ThemeProvider 토글 → `document.documentElement.dataset.theme` 변경 확인. i18n locale 변경 → 번역 문자열 변경 확인.
- **Playwright smoke** (수동 실행 + CI):
  - `/` 로드 → `data-theme="cairn-light"` 확인 + hero 텍스트 ko.
  - `/en` 로드 → locale=en 확인 (값은 ko fallback이지만 URL 구조 검증).
  - `/dashboard` 로드 → 테마 토글 버튼 클릭 → 4개 테마 순회.
- **시각 확인**: 포트 완료 후 `landing.html`과 `localhost:3000/` 병치 비교. 픽셀 일치는 안 하되 구조/톤 동일 확인. grain, scroll reveal, magnetic tilt, mini-graph hover, counter-up 동작 영상 기록.

## 의존성 / 추가 패키지

```
apps/web/package.json 에 추가:
  "dependencies": {
    "next-intl": "^3.x"
  }
```

그 외 theme provider, hooks는 자체 구현으로 신규 런타임 의존 없음.

## 구현 phase

본 스펙은 단일 스펙이지만 구현은 **세 phase 직렬** 진행:

1. **Theme 시스템** — `globals.css` @theme + 4 테마 variable set, ThemeProvider, 쿠키 SSR, 토글 UI(임시 placeholder).
2. **i18n 인프라** — next-intl 설치 + middleware + `[locale]` 라우트 그룹 + 기존 `(app)/dashboard` 이관 + 빈 메시지 파일.
3. **랜딩 포트** — 섹션 10개 컴포넌트 + 훅 5개 + 문자열 전량 ko 메시지 이동 + CDN Tailwind 제거 + next/font + SSG.

각 phase 완료 시 verification(타입체크, 빌드, 수동 시각) → 리뷰 → 커밋 → 다음 phase. 자세한 task 분해는 `plans/2026-04-20-plan-9a-web-foundation-and-landing.md`.

## Plan 9 분할

기존 `plans/2026-04-09-plan-9-billing-marketing.md`는 둘로 쪼갠다:

- **`plan-9a-web-foundation-and-landing.md`** (본 스펙 구현) — 테마 + i18n + 랜딩 포트 + footer placeholder 페이지(privacy/terms/pricing 빈 shell).
- **`plan-9b-billing-engine.md`** (BLOCKED, 사업자등록 후) — PAYG 크레딧 엔진, 결제 레일 (Toss), 랜딩 Pricing 섹션 API 연결, 환불 정책 본문, Export API (GDPR), 블로그, 법적 문서 본문.

Plan 9a는 BLOCKED 해제 불필요 (결제 의존 없음). 즉시 실행 가능.

## 성공 기준

- [ ] `pnpm --filter @opencairn/web build` 성공, 타입 에러 0.
- [ ] `/` 접속 시 `landing.html` 톤과 시각적으로 동일 (warm editorial, stone+ember, 폰트, 간격, 인터랙션).
- [ ] 랜딩 모든 문자열이 `messages/ko/landing.json`에서 로드됨 (JSX 내 하드코딩 한국어 0).
- [ ] `/dashboard` (로그인 후)에서 테마 토글 동작, 4 테마 순회 가능, 새로고침 후 유지.
- [ ] `prefers-reduced-motion: reduce` 환경에서 애니메이션 전부 비활성.
- [ ] CI가 ko/en 메시지 키 parity lint 통과.
- [ ] Lighthouse 랜딩 Performance ≥ 90, Accessibility ≥ 95.
