# Plan 9a: Web Foundation (Theme + i18n + Landing Port) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `apps/web`에 멀티테마(CSS variables + `data-theme`, 4 팔레트) + i18n 인프라(next-intl, ko-first + en stopgap) + 랜딩 포트(`landing/landing.html` → Next.js 16 섹션 컴포넌트 10개)를 구축한다. 이후 모든 Plan에서 도입되는 user-facing 문자열을 i18n 키로 강제하는 ESLint 규율을 확립한다.

**Architecture:** Tailwind v4 `@theme` 블록이 CSS variable 간접참조로 색 토큰을 선언하고, `<html data-theme>` 속성 스왑으로 런타임 테마 전환. next-intl middleware가 `/` (ko) / `/en/...` 라우팅을 처리하며 메시지는 `apps/web/messages/{locale}/*.json`에 namespace별로 분할. 랜딩은 `src/components/landing/` 섹션 컴포넌트 10개 + `src/lib/landing/hooks/` 커스텀 훅 5개(scroll reveal, magnetic tilt, count up, typewriter, cairn stack)로 구성되며 `/[locale]/page.tsx`에서 조립. 앱 영역(`/dashboard` 등)은 `[locale]/(app)/` 하위로 이관.

**Tech Stack:** Next.js 16, React 19, Tailwind CSS v4, next-intl 3.x, next/font, TypeScript 5.8, ESLint (eslint-plugin-i18next or jsx-no-literals)

**Spec:** [`docs/superpowers/specs/2026-04-20-web-foundation-design.md`](../specs/2026-04-20-web-foundation-design.md)

> **전제:** Plan 1 완료 (HEAD `50eaf3b`). Plan 13 (multi-LLM) · Plan 12 (agent runtime)과 **독립** — 언제든 실행 가능.
>
> **Plan 9 분할:** 기존 `plan-9-billing-marketing.md`는 본 plan(9a) + `plan-9b-billing-engine.md`(사업자등록 후 deferred)로 분할됨. Task 0에서 파일 재명명 처리.

---

## File Structure

```
apps/web/
├── eslint.config.mjs                         -- NEW: flat config, i18n-key 강제 룰
├── package.json                              -- MODIFY: next-intl, eslint-plugin
├── next.config.ts                            -- MODIFY: next-intl plugin
├── messages/
│   ├── ko/
│   │   ├── common.json                       -- NEW
│   │   ├── landing.json                      -- NEW
│   │   └── dashboard.json                    -- NEW
│   └── en/
│       ├── common.json                       -- NEW (ko 복사 stopgap)
│       ├── landing.json                      -- NEW (ko 복사 stopgap)
│       └── dashboard.json                    -- NEW (ko 복사 stopgap)
├── scripts/
│   ├── i18n-sync.mjs                         -- NEW: ko → en 복사
│   └── i18n-parity.mjs                       -- NEW: 키 parity 검사
├── src/
│   ├── i18n.ts                               -- NEW: next-intl getRequestConfig
│   ├── middleware.ts                         -- NEW: locale + auth 결합
│   ├── app/
│   │   ├── globals.css                       -- REWRITE: @theme + data-theme blocks
│   │   ├── layout.tsx                        -- REWRITE: dynamic lang + data-theme SSR
│   │   ├── page.tsx                          -- DELETE (moves to [locale]/page.tsx)
│   │   ├── (app)/                            -- DELETE (moves to [locale]/(app)/)
│   │   ├── [locale]/
│   │   │   ├── layout.tsx                    -- NEW: NextIntlClientProvider
│   │   │   ├── page.tsx                      -- NEW: 랜딩 조립
│   │   │   └── (app)/
│   │   │       ├── layout.tsx                -- MOVED from src/app/(app)/layout.tsx
│   │   │       └── dashboard/
│   │   │           └── page.tsx              -- MOVED
│   │   ├── api/[...path]/route.ts            -- UNCHANGED (locale prefix 없음)
│   │   ├── sitemap.ts                        -- NEW
│   │   └── robots.ts                         -- NEW
│   ├── components/
│   │   └── landing/
│   │       ├── chrome/
│   │       │   ├── Header.tsx                -- NEW
│   │       │   └── Footer.tsx                -- NEW
│   │       ├── Hero.tsx                      -- NEW
│   │       ├── ProblemBand.tsx               -- NEW
│   │       ├── HowItWorks.tsx                -- NEW
│   │       ├── AgentsGrid.tsx                -- NEW
│   │       ├── WorkspaceShowcase.tsx         -- NEW
│   │       ├── MiniGraph.tsx                 -- NEW
│   │       ├── Personas.tsx                  -- NEW
│   │       ├── Comparison.tsx                -- NEW
│   │       ├── ForWhom.tsx                   -- NEW
│   │       ├── DocsTeaser.tsx                -- NEW
│   │       ├── Pricing.tsx                   -- NEW
│   │       ├── Faq.tsx                       -- NEW
│   │       └── Cta.tsx                       -- NEW
│   └── lib/
│       ├── api-client.ts                     -- UNCHANGED
│       ├── theme/
│       │   ├── themes.ts                     -- NEW: registry
│       │   ├── cookie.ts                     -- NEW: read/write theme cookie
│       │   ├── provider.tsx                  -- NEW: ThemeProvider + useTheme
│       │   └── ThemeToggle.tsx               -- NEW: toggle UI
│       └── landing/
│           ├── hooks/
│           │   ├── useScrollReveal.ts        -- NEW
│           │   ├── useMagneticTilt.ts        -- NEW
│           │   ├── useCountUp.ts             -- NEW
│           │   ├── useTypewriter.ts          -- NEW
│           │   └── useCairnStack.ts          -- NEW
│           └── fonts.ts                      -- NEW: next/font exports
└── tests/
    └── e2e/
        └── landing-smoke.spec.ts             -- NEW: Playwright

docs/superpowers/plans/
└── 2026-04-09-plan-9-billing-marketing.md    -- RENAME to plan-9b-billing-engine.md + 헤더 갱신

CLAUDE.md                                     -- MODIFY: Plan index에 9a 추가, 9 → 9b로 변경
```

---

## Task 0: Plan 9 분할 준비

**Files:**
- Rename: `docs/superpowers/plans/2026-04-09-plan-9-billing-marketing.md` → `docs/superpowers/plans/2026-04-09-plan-9b-billing-engine.md`
- Modify: renamed file 헤더 (deprecation/split note 추가)
- Modify: `CLAUDE.md` Plan index 섹션

- [ ] **Step 1: git mv로 Plan 9 파일 재명명**

```bash
cd C:/Users/Sungbin/Documents/GitHub/opencairn-monorepo
git mv docs/superpowers/plans/2026-04-09-plan-9-billing-marketing.md \
       docs/superpowers/plans/2026-04-09-plan-9b-billing-engine.md
```

- [ ] **Step 2: 재명명된 파일 맨 위에 split 공지 추가**

파일 첫 줄(기존 `# Plan 9: Billing & Marketing — Implementation Plan`)을 다음으로 **교체**:

```markdown
# Plan 9b: Billing Engine — Implementation Plan

> **🚧 상태: BLOCKED (사업자등록 후 unblock)** — 결제 레일 (Toss Payments 또는 대안)은 사업자등록 완료 이후 결정. Provider-agnostic core는 미리 설계 가능.
>
> **Plan 9 분할 이력:** 기존 `plan-9-billing-marketing.md`는 2026-04-20에 둘로 분할됨.
> - **Plan 9a** (`plan-9a-web-foundation-and-landing.md`): 테마 + i18n + 랜딩 포트 + footer placeholder. 이미 실행 가능.
> - **Plan 9b** (본 파일): PAYG 크레딧 엔진, Toss 연동, 결제 UI, 환불 정책 본문, GDPR export, 블로그, 법적 문서 본문.
>
> 기존 Task 목차 중 **marketing 섹션 (landing page, MDX blog, pricing page, docs teaser 등)은 Plan 9a로 이관**됨. 본 파일 하위 task 중 마케팅 관련 내용은 Plan 9a 완료 여부 확인 후 해당 항목 스킵 또는 재활용.
```

- [ ] **Step 3: CLAUDE.md Plan index 업데이트**

`CLAUDE.md` 내 Plan 9 라인 (`plans/2026-04-09-plan-9-billing-marketing.md`)을 찾아 다음 두 줄로 교체:

```markdown
| **1** | `plans/2026-04-20-plan-9a-web-foundation-and-landing.md` | **테마(4팔레트) + i18n 인프라(next-intl, ko-first) + 랜딩 포트(landing.html → Next.js 섹션 10개)**. Plan 1 독립. 본 Plan 후 모든 user-facing 문자열은 i18n 키 강제. |
| **1** | `plans/2026-04-09-plan-9b-billing-engine.md` | **BLOCKED (사업자등록 후)** PAYG 크레딧 엔진, Toss 연동, 결제 UI, 환불, Export(GDPR), 블로그, 법적 문서 본문. Plan 9a의 Pricing 섹션 숫자를 API로 교체. |
```

- [ ] **Step 4: 커밋**

```bash
git add docs/superpowers/plans/2026-04-09-plan-9b-billing-engine.md \
        CLAUDE.md
git commit -m "docs(plans): split plan-9 into 9a (web foundation) + 9b (billing, BLOCKED)"
```

---

## Phase 1: Theme 시스템

### Task 1: globals.css 테마 토큰 + 4 팔레트

**Files:**
- Rewrite: `apps/web/src/app/globals.css`

- [ ] **Step 1: globals.css 전체 교체**

현재 내용(`@import "tailwindcss";` 한 줄)을 다음으로 **완전 교체**:

```css
@import "tailwindcss";

/* ═══ Brand fonts & runtime color tokens ═══ */
@theme {
  --font-serif: "Instrument Serif", Georgia, serif;
  --font-sans: "Inter", "Pretendard Variable", Pretendard, -apple-system, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;

  /* Color tokens — indirection through --theme-* (data-theme supplies real values) */
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

/* ═══ Cairn Light (default) ═══ */
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

/* ═══ Cairn Dark ═══ */
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

/* ═══ Sepia (warm reading) ═══ */
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

/* ═══ High Contrast (accessibility) ═══ */
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

/* ═══ Landing-only brand tokens (stone+ember warm editorial) ═══ */
[data-brand="landing"] {
  --brand-paper: #FFFFFF;
  --brand-ink: #000000;
  --brand-stone-50: #FFFFFF;
  --brand-stone-100: #F5F5F4;
  --brand-stone-200: #E7E5E4;
  --brand-stone-300: #D6D3D1;
  --brand-stone-400: #A8A29E;
  --brand-stone-500: #78716C;
  --brand-stone-600: #57534E;
  --brand-stone-700: #44403C;
  --brand-stone-800: #292524;
  --brand-stone-900: #1C1917;
  --brand-ember-50: #EDEAE2;
  --brand-ember-100: #E6E0D3;
  --brand-ember-200: #D8D3C8;
  --brand-ember-300: #9A9285;
  --brand-ember-500: #000000;
  --brand-ember-600: #000000;
  --brand-ember-700: #000000;
  --brand-ember-900: #000000;
  --brand-ember-cta: #EA580C;  /* 페이지 내 소량의 warm accent (typewriter caret, focus ring 등) */
}
```

