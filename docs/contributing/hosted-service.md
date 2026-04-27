# Hosted Service

OpenCairn is open-source (AGPLv3). Sungblab also operates a managed hosted service.

**Hosting URL (임시)**: 상업 서비스 정식 출시 전에는 **`sungblab.com/opencairn`** 경로로 운영. 정식 출시 시 **`opencairn.com`**으로 이전 (도메인 확보 후).

---

## What's in this repo

| Content | Path | 비고 |
|---------|------|------|
| Application source code | `apps/*`, `packages/*` | AGPLv3 |
| Database schema and migrations | `packages/db/` | |
| Configuration examples | `.env.example` | |
| **Landing page** | `apps/web/app/(landing)/*` | Next.js route group, repo 포함 |
| **Legal (ToS/Privacy)** | `apps/web/app/legal/*` | MDX, repo 포함 (self-hoster는 본인 문서로 교체) |
| **Blog (옵션 A, 기본)** | `apps/web/app/blog/*` | Next.js MDX, repo 포함 |
| Technical documentation | `docs/` | |

### Blog 경로 옵션

- **옵션 A (기본)**: `apps/web/app/blog/*` — Next.js MDX로 메인 앱과 같은 배포. 초기 운영에 권장.
- **옵션 B (호스팅 분리 전환 시)**: 별도 repo + 서브도메인 (`blog.opencairn.com`). 블로그 트래픽이 커지거나 별도 CMS 도입 시 마이그레이션.

---

## What's not in this repo

다음은 호스팅 운영에만 해당되며 repo에 포함되지 않는다:

- 실제 DNS / 인증서 설정
- 운영 환경 secret (Gemini API 키, Resend 키, Sentry DSN 등)
- 결제 provider 연동 설정값 (**결제 레일 자체가 2026-04-20 기준 BLOCKED**, 사업자등록 후 결정)
- 운영 로그 / 사용자 데이터

호스팅 서비스의 라이브 URL 예시 (정식 출시 시):

| Content | URL |
|---------|-----|
| Privacy Policy | `(host)/legal/privacy` |
| Terms of Service | `(host)/legal/terms` |
| Pricing & Billing | `(host)/pricing` |
| Blog | `(host)/blog` (옵션 A) 또는 `blog.opencairn.com` (옵션 B) |

`(host)`는 현재 `sungblab.com/opencairn`, 정식 출시 시 `opencairn.com`.

---

## Self-hosting

Self-host 시:
- `apps/web/app/legal/*` MDX를 본인 법적 문서로 교체 필수
- 결제/과금 모듈은 비활성화 가능 (`DISABLE_BILLING=true`)
- 블로그는 삭제 또는 자체 콘텐츠로 교체

설치 절차는 [`dev-guide.md`](./dev-guide.md).

---

## Branding & SEO: env 패턴 (하드코딩 금지)

OSS/호스팅 양쪽 모두 동작해야 하므로 브랜드·도메인·연락처·SEO 메타는 **하드코딩하지 말고 env + 디폴트** 패턴을 쓴다.

### 판별 기준 한 줄

> "포크 사용자가 이 값 없이도 빌드가 돌고 페이지가 떠야 하나?"
>
> - **YES → env + 디폴트, git에 커밋.** (브랜드명, OG 메타, robots, sitemap, 연락처 placeholder 등)
> - **NO → `.env`에만, `.gitignore`.** (API 키, DB 비번, Stripe secret, Resend 키 등 시크릿만)

99%는 전자다. 시크릿이 아니면 디폴트 박아서 커밋한다.

### git에 들어가는 것 (커밋, 포크도 받음)

- `apps/web/lib/site-config.ts` 같은 단일 출처 — `process.env.SITE_NAME ?? "OpenCairn"` 식
- `app/robots.ts`, `app/sitemap.ts`, `app/layout.tsx` metadata — 전부 `siteConfig`에서 읽기 (정적 `robots.txt`/`sitemap.xml` 만들지 말 것)
- `.env.example` — 모든 키 + 설명 + OSS 디폴트 (`SITE_NAME=OpenCairn`, `SITE_URL=https://example.com`)
- 디폴트 OG 이미지 (중립 "OpenCairn" 로고 PNG) — `apps/web/public/og-default.png`

### `.gitignore`에만

- `.env`, `.env.production`, `.env.local` (Next.js 기본 ignore)
- 본인 도메인 전용 OG/파비콘이 있다면 → 차라리 `OG_IMAGE_URL`을 env로 받아 CDN URL 주입
- Search Console 인증 파일 (`google*.html`) — 또는 `GOOGLE_SITE_VERIFICATION` env로 meta tag 주입
- 운영 prod의 analytics 키, Sentry DSN

### 표준 env 키 (Plan 9b sweep 시 일괄 추출)

```
SITE_NAME=OpenCairn
SITE_URL=https://opencairn.com
SITE_OWNER=
SITE_DESCRIPTION_KO=
SITE_DESCRIPTION_EN=
OG_IMAGE_URL=
CONTACT_EMAIL=
SUPPORT_URL=
ANALYTICS_PLAUSIBLE_DOMAIN=
GOOGLE_SITE_VERIFICATION=
TWITTER_HANDLE=
```

### 지금부터 적용

- 신규 카피·메타·이메일 템플릿은 처음부터 `siteConfig`/i18n 키로 추출. "OpenCairn"·고정 도메인·연락처 직접 박지 말 것.
- 실제 `lib/site-config.ts` 모듈 추출 + `.env.example` 키 추가 + 기존 하드코딩 sweep은 **Plan 9b 빌링과 묶어서 한 번에**. 그때까지는 위 규칙만 준수.

---

## Operator

- 현재: **Sungblab** (개인) — `sungblab.com`
- 정식 출시 후: **OpenCairn** (법인 또는 개인사업자) — `opencairn.com` (도메인 확보 + 사업자등록 완료 후 이관)