- [ ] **Step 2: 빌드 확인**

```bash
cd C:/Users/Sungbin/Documents/GitHub/opencairn-monorepo
pnpm --filter @opencairn/web build
```

Expected: 빌드 성공. Tailwind v4가 @theme 블록을 파싱해 `bg-bg`, `text-fg`, `border-border` 등의 유틸리티를 생성.

- [ ] **Step 3: 커밋**

```bash
git add apps/web/src/app/globals.css
git commit -m "feat(web): add theme token system + 4 palettes (Cairn Light/Dark, Sepia, HC)"
```

---

### Task 2: Theme registry + 쿠키 utility

**Files:**
- Create: `apps/web/src/lib/theme/themes.ts`
- Create: `apps/web/src/lib/theme/cookie.ts`

- [ ] **Step 1: themes.ts 작성**

```ts
// apps/web/src/lib/theme/themes.ts

export const THEMES = ["cairn-light", "cairn-dark", "sepia", "high-contrast"] as const;
export type Theme = (typeof THEMES)[number];
export const DEFAULT_THEME: Theme = "cairn-light";

export const THEME_LABELS: Record<Theme, string> = {
  "cairn-light": "Cairn Light",
  "cairn-dark": "Cairn Dark",
  sepia: "Sepia",
  "high-contrast": "High Contrast",
};

export function isTheme(v: unknown): v is Theme {
  return typeof v === "string" && (THEMES as readonly string[]).includes(v);
}
```

- [ ] **Step 2: cookie.ts 작성**

```ts
// apps/web/src/lib/theme/cookie.ts
// 서버에서 cookie → theme 읽기, 클라이언트에서 theme → cookie 쓰기 헬퍼

import { DEFAULT_THEME, isTheme, type Theme } from "./themes";

export const THEME_COOKIE = "opencairn.theme";

// 서버용 — Next.js cookies() 결과 전달받아 파싱
export function themeFromCookieValue(raw: string | undefined): Theme {
  return isTheme(raw) ? raw : DEFAULT_THEME;
}

// 클라이언트용 — document.cookie에 씀
export function writeThemeCookie(theme: Theme) {
  if (typeof document === "undefined") return;
  const oneYear = 60 * 60 * 24 * 365;
  document.cookie = `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${oneYear}; SameSite=Lax`;
}
```

- [ ] **Step 3: 커밋**

```bash
git add apps/web/src/lib/theme/themes.ts apps/web/src/lib/theme/cookie.ts
git commit -m "feat(web): add theme registry + cookie helpers"
```

---

### Task 3: ThemeProvider + useTheme 훅

**Files:**
- Create: `apps/web/src/lib/theme/provider.tsx`

- [ ] **Step 1: ThemeProvider 작성**

```tsx
// apps/web/src/lib/theme/provider.tsx
"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { DEFAULT_THEME, THEMES, type Theme, isTheme } from "./themes";
import { writeThemeCookie } from "./cookie";

type ThemeCtx = {
  theme: Theme;
  setTheme: (next: Theme) => void;
  themes: readonly Theme[];
};

const Ctx = createContext<ThemeCtx | null>(null);

export function ThemeProvider({
  initialTheme,
  children,
}: {
  initialTheme: Theme;
  children: ReactNode;
}) {
  const [theme, setThemeState] = useState<Theme>(initialTheme);

  // Hydration 직후 localStorage / prefers-color-scheme 보정 (로그인 쿠키 우선, 게스트만 해당)
  useEffect(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem("opencairn.theme") : null;
    if (stored && isTheme(stored) && stored !== initialTheme) {
      setThemeState(stored);
      document.documentElement.setAttribute("data-theme", stored);
      return;
    }
    // 아무 것도 없으면 prefers-color-scheme 시도
    if (!stored && typeof window !== "undefined") {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      if (prefersDark && initialTheme === DEFAULT_THEME) {
        setThemeState("cairn-dark");
        document.documentElement.setAttribute("data-theme", "cairn-dark");
      }
    }
  }, [initialTheme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    document.documentElement.setAttribute("data-theme", next);
    window.localStorage.setItem("opencairn.theme", next);
    writeThemeCookie(next);
  }, []);

  return <Ctx.Provider value={{ theme, setTheme, themes: THEMES }}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTheme must be used within ThemeProvider");
  return v;
}
```

- [ ] **Step 2: 커밋**

```bash
git add apps/web/src/lib/theme/provider.tsx
git commit -m "feat(web): add ThemeProvider with cookie + localStorage + prefers-color-scheme"
```

---

### Task 4: layout.tsx에서 쿠키 기반 SSR 초기 data-theme 주입

> 이 task는 **Task 9(i18n 라우팅 [locale] 이관) 이후 재작업** 된다. 여기서는 현재 구조(`src/app/layout.tsx`)를 먼저 맞추고, 이후 [locale] 레이아웃에서 같은 패턴을 이어감.

**Files:**
- Rewrite: `apps/web/src/app/layout.tsx`

- [ ] **Step 1: layout.tsx 교체**

```tsx
// apps/web/src/app/layout.tsx
import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { ThemeProvider } from "@/lib/theme/provider";
import { THEME_COOKIE, themeFromCookieValue } from "@/lib/theme/cookie";

export const metadata: Metadata = {
  title: "OpenCairn",
  description: "AI knowledge base for learning, research, and work.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const theme = themeFromCookieValue(cookieStore.get(THEME_COOKIE)?.value);

  return (
    <html lang="ko" data-theme={theme}>
      <body className="bg-bg text-fg antialiased">
        <ThemeProvider initialTheme={theme}>{children}</ThemeProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: 빌드 + 타입 확인**

```bash
pnpm --filter @opencairn/web build
```

Expected: 성공. "Cannot find module '@/lib/theme/..'" 에러 나면 `tsconfig.json`에 `paths` 매핑 (`"@/*": ["./src/*"]`) 존재 여부 확인.

- [ ] **Step 3: 커밋**

```bash
git add apps/web/src/app/layout.tsx
git commit -m "feat(web): SSR initial data-theme from cookie, wrap with ThemeProvider"
```

---

### Task 5: ThemeToggle 컴포넌트 + 대시보드 검증

**Files:**
- Create: `apps/web/src/lib/theme/ThemeToggle.tsx`
- Modify: `apps/web/src/app/(app)/dashboard/page.tsx` (임시로 Toggle 삽입)

- [ ] **Step 1: ThemeToggle.tsx 작성**

```tsx
// apps/web/src/lib/theme/ThemeToggle.tsx
"use client";

import { useTheme } from "./provider";
import { THEME_LABELS } from "./themes";

export function ThemeToggle() {
  const { theme, setTheme, themes } = useTheme();
  return (
    <select
      aria-label="Theme"
      value={theme}
      onChange={(e) => setTheme(e.target.value as typeof theme)}
      className="rounded border border-border bg-surface text-fg px-2 py-1 text-sm"
    >
      {themes.map((t) => (
        <option key={t} value={t}>
          {THEME_LABELS[t]}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 2: 대시보드 페이지에 Toggle 삽입 (임시)**

`apps/web/src/app/(app)/dashboard/page.tsx`를 읽고, 적당한 헤더 위치에 다음 import + 사용 추가:

```tsx
import { ThemeToggle } from "@/lib/theme/ThemeToggle";

// JSX 어딘가에:
<ThemeToggle />
```

(정확한 삽입 위치는 기존 dashboard 레이아웃에 맞춰 엔지니어 재량.)

- [ ] **Step 3: 로컬 수동 검증**

```bash
pnpm --filter @opencairn/web dev
```

브라우저로 `http://localhost:3000/dashboard` (로그인 후) 접속 → ThemeToggle select로 4개 테마 순회 확인. 새로고침 해도 선택한 테마 유지 (cookie + localStorage).

- [ ] **Step 4: 커밋**

```bash
git add apps/web/src/lib/theme/ThemeToggle.tsx apps/web/src/app/\(app\)/dashboard/page.tsx
git commit -m "feat(web): add ThemeToggle UI + dashboard temporary placement"
```

---

## Phase 2: i18n 인프라

### Task 6: next-intl 설치 + ESLint 플러그인 + next.config

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/next.config.ts`

- [ ] **Step 1: 의존성 추가**

```bash
cd C:/Users/Sungbin/Documents/GitHub/opencairn-monorepo
pnpm --filter @opencairn/web add next-intl
pnpm --filter @opencairn/web add -D eslint eslint-plugin-i18next
```

> 참고: next-intl 최신 major가 3.x → 4.x로 이동 중일 수 있음. `pnpm add`로 최신 설치 후 breaking change 있으면 마이그레이션 가이드 참조 (`context7:query-docs` 사용 가능).

- [ ] **Step 2: next.config.ts에 next-intl 플러그인 적용**

기존 `apps/web/next.config.ts` 파일 맨 위 + export를 다음처럼 감쌈:

```ts
// apps/web/next.config.ts
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n.ts");

const nextConfig: NextConfig = {
  // 기존 설정 유지
};

export default withNextIntl(nextConfig);
```

(기존 `nextConfig` 객체 내용은 건드리지 않고 wrap만.)

- [ ] **Step 3: 커밋**

```bash
git add apps/web/package.json apps/web/next.config.ts pnpm-lock.yaml
git commit -m "feat(web): install next-intl + eslint-plugin-i18next, wire next.config plugin"
```

---

### Task 7: 메시지 파일 디렉토리 + common namespace

**Files:**
- Create: `apps/web/messages/ko/common.json`
- Create: `apps/web/messages/ko/landing.json`
- Create: `apps/web/messages/ko/dashboard.json`
- Create: `apps/web/messages/en/common.json` (ko 복사)
- Create: `apps/web/messages/en/landing.json` (ko 복사)
- Create: `apps/web/messages/en/dashboard.json` (ko 복사)

- [ ] **Step 1: ko/common.json**

```json
{
  "nav": {
    "signIn": "로그인",
    "signUp": "시작하기",
    "dashboard": "대시보드"
  },
  "footer": {
    "legal": {
      "privacy": "개인정보처리방침",
      "terms": "이용약관",
      "refund": "환불 정책"
    },
    "copyright": "© OpenCairn"
  },
  "actions": {
    "save": "저장",
    "cancel": "취소",
    "delete": "삭제",
    "confirm": "확인"
  },
  "errors": {
    "generic": "문제가 발생했어요. 잠시 후 다시 시도해주세요.",
    "unauthorized": "로그인이 필요해요.",
    "notFound": "페이지를 찾을 수 없어요."
  }
}
```

- [ ] **Step 2: ko/landing.json — hero + 기본 섹션 스켈레톤**

```json
{
  "meta": {
    "title": "OpenCairn — 읽은 것까지 이해하는 AI 지식 OS",
    "description": "자료를 올려두면 AI가 위키로 엮고, 묻기 전에 연결을 발견하는 개인·팀 지식 OS. 12개 AI 에이전트, 셀프호스팅, AGPLv3."
  },
  "hero": {
    "eyebrow": "AI Knowledge OS",
    "title": "읽은 것까지 이해하는",
    "titleEm": "AI 지식 OS",
    "sub": "자료를 올려두시면 AI가 위키로 엮어드려요. 묻기 전에 연결을 발견해드립니다.",
    "cta": "시작하기",
    "ctaGhost": "데모 보기"
  },
  "problem": { "heading": "쓴 것만 담는 도구는 많습니다. OpenCairn은 읽은 것까지 이해합니다." },
  "how": { "heading": "어떻게 동작하나요" },
  "agents": { "heading": "12개의 AI 에이전트가 일합니다" },
  "workspace": { "heading": "개인 노트에서 팀 지식으로" },
  "try": { "heading": "연결이 먼저 보이는 경험" },
  "who": { "heading": "누구를 위한 도구인가요" },
  "vs": { "heading": "기존 도구와의 차이" },
  "forWhom": { "heading": "이런 분께 어울려요" },
  "docs": { "heading": "문서와 가이드" },
  "pricing": {
    "heading": "가격",
    "sub": "본인 데이터·속도·확실한 기능에 대한 예측 가능한 비용.",
    "free": {
      "name": "Free",
      "price": "₩0",
      "unit": "/ 월",
      "tagline": "체험용"
    },
    "byok": {
      "name": "BYOK",
      "price": "₩2,900",
      "unit": "/ 월",
      "tagline": "본인 Gemini 키 · 관리형 솔로"
    },
    "pro": {
      "name": "Pro",
      "price": "₩4,900",
      "unit": "/ 월 + PAYG",
      "tagline": "팀 · 연구실 · PAYG 크레딧 최소 ₩5,000"
    },
    "selfhost": {
      "name": "Self-host",
      "price": "₩0",
      "unit": "",
      "tagline": "AGPLv3 · 본인 서버 · 무제한"
    },
    "vat": "모든 금액 VAT 별도."
  },
  "faq": { "heading": "자주 묻는 질문" },
  "cta": {
    "heading": "5분이면 위키가 시작됩니다",
    "sub": "업로드 한 번으로 첫 위키 페이지가 생성되는 속도를 느껴보세요.",
    "primary": "시작하기",
    "secondary": "GitHub에서 보기"
  }
}
```

> 섹션별 세부 문자열은 Phase 3 각 섹션 컴포넌트 task에서 추가. 본 task는 **스켈레톤 + hero/pricing/cta** 키만.

- [ ] **Step 3: ko/dashboard.json — placeholder**

```json
{
  "nav": {
    "workspace": "워크스페이스",
    "settings": "설정",
    "signOut": "로그아웃"
  },
  "empty": {
    "title": "아직 노트가 없어요",
    "cta": "첫 노트 만들기"
  }
}
```

- [ ] **Step 4: en/ 디렉토리 — ko/ 복사 stopgap**

`apps/web/messages/ko/common.json`, `landing.json`, `dashboard.json` 파일 내용을 그대로 복사해서 `apps/web/messages/en/common.json`, `landing.json`, `dashboard.json` 생성. **값 번역 없이 그대로 복사**. 실제 영문 번역은 v0.1 런칭 직전 배치 pass에서 처리.

(수동 복사 또는 Task 9 sync 스크립트 미리 돌려도 됨.)

- [ ] **Step 5: 커밋**

```bash
git add apps/web/messages/
git commit -m "feat(web): add ko/en message skeletons (common, landing, dashboard)"
```

---

### Task 8: i18n.ts 설정 + middleware

**Files:**
- Create: `apps/web/src/i18n.ts`
- Create: `apps/web/src/middleware.ts`

- [ ] **Step 1: i18n.ts 작성**

```ts
// apps/web/src/i18n.ts
import { getRequestConfig } from "next-intl/server";
import { notFound } from "next/navigation";

export const locales = ["ko", "en"] as const;
export const defaultLocale = "ko" as const;
export type Locale = (typeof locales)[number];

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = (await requestLocale) ?? defaultLocale;
  if (!locales.includes(requested as Locale)) notFound();
  const locale = requested as Locale;

  const [common, landing, dashboard] = await Promise.all([
    import(`../messages/${locale}/common.json`).then((m) => m.default),
    import(`../messages/${locale}/landing.json`).then((m) => m.default),
    import(`../messages/${locale}/dashboard.json`).then((m) => m.default),
  ]);

  return {
    locale,
    messages: { common, landing, dashboard },
  };
});
```

- [ ] **Step 2: middleware.ts 작성**

```ts
// apps/web/src/middleware.ts
import createIntlMiddleware from "next-intl/middleware";
import { locales, defaultLocale } from "./i18n";

const intl = createIntlMiddleware({
  locales: [...locales],
  defaultLocale,
  localePrefix: "as-needed", // ko = no prefix (/), en = /en/...
  localeDetection: true,      // Accept-Language 자동 감지
});

export default intl;

export const config = {
  // api 제외, 정적 자원 제외
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
```

> ⚠️ 기존 Plan 1에서 Better Auth middleware가 있었다면 충돌 확인 필요. Better Auth는 보통 API 레이어 또는 layout-level guard로 처리했으므로 middleware.ts가 비어있었을 가능성이 높음. `Grep "middleware"` 로 확인.

- [ ] **Step 3: 빌드 확인**

```bash
pnpm --filter @opencairn/web build
```

Expected: 성공. import 오류나 next-intl 설정 오류 없음.

- [ ] **Step 4: 커밋**

```bash
git add apps/web/src/i18n.ts apps/web/src/middleware.ts
git commit -m "feat(web): add next-intl config + locale middleware (ko default + en)"
```

---

### Task 9: [locale] 라우트 그룹으로 이관

**Files:**
- Create: `apps/web/src/app/[locale]/layout.tsx`
- Move: `apps/web/src/app/page.tsx` → `apps/web/src/app/[locale]/page.tsx`
- Move: `apps/web/src/app/(app)/` → `apps/web/src/app/[locale]/(app)/`
- Modify: `apps/web/src/app/layout.tsx` (root) — html lang을 [locale]에서 받도록 조정

- [ ] **Step 1: 기존 `src/app/page.tsx` 이동**

```bash
cd C:/Users/Sungbin/Documents/GitHub/opencairn-monorepo
mkdir -p apps/web/src/app/\[locale\]
git mv apps/web/src/app/page.tsx apps/web/src/app/\[locale\]/page.tsx
git mv apps/web/src/app/\(app\) apps/web/src/app/\[locale\]/\(app\)
```

- [ ] **Step 2: `src/app/[locale]/layout.tsx` 신규 작성**

```tsx
// apps/web/src/app/[locale]/layout.tsx
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { locales, type Locale } from "@/i18n";

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(locales, locale)) notFound();
  setRequestLocale(locale as Locale);
  const messages = await getMessages();

  return <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>;
}
```

- [ ] **Step 3: root `src/app/layout.tsx` 조정 — `lang`을 동적으로 생성**

```tsx
// apps/web/src/app/layout.tsx
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import "./globals.css";
import { ThemeProvider } from "@/lib/theme/provider";
import { THEME_COOKIE, themeFromCookieValue } from "@/lib/theme/cookie";

export const metadata: Metadata = {
  title: "OpenCairn",
  description: "AI knowledge base for learning, research, and work.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const theme = themeFromCookieValue(cookieStore.get(THEME_COOKIE)?.value);
  // locale은 middleware가 설정하는 NEXT_LOCALE 쿠키에서 읽음 (또는 fallback 'ko')
  const locale = cookieStore.get("NEXT_LOCALE")?.value === "en" ? "en" : "ko";

  return (
    <html lang={locale} data-theme={theme}>
      <body className="bg-bg text-fg antialiased">
        <ThemeProvider initialTheme={theme}>{children}</ThemeProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 4: 임시 랜딩 페이지 — `[locale]/page.tsx`에서 `useTranslations` 시험 사용**

기존 placeholder 랜딩 내용을 i18n 확인용으로 교체:

```tsx
// apps/web/src/app/[locale]/page.tsx
import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n";

export default async function Landing({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LandingInner />;
}

function LandingInner() {
  const t = useTranslations("landing.hero");
  return (
    <main className="flex min-h-screen flex-col items-center justify-center">
      <h1 className="font-serif text-6xl">{t("title")}</h1>
      <p className="mt-4 text-lg text-fg-muted">{t("sub")}</p>
      <a
        href="/dashboard"
        className="mt-8 rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-accent-fg"
      >
        {t("cta")}
      </a>
    </main>
  );
}
```

- [ ] **Step 5: 빌드 + 수동 검증**

```bash
pnpm --filter @opencairn/web build
pnpm --filter @opencairn/web dev
```

브라우저로 `/` 접속 → 한국어 hero 표시 확인. `/en` 접속 → 동일 한국어 표시 (stopgap 복사 때문). `/dashboard` → 기존 대시보드 ([locale] 그룹으로 이동했어도 `as-needed` localePrefix라 URL은 그대로).

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/app/
git commit -m "feat(web): move routes under [locale] group, wire NextIntlClientProvider"
```

---

### Task 10: i18n sync + parity 스크립트

**Files:**
- Create: `apps/web/scripts/i18n-sync.mjs`
- Create: `apps/web/scripts/i18n-parity.mjs`
- Modify: `apps/web/package.json` (scripts)

- [ ] **Step 1: i18n-sync.mjs 작성**

```js
// apps/web/scripts/i18n-sync.mjs
// ko/*.json을 en/*.json으로 그대로 복사 (stopgap).
// 런칭 직전 실제 번역 작업 시점까지 매 ko 수정 후 수동 실행.
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KO = resolve(__dirname, "../messages/ko");
const EN = resolve(__dirname, "../messages/en");

const files = await readdir(KO);
for (const f of files) {
  if (!f.endsWith(".json")) continue;
  const content = await readFile(resolve(KO, f), "utf8");
  await mkdir(EN, { recursive: true });
  await writeFile(resolve(EN, f), content);
  console.log(`synced ${f}`);
}
console.log(`✓ synced ${files.filter((f) => f.endsWith(".json")).length} files from ko → en`);
```

- [ ] **Step 2: i18n-parity.mjs 작성**

```js
// apps/web/scripts/i18n-parity.mjs
// ko/*.json과 en/*.json의 키 구조가 동일한지 검증. CI에서 호출.
import { readdir, readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KO = resolve(__dirname, "../messages/ko");
const EN = resolve(__dirname, "../messages/en");

function collectKeys(obj, prefix = "") {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      keys.push(...collectKeys(v, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

let failed = false;
const files = (await readdir(KO)).filter((f) => f.endsWith(".json"));
for (const f of files) {
  const ko = JSON.parse(await readFile(resolve(KO, f), "utf8"));
  let en;
  try {
    en = JSON.parse(await readFile(resolve(EN, f), "utf8"));
  } catch {
    console.error(`✗ missing en/${f}`);
    failed = true;
    continue;
  }
  const koKeys = new Set(collectKeys(ko));
  const enKeys = new Set(collectKeys(en));
  const missing = [...koKeys].filter((k) => !enKeys.has(k));
  const extra = [...enKeys].filter((k) => !koKeys.has(k));
  if (missing.length || extra.length) {
    console.error(`✗ ${f} — missing in en: ${missing.join(", ") || "(none)"}; extra in en: ${extra.join(", ") || "(none)"}`);
    failed = true;
  } else {
    console.log(`✓ ${f} parity OK (${koKeys.size} keys)`);
  }
}
process.exit(failed ? 1 : 0);
```

- [ ] **Step 3: package.json scripts 추가**

`apps/web/package.json`의 `scripts` 블록에 추가:

```json
{
  "scripts": {
    "dev": "next dev --port 3000",
    "build": "next build",
    "start": "next start",
    "i18n:sync": "node scripts/i18n-sync.mjs",
    "i18n:parity": "node scripts/i18n-parity.mjs"
  }
}
```

- [ ] **Step 4: 실행 검증**

```bash
pnpm --filter @opencairn/web i18n:sync
pnpm --filter @opencairn/web i18n:parity
```

Expected: sync는 3 files copied, parity는 `✓ ... parity OK` × 3.

- [ ] **Step 5: 커밋**

```bash
git add apps/web/scripts apps/web/package.json
git commit -m "feat(web): add i18n:sync + i18n:parity scripts (ko → en stopgap + CI check)"
```

---

### Task 11: ESLint no-literal-string 룰 활성

**Files:**
- Create: `apps/web/.eslintrc.mjs` (or `eslint.config.mjs` per ESLint 9 flat config)

- [ ] **Step 1: ESLint 설정 파일 작성**

monorepo에 기존 ESLint config가 있는지 먼저 확인:

```bash
find C:/Users/Sungbin/Documents/GitHub/opencairn-monorepo -maxdepth 3 -name ".eslintrc*" -o -name "eslint.config*" 2>/dev/null
```

**없으면** — `apps/web/eslint.config.mjs` 신규 생성 (flat config):

```js
// apps/web/eslint.config.mjs
import nextPlugin from "@next/eslint-plugin-next";
import i18next from "eslint-plugin-i18next";

export default [
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: {
      i18next,
      "@next/next": nextPlugin,
    },
    rules: {
      "i18next/no-literal-string": [
        "error",
        {
          mode: "jsx-text-only",
          "jsx-attributes": {
            include: ["alt", "aria-label", "title", "placeholder"],
          },
          callees: { exclude: ["useTranslations", "getTranslations", "console\\.(log|warn|error)"] },
          words: {
            exclude: [
              "^\\s*$",           // 공백
              "^[0-9]+$",         // 숫자
              "^[!-/:-@\\[-`{-~]+$", // 특수문자만
              "^OpenCairn$",      // 상표
            ],
          },
        },
      ],
    },
  },
  {
    files: ["src/**/*.test.{ts,tsx}", "tests/**/*.{ts,tsx}"],
    rules: { "i18next/no-literal-string": "off" },
  },
  {
    files: ["scripts/**/*.mjs"],
    rules: { "i18next/no-literal-string": "off" },
  },
];
```

**기존 config 있으면** — 해당 파일에 `i18next` 플러그인 + 룰 추가.

- [ ] **Step 2: package.json에 lint script 추가**

`apps/web/package.json`:

```json
{
  "scripts": {
    "lint": "eslint src --max-warnings 0"
  }
}
```

- [ ] **Step 3: 초기 lint 실행 + 위반 수정**

```bash
pnpm --filter @opencairn/web lint
```

- 기존 `ThemeToggle.tsx`의 `aria-label="Theme"` 같은 하드코딩 문자열을 i18n 키로 교체 또는 예외 처리 (상표성 토큰은 허용).
- 기존 `[locale]/page.tsx`는 이미 `useTranslations` 사용 중이라 OK.
- 원칙: JSX 내 한글/영어 텍스트가 리터럴로 있으면 키화. ThemeToggle의 `"Theme"` 같은 건 `common.actions.theme` 키 추가해서 해결.

- [ ] **Step 4: CI 워크플로우에 lint step 추가** (OpenCairn GitHub Actions 파일)

`.github/workflows/ci.yml` 또는 동등한 파일 찾아서 `apps/web` lint 스텝 추가:

```yaml
- name: Lint apps/web
  run: pnpm --filter @opencairn/web lint
- name: i18n key parity
  run: pnpm --filter @opencairn/web i18n:parity
```

(기존 워크플로우 파일 위치는 `find .github -name "*.yml"` 로 확인.)

- [ ] **Step 5: 커밋**

```bash
git add apps/web/eslint.config.mjs apps/web/package.json .github/workflows/
git commit -m "feat(web): enforce i18n-key discipline via eslint + CI parity check"
```

---

### Task 12: i18n 규칙을 CLAUDE.md에 문서화

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: CLAUDE.md에 i18n 섹션 추가**

`CLAUDE.md`의 `## Rules & Workflow` 블록 직후에 새 섹션 삽입:

```markdown
## i18n 규율 (Plan 9a 이후 전 코드 적용)

`apps/web` 내 **모든 user-facing 문자열은 i18n 키로 정의** 필수. 하드코딩 금지.

- ko 값만 채우고 en은 `pnpm --filter @opencairn/web i18n:sync`로 ko 복사 stopgap 유지
- JSX 리터럴 한국어/영어 → ESLint `i18next/no-literal-string` 룰이 CI에서 error
- 예외: 상표 "OpenCairn", 개발자 로그, 테스트 fixture, CLI 스크립트 출력
- 조사 분기는 ICU `{item, select, consonant {을} other {를}}` 패턴
- 카피 규칙: 존댓말, 경쟁사 미언급, 기술 스택 상세 최소화 (기존 브랜드 규칙 준수)
- 상세: `docs/superpowers/specs/2026-04-20-web-foundation-design.md` § i18n 규율
```

- [ ] **Step 2: 커밋**

```bash
git add CLAUDE.md
git commit -m "docs: document i18n key discipline rule in CLAUDE.md"
```

---

## Phase 3: 랜딩 포트

### Task 13: 폰트 로딩 (next/font)

**Files:**
- Create: `apps/web/src/lib/landing/fonts.ts`
- Modify: `apps/web/src/app/layout.tsx` (폰트 variable 주입)

- [ ] **Step 1: fonts.ts 작성**

```ts
// apps/web/src/lib/landing/fonts.ts
import { Instrument_Serif, Inter, JetBrains_Mono } from "next/font/google";

export const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-serif-raw",
  display: "swap",
});

export const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-sans-raw",
  display: "swap",
});

export const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono-raw",
  display: "swap",
});
```

> **Pretendard**: `next/font/local`로 self-host 할지 CDN 유지할지 결정. v0.1 빠른 진행 위해 CDN link를 layout.tsx `<head>`에 두고 `TODO(v0.2): self-host Pretendard via next/font/local` 주석 추가 (spec 허용 범위).

- [ ] **Step 2: layout.tsx에 font variable 주입 + Pretendard CDN**

```tsx
// apps/web/src/app/layout.tsx (추가)
import { instrumentSerif, inter, jetbrainsMono } from "@/lib/landing/fonts";

// ... RootLayout 내부 html className에 variable 추가:
<html
  lang={locale}
  data-theme={theme}
  className={`${instrumentSerif.variable} ${inter.variable} ${jetbrainsMono.variable}`}
>
  <head>
    {/* TODO(v0.2): self-host Pretendard via next/font/local */}
    <link
      rel="stylesheet"
      as="style"
      crossOrigin=""
      href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
    />
  </head>
  <body ...>
```

- [ ] **Step 3: globals.css에서 Tailwind font-family가 해당 변수 사용하도록 @theme 갱신**

`@theme` 블록의 font-family 라인을 다음으로 교체:

```css
--font-serif: var(--font-serif-raw), Georgia, serif;
--font-sans: var(--font-sans-raw), "Pretendard Variable", Pretendard, -apple-system, system-ui, sans-serif;
--font-mono: var(--font-mono-raw), ui-monospace, monospace;
```

- [ ] **Step 4: 빌드 확인**

```bash
pnpm --filter @opencairn/web build
```

- [ ] **Step 5: 커밋**

```bash
git add apps/web/src/lib/landing/fonts.ts apps/web/src/app/layout.tsx apps/web/src/app/globals.css
git commit -m "feat(web): wire next/font for Instrument Serif + Inter + JetBrains Mono, Pretendard via CDN"
```

---

### Task 14: 커스텀 훅 5개 작성

**Files:**
- Create: `apps/web/src/lib/landing/hooks/useScrollReveal.ts`
- Create: `apps/web/src/lib/landing/hooks/useMagneticTilt.ts`
- Create: `apps/web/src/lib/landing/hooks/useCountUp.ts`
- Create: `apps/web/src/lib/landing/hooks/useTypewriter.ts`
- Create: `apps/web/src/lib/landing/hooks/useCairnStack.ts`

> 각 훅은 **prefers-reduced-motion 체크 포함**. 모션 reduce 환경에서는 애니메이션 skip하고 final state 즉시 렌더.

- [ ] **Step 1: useScrollReveal**

```ts
// apps/web/src/lib/landing/hooks/useScrollReveal.ts
"use client";
import { useEffect, type RefObject } from "react";

export function useScrollReveal(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      el.classList.add("in");
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            (e.target as HTMLElement).classList.add("in");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -10% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
}
```

- [ ] **Step 2: useMagneticTilt**

```ts
// apps/web/src/lib/landing/hooks/useMagneticTilt.ts
"use client";
import { useEffect, type RefObject } from "react";

export function useMagneticTilt(ref: RefObject<HTMLElement | null>, strength = 8) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;

    function onMove(ev: MouseEvent) {
      const rect = el.getBoundingClientRect();
      const x = ev.clientX - rect.left - rect.width / 2;
      const y = ev.clientY - rect.top - rect.height / 2;
      const rx = (-y / rect.height) * strength;
      const ry = (x / rect.width) * strength;
      el.style.transform = `perspective(600px) rotateX(${rx}deg) rotateY(${ry}deg)`;
    }
    function onLeave() {
      el.style.transform = "";
    }
    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
    };
  }, [ref, strength]);
}
```

- [ ] **Step 3: useCountUp**

```ts
// apps/web/src/lib/landing/hooks/useCountUp.ts
"use client";
import { useEffect, useState, type RefObject } from "react";

export function useCountUp(ref: RefObject<HTMLElement | null>, target: number, duration = 1200) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setValue(target);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const start = performance.now();
        function tick(now: number) {
          const p = Math.min(1, (now - start) / duration);
          setValue(Math.round(target * (1 - Math.pow(1 - p, 3))));
          if (p < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
        io.unobserve(e.target);
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, target, duration]);
  return value;
}
```

- [ ] **Step 4: useTypewriter**

```ts
// apps/web/src/lib/landing/hooks/useTypewriter.ts
"use client";
import { useEffect, useState } from "react";

export function useTypewriter(words: string[], speed = 80, pause = 1400) {
  const [text, setText] = useState("");
  const [wordIdx, setWordIdx] = useState(0);
  const [charIdx, setCharIdx] = useState(0);
  const [dir, setDir] = useState<"fwd" | "back">("fwd");

  useEffect(() => {
    if (!words.length) return;
    const reduce = typeof window !== "undefined"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setText(words[0]);
      return;
    }
    const current = words[wordIdx];
    if (dir === "fwd" && charIdx < current.length) {
      const t = setTimeout(() => setCharIdx((c) => c + 1), speed);
      setText(current.slice(0, charIdx + 1));
      return () => clearTimeout(t);
    }
    if (dir === "fwd" && charIdx === current.length) {
      const t = setTimeout(() => setDir("back"), pause);
      return () => clearTimeout(t);
    }
    if (dir === "back" && charIdx > 0) {
      const t = setTimeout(() => setCharIdx((c) => c - 1), speed / 2);
      setText(current.slice(0, charIdx - 1));
      return () => clearTimeout(t);
    }
    if (dir === "back" && charIdx === 0) {
      setDir("fwd");
      setWordIdx((i) => (i + 1) % words.length);
    }
  }, [wordIdx, charIdx, dir, words, speed, pause]);

  return text;
}
```

- [ ] **Step 5: useCairnStack**

```ts
// apps/web/src/lib/landing/hooks/useCairnStack.ts
"use client";
import { useEffect, type RefObject } from "react";

// 로고 클릭 시 돌 쌓이는 가벼운 애니메이션. landing.html 원본의 cairn-stacker를 React로 이식.
export function useCairnStack(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function onClick() {
      if (reduce) return;
      el.animate(
        [
          { transform: "translateY(0)" },
          { transform: "translateY(-4px)" },
          { transform: "translateY(0)" },
        ],
        { duration: 320, easing: "cubic-bezier(0.22,0.61,0.36,1)" }
      );
    }
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [ref]);
}
```

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/lib/landing/hooks
git commit -m "feat(web): add landing hooks (scrollReveal, magneticTilt, countUp, typewriter, cairnStack)"
```

---

### Task 15: 랜딩 chrome (Header + Footer)

**Files:**
- Create: `apps/web/src/components/landing/chrome/Header.tsx`
- Create: `apps/web/src/components/landing/chrome/Footer.tsx`

> 랜딩 chrome은 `data-brand="landing"` + `data-theme="cairn-light"` 고정. 앱 헤더와 완전 분리.

- [ ] **Step 1: Header.tsx**

참조: `landing/landing.html` line 430~460 (상단 logo + 네비). 원본 클래스·레이아웃 유지, 문자열은 `useTranslations("common.nav")` + `useTranslations("landing.hero")`로 키화.

```tsx
// apps/web/src/components/landing/chrome/Header.tsx
"use client";
import { useRef } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCairnStack } from "@/lib/landing/hooks/useCairnStack";

export function LandingHeader() {
  const tNav = useTranslations("common.nav");
  const tLanding = useTranslations("landing");
  const logoRef = useRef<HTMLSpanElement>(null);
  useCairnStack(logoRef);

  return (
    <header className="sticky top-0 z-30 border-b border-[color:var(--brand-stone-200)] bg-[color:var(--brand-paper)]/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-baseline gap-2.5">
          <span
            ref={logoRef}
            className="font-serif text-2xl text-[color:var(--brand-stone-900)]"
          >
            OpenCairn
          </span>
        </Link>
        <nav className="flex items-center gap-6 text-sm">
          <a href="#pricing" className="text-[color:var(--brand-stone-600)] hover:text-[color:var(--brand-stone-900)]">
            {tLanding("pricing.heading")}
          </a>
          <Link href="/dashboard" className="text-[color:var(--brand-stone-600)] hover:text-[color:var(--brand-stone-900)]">
            {tNav("signIn")}
          </Link>
          <Link
            href="/dashboard"
            className="rounded-full bg-[color:var(--brand-stone-900)] px-4 py-2 text-[color:var(--brand-paper)] hover:opacity-90"
          >
            {tNav("signUp")}
          </Link>
        </nav>
      </div>
    </header>
  );
}
```

> `useTranslations` 여러 namespace 혼용은 살짝 장황. 필요 시 wrapper 함수로 단일화 리팩토링 허용.

- [ ] **Step 2: Footer.tsx**

참조: `landing.html` 최하단. 법적 링크는 placeholder 페이지(privacy/terms/refund) 경로.

```tsx
// apps/web/src/components/landing/chrome/Footer.tsx
import Link from "next/link";
import { useTranslations } from "next-intl";

export function LandingFooter() {
  const t = useTranslations("common.footer");
  return (
    <footer className="border-t border-[color:var(--brand-stone-200)] bg-[color:var(--brand-paper)] py-12">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-6 text-sm text-[color:var(--brand-stone-500)] md:flex-row md:justify-between">
        <p>{t("copyright")}</p>
        <nav className="flex gap-6">
          <Link href="/privacy" className="hover:text-[color:var(--brand-stone-900)]">{t("legal.privacy")}</Link>
          <Link href="/terms" className="hover:text-[color:var(--brand-stone-900)]">{t("legal.terms")}</Link>
          <Link href="/refund" className="hover:text-[color:var(--brand-stone-900)]">{t("legal.refund")}</Link>
          <a href="https://github.com/Sungblab/opencairn-monorepo" target="_blank" rel="noreferrer" className="hover:text-[color:var(--brand-stone-900)]">
            GitHub
          </a>
        </nav>
      </div>
    </footer>
  );
}
```

- [ ] **Step 3: placeholder 페이지 3개 (privacy, terms, refund)**

각 파일 스켈레톤 — 본문은 Plan 9b에서 채움:

```tsx
// apps/web/src/app/[locale]/privacy/page.tsx (및 terms/, refund/ 동형)
import { useTranslations } from "next-intl";
export default function PrivacyPage() {
  const t = useTranslations("common.footer.legal");
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="font-serif text-4xl">{t("privacy")}</h1>
      <p className="mt-6 text-fg-muted">준비 중입니다. (Plan 9b)</p>
    </main>
  );
}
```

(terms, refund 동일 구조로 생성.)

> 문자열 "준비 중입니다. (Plan 9b)"도 ESLint 룰에 걸릴 수 있음 → `common.placeholder.comingSoon` 키 추가 또는 `// eslint-disable-next-line i18next/no-literal-string` 주석 처리 (일관성 위해 키화 권장).

- [ ] **Step 4: 커밋**

```bash
git add apps/web/src/components/landing/chrome \
        apps/web/src/app/\[locale\]/privacy \
        apps/web/src/app/\[locale\]/terms \
        apps/web/src/app/\[locale\]/refund
git commit -m "feat(web): landing chrome (Header + Footer) + legal placeholder pages"
```

---

### Task 16: Hero 섹션

**Files:**
- Create: `apps/web/src/components/landing/Hero.tsx`
- Modify: `apps/web/messages/ko/landing.json` (hero 추가 키)

> 원본 참조: `landing/landing.html` line 464~619. Hero는 **가장 복잡한 섹션** (타이포, typewriter, autocomplete, agent hub SVG, live compile panel). 포트 시 주요 인터랙션만 유지하고 세부 SVG는 복붙 허용.

- [ ] **Step 1: Hero.tsx 기본 구조 + typewriter 통합**

```tsx
// apps/web/src/components/landing/Hero.tsx
"use client";
import { useRef } from "react";
import { useTranslations } from "next-intl";
import { useScrollReveal } from "@/lib/landing/hooks/useScrollReveal";
import { useTypewriter } from "@/lib/landing/hooks/useTypewriter";

export function Hero() {
  const t = useTranslations("landing.hero");
  const ref = useRef<HTMLElement>(null);
  useScrollReveal(ref);

  const rotatingWords = [t("title"), "자동으로 엮어주는", "관계까지 이해하는"];
  const typed = useTypewriter(rotatingWords);

  return (
    <section
      ref={ref}
      className="relative overflow-hidden bg-[color:var(--brand-paper)] py-24 md:py-32 reveal"
    >
      <div className="mx-auto max-w-6xl px-6">
        <p className="font-mono text-xs uppercase tracking-widest text-[color:var(--brand-stone-500)]">
          {t("eyebrow")}
        </p>
        <h1 className="mt-6 font-serif text-5xl leading-tight text-[color:var(--brand-stone-900)] md:text-7xl">
          <span>{typed}</span>
          <span className="inline-block w-[0.08em] h-[0.95em] align-baseline bg-[color:var(--brand-ember-cta)] ml-[0.08em] animate-pulse" aria-hidden />
          <br />
          <em className="not-italic font-serif">{t("titleEm")}</em>
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-[color:var(--brand-stone-600)]">
          {t("sub")}
        </p>
        <div className="mt-10 flex items-center gap-4">
          <a
            href="/dashboard"
            className="rounded-full bg-[color:var(--brand-stone-900)] px-6 py-3 text-sm font-medium text-[color:var(--brand-paper)] hover:opacity-90"
          >
            {t("cta")}
          </a>
          <a
            href="#how"
            className="text-sm font-medium text-[color:var(--brand-stone-600)] hover:text-[color:var(--brand-stone-900)]"
          >
            {t("ctaGhost")} →
          </a>
        </div>
      </div>

      {/* TODO(Plan 9a post-port polish): port agent hub SVG + live compile panel from landing.html:508~619 */}
    </section>
  );
}
```

- [ ] **Step 2: TODO 섹션(agent hub SVG, live compile panel) 원본 구조 포팅**

`landing/landing.html`의 `<svg>` 블록 (line 508~619)을 React JSX로 복사 + 원본 `id`는 `useId()`로 교체 + vanilla JS interval은 useEffect + setInterval로 이식. 텍스트 키화.

**구체 포팅 가이드:**
- `<ul class="ac-list" id="acList">`의 autocomplete 순환은 useState + useEffect 기반 rotation. 항목은 `messages/ko/landing.json`에 `hero.autocomplete` 배열로 정의 후 `useTranslations` 대신 `useMessages()` 사용.
- `<text id="liveMsg">대기 중…</text>`의 회전 메시지는 배열 기반 rotation. 배열은 메시지 파일 `hero.liveMessages`에 정의.

> 이 sub-step은 풍부한 시각 효과라 tedious함. **빠른 ship 위해 MVP는 정적 SVG 복붙 + rotation 애니메이션만** 포팅하고, 나머지 디테일은 "Hero polish" 후속 커밋으로 연기 가능.

- [ ] **Step 3: 수동 검증**

```bash
pnpm --filter @opencairn/web dev
```

`/` 접속 → Hero 영역이 원본 landing.html과 시각적으로 가깝게 표시. typewriter 문구 순환 확인. reduce-motion on (devtools → Rendering → emulate prefers-reduced-motion reduce) 시 정적 텍스트 표시.

- [ ] **Step 4: 커밋**

```bash
git add apps/web/src/components/landing/Hero.tsx apps/web/messages/ko/landing.json apps/web/messages/en/landing.json
git commit -m "feat(web): port landing Hero section (typewriter + SVG hub)"
```

---

### Task 17: 정적 섹션 6개 (Problem, How, Workspace, Personas, ForWhom, Docs)

> 이 섹션들은 주로 **static 텍스트 + scroll-reveal**. 한 task로 묶어 처리.

**Files:**
- Create: `apps/web/src/components/landing/ProblemBand.tsx`
- Create: `apps/web/src/components/landing/HowItWorks.tsx`
- Create: `apps/web/src/components/landing/WorkspaceShowcase.tsx`
- Create: `apps/web/src/components/landing/Personas.tsx`
- Create: `apps/web/src/components/landing/ForWhom.tsx`
- Create: `apps/web/src/components/landing/DocsTeaser.tsx`
- Modify: `apps/web/messages/ko/landing.json` (섹션별 키 추가)

각 컴포넌트 템플릿 (예시: HowItWorks):

```tsx
// apps/web/src/components/landing/HowItWorks.tsx
"use client";
import { useRef } from "react";
import { useTranslations } from "next-intl";
import { useScrollReveal } from "@/lib/landing/hooks/useScrollReveal";

export function HowItWorks() {
  const t = useTranslations("landing.how");
  const ref = useRef<HTMLElement>(null);
  useScrollReveal(ref);

  return (
    <section id="how" ref={ref} className="reveal bg-[color:var(--brand-stone-900)] py-24 text-[color:var(--brand-stone-50)] md:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <h2 className="font-serif text-4xl md:text-5xl">{t("heading")}</h2>
        {/* 3 단계 카드는 원본 landing.html:670~740 참조, 복붙 + 키화 */}
      </div>
    </section>
  );
}
```

- [ ] **Step 1: ProblemBand, HowItWorks, WorkspaceShowcase, Personas, ForWhom, DocsTeaser 6개 컴포넌트 작성**

각각 landing.html 해당 섹션 (line 번호는 spec 매핑 표 참조) 구조 복붙 + 문자열 키화 + scroll-reveal hook 적용. 총 ~1~2시간 작업.

**카피 규칙 준수 확인 포인트** (포트 과정에서 검증):
- HowItWorks/Comparison 등에 **경쟁사 직접 언급** 있으면 제거/대체 (기존 HTML이 이미 준수하는지 Grep으로 확인: "Notion", "Obsidian", "NotebookLM", "Roam" 등).
- 기술 스택 상세 노출 최소화 (예: "pgvector", "Drizzle" 같은 용어 노출 자제, 필요 시 "벡터 검색", "DB"로 일반화).

- [ ] **Step 2: 각 섹션의 키를 `landing.json`에 추가**

`messages/ko/landing.json`의 기존 스켈레톤(`problem`, `how`, `workspace`, `who`, `forWhom`, `docs`)에 하위 키를 풍부하게 채움. 원본 HTML 문자열 기반으로 존댓말로 정리.

예 (HowItWorks 3 단계):

```json
"how": {
  "heading": "어떻게 동작하나요",
  "steps": [
    { "n": "01", "title": "올려두면", "body": "PDF·YouTube·오디오·이미지·URL 어떤 자료든 받습니다." },
    { "n": "02", "title": "자동으로 엮고", "body": "12 에이전트가 위키 페이지로 정리하고 개념 간 연결을 만듭니다." },
    { "n": "03", "title": "먼저 발견해요", "body": "질문하기 전에 관련된 맥락과 플래시카드가 제안돼요." }
  ]
}
```

- [ ] **Step 3: en 복사 + parity 확인**

```bash
pnpm --filter @opencairn/web i18n:sync
pnpm --filter @opencairn/web i18n:parity
```

- [ ] **Step 4: 커밋**

```bash
git add apps/web/src/components/landing apps/web/messages
git commit -m "feat(web): port 6 static landing sections (Problem/How/Workspace/Personas/ForWhom/Docs)"
```

---

### Task 18: AgentsGrid 섹션 (magnetic tilt)

**Files:**
- Create: `apps/web/src/components/landing/AgentsGrid.tsx`
- Modify: `apps/web/messages/ko/landing.json`

> 원본 `landing.html` line 745~825. 12 에이전트 카드, 각 카드에 `magnetic tilt` 적용.

- [ ] **Step 1: AgentCard + AgentsGrid 작성**

```tsx
// apps/web/src/components/landing/AgentsGrid.tsx
"use client";
import { useRef } from "react";
import { useTranslations } from "next-intl";
import { useScrollReveal } from "@/lib/landing/hooks/useScrollReveal";
import { useMagneticTilt } from "@/lib/landing/hooks/useMagneticTilt";

function AgentCard({ title, body }: { title: string; body: string }) {
  const ref = useRef<HTMLElement>(null);
  useMagneticTilt(ref);
  return (
    <article
      ref={ref}
      className="tilt rounded-xl border border-[color:var(--brand-stone-200)] bg-[color:var(--brand-paper)] p-6 transition-shadow hover:shadow-lg"
    >
      <h3 className="font-serif text-xl text-[color:var(--brand-stone-900)]">{title}</h3>
      <p className="mt-2 text-sm text-[color:var(--brand-stone-600)]">{body}</p>
    </article>
  );
}

export function AgentsGrid() {
  const t = useTranslations("landing.agents");
  const ref = useRef<HTMLElement>(null);
  useScrollReveal(ref);

  // 12 에이전트는 messages에서 배열로 정의. useTranslations는 배열 직접 반환 안 하므로 t.raw 사용.
  const agents = t.raw("items") as { title: string; body: string }[];

  return (
    <section id="agents" ref={ref} className="reveal border-b border-[color:var(--brand-stone-900)] bg-[color:var(--brand-paper)] py-24 md:py-32">
      <div className="mx-auto max-w-6xl px-6">
        <h2 className="font-serif text-4xl text-[color:var(--brand-stone-900)] md:text-5xl">{t("heading")}</h2>
        <div className="mt-12 grid gap-6 md:grid-cols-3 lg:grid-cols-4">
          {agents.map((a, i) => (
            <AgentCard key={i} title={a.title} body={a.body} />
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: messages에 12 에이전트 배열 정의**

```json
"agents": {
  "heading": "12개의 AI 에이전트가 일합니다",
  "items": [
    { "title": "Compiler", "body": "자료를 위키 페이지로 엮어냅니다." },
    { "title": "Research", "body": "여러 소스를 교차 검증해 답합니다." },
    { "title": "Librarian", "body": "태그와 구조를 정리해둡니다." },
    { "title": "Socratic", "body": "맞춤 질문으로 이해를 깊게 합니다." },
    { "title": "Code", "body": "코드 블록을 안전한 브라우저 샌드박스에서 실행합니다." },
    { "title": "Connector", "body": "외부 노트·링크를 가져옵니다." },
    { "title": "Temporal", "body": "시간축 변화를 추적합니다." },
    { "title": "Synthesis", "body": "여러 페이지를 한 단락으로 요약합니다." },
    { "title": "Curator", "body": "관련 자료를 먼저 추천해드립니다." },
    { "title": "Narrator", "body": "긴 글을 듣기 좋은 오디오로 변환합니다." },
    { "title": "Deep Research", "body": "깊이 있는 리서치 리포트를 생성합니다." },
    { "title": "Visualization", "body": "지식을 그래프·타임라인·마인드맵으로 보여드립니다." }
  ]
}
```

- [ ] **Step 3: en 복사 + 커밋**

```bash
pnpm --filter @opencairn/web i18n:sync
git add apps/web/src/components/landing/AgentsGrid.tsx apps/web/messages
git commit -m "feat(web): port AgentsGrid section with 12 agents + magnetic tilt"
```

---

### Task 19: MiniGraph 섹션 (Try)

**Files:**
- Create: `apps/web/src/components/landing/MiniGraph.tsx`
- Modify: `apps/web/messages/ko/landing.json`

> 원본 `landing.html` line 949~1039. SVG 기반 mini knowledge graph (9 노드 + 엣지), hover 시 tooltip + edge highlight. 복잡도 높음.

- [ ] **Step 1: MiniGraph.tsx — SVG 복사 + hover state React화**

원본 SVG 블록을 JSX로 복사 (`class` → `className`, attribute 카멜케이스 변환). `data-id` 기반 hover는 useState로 `hoveredId` 관리, `<g data-id>` 각각에 onMouseEnter/Leave 연결.

```tsx
// apps/web/src/components/landing/MiniGraph.tsx
"use client";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useScrollReveal } from "@/lib/landing/hooks/useScrollReveal";

const nodes = [
  { id: "attention", x: 160, y: 130, label: "Attention" },
  { id: "transformer", x: 300, y: 150, label: "Transformer" },
  { id: "multihead", x: 180, y: 240, label: "Multi-head" },
  { id: "positional", x: 420, y: 110, label: "Positional" },
  { id: "encoder", x: 360, y: 260, label: "Encoder" },
  { id: "decoder", x: 500, y: 270, label: "Decoder" },
  { id: "bert", x: 470, y: 200, label: "BERT" },
  { id: "rope", x: 540, y: 120, label: "RoPE" },
  { id: "pretraining", x: 540, y: 270, label: "Pretraining" },
];

const edges: [string, string][] = [
  ["attention", "transformer"], ["attention", "multihead"], ["transformer", "encoder"],
  ["transformer", "decoder"], ["positional", "transformer"], ["encoder", "bert"],
  ["bert", "pretraining"], ["rope", "positional"], ["decoder", "pretraining"],
];

export function MiniGraph() {
  const t = useTranslations("landing.try");
  const ref = useRef<HTMLElement>(null);
  useScrollReveal(ref);
  const [hovered, setHovered] = useState<string | null>(null);

  const connected = new Set<string>(
    hovered
      ? edges.flatMap(([a, b]) => (a === hovered || b === hovered ? [a, b] : []))
      : []
  );

  return (
    <section id="try" ref={ref} className="reveal border-b border-[color:var(--brand-stone-900)] py-24 md:py-32">
      <div className="mx-auto max-w-6xl px-6">
        <h2 className="font-serif text-4xl text-[color:var(--brand-stone-900)] md:text-5xl">{t("heading")}</h2>
        <div className="mt-10 rounded-xl border border-[color:var(--brand-stone-200)] bg-[color:var(--brand-paper)] p-6">
          <svg viewBox="0 0 700 400" className="w-full">
            <defs>
              <pattern id="mg-dot" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="1" fill="var(--brand-stone-200)" />
              </pattern>
            </defs>
            <rect width="700" height="400" fill="url(#mg-dot)" />
            <g stroke="var(--brand-stone-400)" strokeWidth="1">
              {edges.map(([a, b], i) => {
                const na = nodes.find((n) => n.id === a)!;
                const nb = nodes.find((n) => n.id === b)!;
                const active = hovered && (a === hovered || b === hovered);
                return (
                  <line
                    key={i}
                    x1={na.x} y1={na.y} x2={nb.x} y2={nb.y}
                    stroke={active ? "var(--brand-ember-cta)" : "var(--brand-stone-300)"}
                    strokeWidth={active ? 2 : 1}
                  />
                );
              })}
            </g>
            <g>
              {nodes.map((n) => {
                const active = n.id === hovered || connected.has(n.id);
                return (
                  <g
                    key={n.id}
                    transform={`translate(${n.x},${n.y})`}
                    onMouseEnter={() => setHovered(n.id)}
                    onMouseLeave={() => setHovered(null)}
                    style={{ cursor: "pointer" }}
                  >
                    <circle
                      r="16"
                      fill={active ? "var(--brand-stone-900)" : "var(--brand-paper)"}
                      stroke="var(--brand-stone-900)"
                      strokeWidth="1.5"
                    />
                    <text
                      y="30"
                      textAnchor="middle"
                      fontSize="10"
                      fill="var(--brand-stone-700)"
                      className="font-mono"
                    >
                      {n.label}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add apps/web/src/components/landing/MiniGraph.tsx apps/web/messages
git commit -m "feat(web): port MiniGraph section (SVG 9-node graph + hover highlight)"
```

---

### Task 20: Comparison 섹션 (VS)

**Files:**
- Create: `apps/web/src/components/landing/Comparison.tsx`
- Modify: `apps/web/messages/ko/landing.json`

> 원본 `landing.html` line 1165~1227. **브랜드 룰: 경쟁사 직접 언급 금지**. 원본 HTML 검증 필수.

- [ ] **Step 1: 원본 HTML 문구 검증**

```bash
grep -iE "Notion|Obsidian|NotebookLM|Roam|Logseq|Anytype" landing/landing.html
```

**발견된 라인은 다음 중 하나로 처리:**
- 카테고리 언급 ("일반 문서 도구", "개인 노트 앱", "AI 문서 도구")으로 재작성
- "다른 도구들", "유사 서비스" 등 일반화
- 기능 비교 중심 표 유지하되 row 레이블에서 상표 제거

- [ ] **Step 2: Comparison.tsx 작성**

```tsx
// apps/web/src/components/landing/Comparison.tsx
"use client";
import { useRef } from "react";
import { useTranslations } from "next-intl";
import { useScrollReveal } from "@/lib/landing/hooks/useScrollReveal";

export function Comparison() {
  const t = useTranslations("landing.vs");
  const ref = useRef<HTMLElement>(null);
  useScrollReveal(ref);
  const rows = t.raw("rows") as { dimension: string; others: string; opencairn: string }[];

  return (
    <section id="vs" ref={ref} className="reveal border-b border-[color:var(--brand-stone-900)] py-24 md:py-32">
      <div className="mx-auto max-w-5xl px-6">
        <h2 className="font-serif text-4xl text-[color:var(--brand-stone-900)] md:text-5xl">{t("heading")}</h2>
        <table className="mt-10 w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-[color:var(--brand-stone-300)] text-sm">
              <th className="py-3">{t("colDimension")}</th>
              <th className="py-3 text-[color:var(--brand-stone-500)]">{t("colOthers")}</th>
              <th className="py-3 font-serif">OpenCairn</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-[color:var(--brand-stone-200)] text-sm">
                <td className="py-4 text-[color:var(--brand-stone-700)]">{r.dimension}</td>
                <td className="py-4 text-[color:var(--brand-stone-500)]">{r.others}</td>
                <td className="py-4 text-[color:var(--brand-stone-900)]">{r.opencairn}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: 메시지 정의 + 커밋**

```json
"vs": {
  "heading": "기존 도구와의 차이",
  "colDimension": "측면",
  "colOthers": "일반 문서 도구",
  "colHere": "OpenCairn",
  "rows": [
    { "dimension": "자료 수집", "others": "수동 정리", "opencairn": "업로드만 하면 자동 위키화" },
    { "dimension": "관계 발견", "others": "직접 태그·링크", "opencairn": "12 에이전트가 연결을 제안" },
    { "dimension": "로컬/셀프호스트", "others": "제한적", "opencairn": "Docker 한 방, AGPLv3" },
    { "dimension": "학습 루프", "others": "없음", "opencairn": "플래시카드 + Socratic + 퀴즈" }
  ]
}
```

```bash
pnpm --filter @opencairn/web i18n:sync
git add apps/web/src/components/landing/Comparison.tsx apps/web/messages
git commit -m "feat(web): port VS section (no direct competitor names per brand rule)"
```

---

### Task 21: Pricing 섹션

**Files:**
- Create: `apps/web/src/components/landing/Pricing.tsx`
- (`landing.json` pricing 키는 이미 Task 7에서 기초 작성)

> 원본 `landing.html` line 1347~1490. 가격 숫자는 `docs/architecture/billing-model.md` 기준 하드코딩 (Plan 9b에서 API 연결 시 props로 교체).

- [ ] **Step 1: Pricing.tsx**

```tsx
// apps/web/src/components/landing/Pricing.tsx
"use client";
import { useRef } from "react";
import { useTranslations } from "next-intl";
import { useScrollReveal } from "@/lib/landing/hooks/useScrollReveal";

type Plan = {
  key: "free" | "byok" | "pro" | "selfhost";
  featured?: boolean;
};

const PLANS: Plan[] = [
  { key: "free" },
  { key: "byok" },
  { key: "pro", featured: true },
  { key: "selfhost" },
];

export function Pricing() {
  const t = useTranslations("landing.pricing");
  const ref = useRef<HTMLElement>(null);
  useScrollReveal(ref);

  return (
    <section id="pricing" ref={ref} className="reveal bg-[color:var(--brand-stone-900)] py-24 text-[color:var(--brand-stone-50)] md:py-32">
      <div className="mx-auto max-w-6xl px-6">
        <h2 className="font-serif text-4xl md:text-5xl">{t("heading")}</h2>
        <p className="mt-3 text-[color:var(--brand-stone-400)]">{t("sub")}</p>
        <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {PLANS.map(({ key, featured }) => (
            <div
              key={key}
              className={
                featured
                  ? "rounded-xl border border-[color:var(--brand-ember-cta)] bg-[color:var(--brand-stone-800)] p-6"
                  : "rounded-xl border border-[color:var(--brand-stone-700)] bg-transparent p-6"
              }
            >
              <h3 className="font-serif text-2xl">{t(`${key}.name`)}</h3>
              <p className="mt-2 text-sm text-[color:var(--brand-stone-400)]">{t(`${key}.tagline`)}</p>
              <p className="mt-6">
                <span className="font-serif text-3xl">{t(`${key}.price`)}</span>
                <span className="ml-1 text-sm text-[color:var(--brand-stone-400)]">{t(`${key}.unit`)}</span>
              </p>
            </div>
          ))}
        </div>
        <p className="mt-8 text-xs text-[color:var(--brand-stone-500)]">{t("vat")}</p>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add apps/web/src/components/landing/Pricing.tsx
git commit -m "feat(web): port Pricing section (Free/BYOK/Pro/Self-host, per billing-model.md)"
```

---

### Task 22: FAQ + CTA 섹션

**Files:**
- Create: `apps/web/src/components/landing/Faq.tsx`
- Create: `apps/web/src/components/landing/Cta.tsx`
- Modify: `apps/web/messages/ko/landing.json`

- [ ] **Step 1: Faq.tsx**

```tsx
// apps/web/src/components/landing/Faq.tsx
"use client";
import { useRef } from "react";
import { useTranslations } from "next-intl";
import { useScrollReveal } from "@/lib/landing/hooks/useScrollReveal";

export function Faq() {
  const t = useTranslations("landing.faq");
  const ref = useRef<HTMLElement>(null);
  useScrollReveal(ref);
  const items = t.raw("items") as { q: string; a: string }[];

  return (
    <section id="faq" ref={ref} className="reveal border-b border-[color:var(--brand-stone-900)] py-24 md:py-32">
      <div className="mx-auto max-w-3xl px-6">
        <h2 className="font-serif text-4xl text-[color:var(--brand-stone-900)] md:text-5xl">{t("heading")}</h2>
        <div className="mt-10 divide-y divide-[color:var(--brand-stone-200)]">
          {items.map((it, i) => (
            <details key={i} className="group py-4">
              <summary className="flex cursor-pointer items-center justify-between text-left font-serif text-lg">
                {it.q}
                <span className="text-[color:var(--brand-stone-400)] transition-transform group-open:rotate-180">⌄</span>
              </summary>
              <p className="mt-3 text-sm text-[color:var(--brand-stone-600)]">{it.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Cta.tsx (counter-up 포함)**

```tsx
// apps/web/src/components/landing/Cta.tsx
"use client";
import { useRef } from "react";
import { useTranslations } from "next-intl";
import { useScrollReveal } from "@/lib/landing/hooks/useScrollReveal";
import { useCountUp } from "@/lib/landing/hooks/useCountUp";

export function Cta() {
  const t = useTranslations("landing.cta");
  const ref = useRef<HTMLElement>(null);
  useScrollReveal(ref);
  const counterRef = useRef<HTMLSpanElement>(null);
  const minutes = useCountUp(counterRef, 5);

  return (
    <section id="cta" ref={ref} className="reveal border-b border-[color:var(--brand-stone-900)] bg-[color:var(--brand-stone-50)] py-24 md:py-32">
      <div className="mx-auto max-w-4xl px-6 text-center">
        <h2 className="font-serif text-4xl text-[color:var(--brand-stone-900)] md:text-6xl">
          <span ref={counterRef}>{minutes}</span>분이면 위키가 시작됩니다
        </h2>
        <p className="mt-6 text-[color:var(--brand-stone-600)]">{t("sub")}</p>
        <div className="mt-10 flex justify-center gap-4">
          <a href="/dashboard" className="rounded-full bg-[color:var(--brand-stone-900)] px-6 py-3 text-sm font-medium text-[color:var(--brand-paper)]">
            {t("primary")}
          </a>
          <a href="https://github.com/Sungblab/opencairn-monorepo" target="_blank" rel="noreferrer" className="rounded-full border border-[color:var(--brand-stone-300)] px-6 py-3 text-sm font-medium text-[color:var(--brand-stone-700)]">
            {t("secondary")}
          </a>
        </div>
      </div>
    </section>
  );
}
```

> ⚠️ "분이면 위키가 시작됩니다"는 JSX 리터럴이라 ESLint 걸림. `t("heading")`을 ICU 포맷으로 `"{minutes}분이면 위키가 시작됩니다"`로 정의하고 `t("heading", { minutes })`로 호출하는 방식으로 리팩터 (step 2 수정):

```json
"cta": {
  "heading": "{minutes}분이면 위키가 시작됩니다",
  "sub": "업로드 한 번으로 첫 위키 페이지가 생성되는 속도를 느껴보세요.",
  "primary": "시작하기",
  "secondary": "GitHub에서 보기"
}
```

그리고 Cta.tsx에서:

```tsx
<h2 className="...">{t("heading", { minutes })}</h2>
```

- [ ] **Step 3: FAQ messages 추가 + 커밋**

```json
"faq": {
  "heading": "자주 묻는 질문",
  "items": [
    { "q": "제 자료는 안전한가요?", "a": "관리형 Pro/BYOK 플랜은 전용 워크스페이스에 격리됩니다. Self-host를 선택하시면 본인 서버에서만 돌아갑니다." },
    { "q": "AI 비용은 누가 내나요?", "a": "Pro는 PAYG 크레딧(최소 ₩5,000 선불, 만료 없음). BYOK는 본인 Gemini 키로 ₩0. Self-host는 본인 키 또는 Ollama로컬." },
    { "q": "오픈소스인가요?", "a": "네. AGPLv3입니다. 상용 라이선스는 Enterprise 플랜." },
    { "q": "Docker 한 방으로 셀프호스팅 가능한가요?", "a": "네. docker-compose up -d 하나로 전체 스택이 뜹니다." }
  ]
}
```

```bash
pnpm --filter @opencairn/web i18n:sync
git add apps/web/src/components/landing apps/web/messages
git commit -m "feat(web): port FAQ + CTA sections (CTA with countUp integration)"
```

---

### Task 23: 랜딩 page.tsx 조립

**Files:**
- Rewrite: `apps/web/src/app/[locale]/page.tsx`

- [ ] **Step 1: 최종 랜딩 페이지 조립**

```tsx
// apps/web/src/app/[locale]/page.tsx
import { setRequestLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n";
import { LandingHeader } from "@/components/landing/chrome/Header";
import { LandingFooter } from "@/components/landing/chrome/Footer";
import { Hero } from "@/components/landing/Hero";
import { ProblemBand } from "@/components/landing/ProblemBand";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { AgentsGrid } from "@/components/landing/AgentsGrid";
import { WorkspaceShowcase } from "@/components/landing/WorkspaceShowcase";
import { MiniGraph } from "@/components/landing/MiniGraph";
import { Personas } from "@/components/landing/Personas";
import { Comparison } from "@/components/landing/Comparison";
import { ForWhom } from "@/components/landing/ForWhom";
import { DocsTeaser } from "@/components/landing/DocsTeaser";
import { Pricing } from "@/components/landing/Pricing";
import { Faq } from "@/components/landing/Faq";
import { Cta } from "@/components/landing/Cta";
import type { Metadata } from "next";

export const dynamic = "force-static";

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "landing.meta" });
  return { title: t("title"), description: t("description") };
}

export default async function Landing({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <div data-brand="landing" data-theme="cairn-light" className="min-h-screen bg-[color:var(--brand-paper)] text-[color:var(--brand-stone-900)]">
      <LandingHeader />
      <Hero />
      <ProblemBand />
      <HowItWorks />
      <AgentsGrid />
      <WorkspaceShowcase />
      <MiniGraph />
      <Personas />
      <Comparison />
      <ForWhom />
      <DocsTeaser />
      <Pricing />
      <Faq />
      <Cta />
      <LandingFooter />
    </div>
  );
}
```

- [ ] **Step 2: .reveal / .reveal.in CSS 정의**

`globals.css` 맨 아래에 추가 (랜딩 reveal 애니메이션):

```css
/* Scroll reveal (used by useScrollReveal) */
.reveal {
  opacity: 0;
  transform: translateY(16px);
  transition: opacity 0.7s cubic-bezier(0.22,0.61,0.36,1), transform 0.7s cubic-bezier(0.22,0.61,0.36,1);
}
.reveal.in {
  opacity: 1;
  transform: translateY(0);
}
@media (prefers-reduced-motion: reduce) {
  .reveal { opacity: 1; transform: none; transition: none; }
}
```

- [ ] **Step 3: 수동 검증**

```bash
pnpm --filter @opencairn/web build
pnpm --filter @opencairn/web dev
```

`/` 접속 → 10 섹션 전부 렌더. 각 섹션 scroll reveal 동작. `/en` 접속 → 동일 (ko 복사 stopgap). `/dashboard` → 기존 대시보드 (테마 토글 동작).

- [ ] **Step 4: 시각 대조 — landing.html 원본과 병치 비교**

브라우저 탭 두 개 열기: 하나는 `file:///.../landing/landing.html`, 다른 하나는 `http://localhost:3000/`. 스크롤 동기화하며 섹션별 톤·간격·폰트 일치 확인. 큰 차이 (스페이싱 급, 폰트 로드 실패, 색 엇나감)만 교정.

- [ ] **Step 5: 커밋**

```bash
git add apps/web/src/app/\[locale\]/page.tsx apps/web/src/app/globals.css
git commit -m "feat(web): assemble landing page with 10 sections + reveal CSS"
```

---

### Task 24: sitemap + robots

**Files:**
- Create: `apps/web/src/app/sitemap.ts`
- Create: `apps/web/src/app/robots.ts`

- [ ] **Step 1: sitemap.ts — ko만**

```ts
// apps/web/src/app/sitemap.ts
import type { MetadataRoute } from "next";

const BASE = process.env.NEXT_PUBLIC_BASE_URL ?? "https://opencairn.com";

export default function sitemap(): MetadataRoute.Sitemap {
  // Plan 9a 단계: ko만 포함. en 번역 완료 시점에 '/en' 추가.
  return [
    { url: `${BASE}/`, lastModified: new Date(), priority: 1.0 },
    { url: `${BASE}/privacy`, lastModified: new Date(), priority: 0.2 },
    { url: `${BASE}/terms`, lastModified: new Date(), priority: 0.2 },
    { url: `${BASE}/refund`, lastModified: new Date(), priority: 0.2 },
  ];
}
```

- [ ] **Step 2: robots.ts — `/en` 비공개**

```ts
// apps/web/src/app/robots.ts
import type { MetadataRoute } from "next";

const BASE = process.env.NEXT_PUBLIC_BASE_URL ?? "https://opencairn.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Plan 9a 단계: en 번역 미완이므로 검색 차단. 런칭 직전 번역 pass 완료 후 제거.
        disallow: ["/en", "/api/"],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
  };
}
```

- [ ] **Step 3: 커밋**

```bash
git add apps/web/src/app/sitemap.ts apps/web/src/app/robots.ts
git commit -m "feat(web): add sitemap + robots (ko only, /en blocked until translation)"
```

---

### Task 25: Playwright smoke 테스트

**Files:**
- Create: `apps/web/tests/e2e/landing-smoke.spec.ts`
- Modify: `apps/web/package.json` (playwright install 및 script)

- [ ] **Step 1: Playwright 설치 (기존 Plan 1에서 이미 셋업되어 있으면 skip)**

```bash
# Plan 1에서 Playwright가 이미 설치되었는지 확인
grep playwright apps/web/package.json

# 없으면:
pnpm --filter @opencairn/web add -D @playwright/test
pnpm --filter @opencairn/web exec playwright install chromium
```

- [ ] **Step 2: smoke 테스트 작성**

```ts
// apps/web/tests/e2e/landing-smoke.spec.ts
import { test, expect } from "@playwright/test";

test.describe("Landing smoke", () => {
  test("ko landing loads, data-theme=cairn-light + data-brand=landing", async ({ page }) => {
    await page.goto("/");
    const brandDiv = page.locator("[data-brand='landing']").first();
    await expect(brandDiv).toHaveAttribute("data-theme", "cairn-light");
    await expect(page.locator("h1")).toContainText("읽은 것까지");
  });

  test("en landing loads (ko copy stopgap, URL verified)", async ({ page }) => {
    await page.goto("/en");
    await expect(page.locator("h1")).toBeVisible();
    // 번역 완료 전이라 ko 문구가 렌더됨 — URL 구조만 검증
    await expect(page).toHaveURL(/\/en$/);
  });

  test("dashboard theme toggle cycles 4 themes and persists", async ({ page, context }) => {
    // 로그인 필요. Plan 1의 테스트 유저 fixture 사용 (있으면).
    // 로그인 유틸 부재 시 이 블록은 skip 처리:
    test.skip(!process.env.E2E_TEST_USER, "E2E_TEST_USER not set");

    await page.goto("/dashboard");
    const select = page.getByRole("combobox", { name: "Theme" });
    for (const theme of ["cairn-dark", "sepia", "high-contrast", "cairn-light"]) {
      await select.selectOption(theme);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    }
  });
});
```

- [ ] **Step 3: package.json scripts 추가**

```json
{
  "scripts": {
    "test:e2e": "playwright test"
  }
}
```

- [ ] **Step 4: 실행 + 검증**

```bash
# dev 서버 띄운 상태에서:
pnpm --filter @opencairn/web test:e2e
```

Expected: ko 테스트 pass, en 테스트 pass, dashboard 테스트 skip (E2E_TEST_USER 미설정).

- [ ] **Step 5: 커밋**

```bash
git add apps/web/tests apps/web/package.json
git commit -m "test(web): add Playwright smoke tests for landing + theme toggle"
```

---

### Task 26: Lighthouse 측정 + 필요 시 최적화

**Files:** (없음, 측정 위주)

- [ ] **Step 1: production 빌드로 측정**

```bash
pnpm --filter @opencairn/web build
pnpm --filter @opencairn/web start &
```

Chrome DevTools Lighthouse → Desktop + Performance·Accessibility·SEO·Best Practices 선택 → `http://localhost:3000/` 측정. 레포트 저장.

- [ ] **Step 2: 기준 미달 시 교정**

- Performance < 90 → 큰 이미지·폰트 preload 누락 점검, next/image 전환, SVG 인라인 최적화.
- Accessibility < 95 → alt 태그 누락, 대비 부족, aria-label 누락 점검. ThemeToggle `aria-label` 확인.
- SEO < 95 → generateMetadata의 title/description 확인, robots 경로 확인.

- [ ] **Step 3: 결과 문서화**

측정 결과를 PR description 또는 임시 파일에 기록 (예: `docs/runbooks/landing-lighthouse-2026-04-20.md` — 필요 없으면 skip).

- [ ] **Step 4: 커밋 (교정 있었을 시만)**

```bash
git add .
git commit -m "perf(web): Lighthouse pass — fix [구체 항목]"
```

---

## Task 27: Plan 9a 완료 — CLAUDE.md 상태 업데이트

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: CLAUDE.md Plan 9a 엔트리에 완료 표기**

Plan index의 9a 라인에 `✅ **완료 (YYYY-MM-DD, HEAD xxxx)**` 접두어 추가. 유저-메모리도 반영 고려 (수동).

- [ ] **Step 2: 커밋**

```bash
git add CLAUDE.md
git commit -m "docs: mark Plan 9a (web foundation + landing) complete"
```

---

## v0.1 공개 런칭 체크리스트 (Plan 9a 밖)

Plan 9a 완료만으론 v0.1 런칭 조건 불충분. 아래는 **런칭 직전에 처리할 별도 체크리스트**이며, Plan 9b 또는 독립 PR로 진행.

- [ ] `messages/en/*.json` 전 키 실제 영문 번역 (AI 초벌 + 감수)
- [ ] `docs/contributing/i18n-glossary.md` 작성 (에이전트 이름, 전문 용어, Workspace/Page/Block 등 표준)
- [ ] `robots.ts`에서 `/en` Disallow 제거
- [ ] `sitemap.ts`에 `/en/` 경로 추가
- [ ] 랜딩 + 앱 주요 페이지에 `hreflang` 태그 추가
- [ ] 랜딩 `/en` 시각 검수 (hero literary 톤 유지, Pricing 통화 표기 ₩/USD 결정, legal 링크 영문)
- [ ] Better Auth 이메일 템플릿 + 알림 이메일 en 버전 (Plan 1의 Resend 연동 기반)
- [ ] README.md 영문 primary + `README_ko.md` 한국어 분리 (Dify/SiYuan 패턴)

---

## 자체 체크

- **Spec coverage**: 스펙의 Phase 1 (Theme) = Task 1~5 ✓. Phase 2 (i18n) = Task 6~12 ✓. Phase 3 (Landing Port) = Task 13~26 ✓. i18n 규율 = Task 11~12 ✓. Plan 9 분할 = Task 0 + 27 ✓.
- **성공 기준 매핑**: 빌드 성공 (Task 23), 랜딩 시각 일치 (Task 23 step 4), ko 문자열 하드코딩 0 (Task 11), 테마 토글 (Task 5), reduce-motion (Task 14 각 훅), parity lint (Task 10), ESLint no-literal-string (Task 11), `/en` robots Disallow (Task 24), Lighthouse (Task 26).
- **v0.1 런칭 체크리스트**는 Plan 9a 범위 밖임을 명시 ✓.
