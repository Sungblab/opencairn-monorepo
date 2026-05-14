# Hosted Service

OpenCairn is dual-licensed (AGPL-3.0-or-later by default + optional commercial license — see [ADR-005](../architecture/adr/005-agplv3-dual-licensing.md), `LICENSE`, `COMMERCIAL-LICENSING.md`). Sungblab also operates a managed hosted service.

**Product URL**: hosted OpenCairn의 제품 도메인은 **`opencairn.com`**이다. 회사/블로그/법무 문서는 Sungblab 사이트에서 운영하고, OpenCairn 앱은 공개 env URL로 그 문서들을 링크한다.

---

## What's in this repo

| Content | Path | 비고 |
|---------|------|------|
| Application source code | `apps/*`, `packages/*` | AGPLv3 (or commercial, ADR-005) |
| Database schema and migrations | `packages/db/` | |
| Configuration examples | `.env.example` | |
| **Landing page** | `apps/web/src/app/[locale]/*` | Next.js locale route, repo 포함 |
| Public app shell + landing | `apps/web/src/app/*` | OSS 앱에 포함되는 제품 UI |
| Technical documentation | `docs/` | |

### Legal / blog 경로

Legal 문서와 블로그는 OSS 앱 모노레포에 넣지 않는다. hosted service의
법적 문서, 블로그, 광고/분석 태그는 별도 marketing/legal 사이트에서 운영하고,
이 앱은 `NEXT_PUBLIC_LEGAL_*_URL`, `NEXT_PUBLIC_BLOG_URL` 같은 공개 env URL로
연결만 한다.

현재 운영 기준으로 제품 랜딩/앱 도메인은 `opencairn.com`, 회사 사이트 도메인은
`sungblab.com`이다. 별도 marketing/legal 사이트의 소스는 이 OSS 저장소에
포함하지 않는다. OpenCairn 앱은
`/privacy`, `/terms`, `/refund`, `/blog` 페이지를 직접 구현하지 않고,
회사 사이트의 OpenCairn 법무/블로그 페이지로 연결한다.

---

## What's not in this repo

다음은 호스팅 운영에만 해당되며 repo에 포함되지 않는다:

- 실제 DNS / 인증서 설정
- 운영 환경 secret (Gemini API 키, Resend 키, Sentry DSN 등)
- 결제 provider 연동 설정값 (**결제 레일 자체가 2026-04-20 기준 BLOCKED**, 사업자등록 후 결정)
- 운영 로그 / 사용자 데이터
- hosted service 법적 문서 원문, 블로그/CMS, Meta/Google 광고·분석 운영 설정

호스팅 서비스의 라이브 URL 예시:

| Content | URL |
|---------|-----|
| Product landing | `opencairn.com` |
| Hosted app | `opencairn.com` (authenticated users redirect into the workspace app) |
| API | `api.opencairn.com` |
| Privacy Policy | `sungblab.com/legal/privacy` |
| Terms of Service | `sungblab.com/legal/terms` |
| Pricing & Billing | `opencairn.com/pricing` |
| Blog | `sungblab.com/blog` |

운영 환경에서는 위 URL을 `NEXT_PUBLIC_LEGAL_PRIVACY_URL`,
`NEXT_PUBLIC_LEGAL_TERMS_URL`, `NEXT_PUBLIC_BLOG_URL` 등으로 주입한다.

---

## Self-hosting

Self-host 시:
- `OPENCAIRN_HOSTED_SERVICE=false`와
  `NEXT_PUBLIC_OPENCAIRN_HOSTED_SERVICE=false`를 유지. 이 값이 false이면
  hosted-only billing, promotions, advertising, deploy-readiness UI는
  기본적으로 숨긴다.
- `NEXT_PUBLIC_LEGAL_PRIVACY_URL`, `NEXT_PUBLIC_LEGAL_TERMS_URL`,
  `NEXT_PUBLIC_LEGAL_REFUND_URL`을 본인 법적 문서 URL로 지정
- 결제/과금 모듈은 비활성화 가능 (`DISABLE_BILLING=true`)
- 블로그는 별도 사이트를 운영하고 `NEXT_PUBLIC_BLOG_URL`로 연결

설치 절차와 production-ish compose profile 경로는
[`dev-guide.md`](./dev-guide.md#self-hosted-compose-smoke).

### Compose port exposure policy

OpenCairn의 단일 노드 dev/self-host 구성은 Postgres, Redis, Temporal, MinIO,
Ollama 같은 인프라 서비스를 기본적으로 loopback에만 publish한다. 호스트가
인터넷에 노출된 self-host 환경에서 인증 없는 인프라 포트가 외부 직결되지 않게
하기 위한 정책이다.

**현재 정책 — 인프라 포트는 디폴트 loopback bind, 운영자 명시 override만 외부 노출**:

| Service | 디폴트 host bind | 환경 변수 | 인증 상태 |
|---------|-----------------|----------|-----------|
| `postgres` (5432) | `127.0.0.1` | `POSTGRES_HOST_BIND`, `POSTGRES_HOST_PORT` | `POSTGRES_PASSWORD` `:?` enforced |
| `redis` (6379)    | `127.0.0.1` | `REDIS_HOST_BIND`, `REDIS_HOST_PORT` (PR #145) | `REDIS_PASSWORD` (선택) |
| `temporal` gRPC (7233) | `127.0.0.1` | `TEMPORAL_HOST_BIND`, `TEMPORAL_HOST_PORT` | none (단일 노드) |
| `temporal-ui` (8080)   | `127.0.0.1` | `TEMPORAL_UI_HOST_BIND`, `TEMPORAL_UI_HOST_PORT` | none |
| `minio` S3 (9000) + console (9001) | `127.0.0.1` | `MINIO_HOST_BIND`, `MINIO_HOST_PORT_S3`, `MINIO_HOST_PORT_CONSOLE` | `MINIO_ROOT_PASSWORD` (S3_SECRET_KEY 재사용, `:?` enforced — PR #145) |
| `ollama` (11434) | `127.0.0.1` | `OLLAMA_HOST_BIND`, `OLLAMA_HOST_PORT` | none |

내부 컨테이너 간 통신은 영향 없음 — `api`/`worker` 등은 compose 내부 DNS
(`postgres`, `redis`, `temporal`, `minio`)로 붙고 host port와 무관함. 위 변수는
**호스트에서 보이는** 포트 매핑만 제어한다.

**언제 override 해야 하나?**

- **하지 마라**: 같은 머신에서 `pnpm dev` 로 host-side worker/api 를 띄우는
  경우 — `127.0.0.1:5432` / `127.0.0.1:9000` / `127.0.0.1:7233` 로 충분히 닿는다.
- **신중히**: 다른 머신에서 접속해야 하는 경우 (e.g. worker 가 다른 호스트).
  override 전 인증/암호화 레이어가 추가되어 있는지 확인:
  - **postgres**: 강한 비밀번호 + 방화벽 ACL + 가능하면 `pg_hba.conf` 에서 IP 제한.
  - **redis**: `REDIS_PASSWORD` 설정 + 매칭되는 `REDIS_URL` 갱신.
  - **temporal**: 외부 노출 시 mTLS 권장. SSH 터널 (`ssh -L 7233:localhost:7233`)
    이 더 빠르고 안전한 옵션.
  - **temporal-ui**: 인증 없는 community 이미지. 워크플로우 ID·입력·스택
    트레이스가 누출되니 reverse proxy with auth 또는 SSH 터널 필수.
  - **minio**: console (9001) 은 기본 root 계정으로 들어가니 `MINIO_ROOT_PASSWORD`
    회전 후만 외부 노출. S3 endpoint (9000) 은 사용자 access key/secret 으로
    보호되지만 그것조차 회전된 값이어야 함.
  - **ollama**: 인증 없음. reverse proxy + bearer token 추가 후 override.

**검증**: `docker compose config | grep -E "host_ip|published"` 로 모든 포트가
`host_ip: 127.0.0.1` 인지 확인할 수 있다. 외부 노출이 의도라면 변경한 서비스만
`0.0.0.0` 으로 표시되어야 한다.

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

- `apps/web/src/lib/site-config.ts` 같은 단일 출처 — `process.env.NEXT_PUBLIC_SITE_URL ?? ...` 식
- `app/robots.ts`, `app/sitemap.ts`, `app/layout.tsx` metadata — 전부 `siteConfig`에서 읽기 (정적 `robots.txt`/`sitemap.xml` 만들지 말 것)
- `.env.example` — 모든 키 + 설명 + OSS 디폴트 (`NEXT_PUBLIC_SITE_URL=https://example.com` 등)
- 디폴트 OG 이미지 (중립 "OpenCairn" 로고 PNG) — `apps/web/public/og-default.png`

### `.gitignore`에만

- `.env`, `.env.production`, `.env.local` (Next.js 기본 ignore)
- 본인 도메인 전용 OG/파비콘이 있다면 → 차라리 `OG_IMAGE_URL`을 env로 받아 CDN URL 주입
- Search Console 인증 파일 (`google*.html`) — 또는 env로 meta tag 주입
- 운영 prod의 analytics/ad 키, Sentry DSN

### 표준 env 키

```
NEXT_PUBLIC_SITE_NAME=OpenCairn
OPENCAIRN_HOSTED_SERVICE=false
NEXT_PUBLIC_OPENCAIRN_HOSTED_SERVICE=false
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_SITE_DESCRIPTION_KO=
NEXT_PUBLIC_SITE_DESCRIPTION_EN=
NEXT_PUBLIC_REPOSITORY_URL=https://github.com/opencairn/opencairn
NEXT_PUBLIC_COMPANY_SITE_URL=https://sungblab.com
NEXT_PUBLIC_DOCS_URL=
NEXT_PUBLIC_ADR_URL=
NEXT_PUBLIC_ISSUES_URL=
NEXT_PUBLIC_LICENSE_URL=
NEXT_PUBLIC_CONTACT_EMAIL=
NEXT_PUBLIC_SITE_AUTHOR_NAME=OpenCairn contributors
NEXT_PUBLIC_SITE_AUTHOR_URL=
NEXT_PUBLIC_SUPPORT_URL=
NEXT_PUBLIC_CHANGELOG_URL=
NEXT_PUBLIC_CLA_URL=
NEXT_PUBLIC_DISCORD_URL=
NEXT_PUBLIC_TWITTER_URL=
NEXT_PUBLIC_ROADMAP_URL=
NEXT_PUBLIC_LEGAL_PRIVACY_URL=
NEXT_PUBLIC_LEGAL_TERMS_URL=
NEXT_PUBLIC_LEGAL_REFUND_URL=
NEXT_PUBLIC_BLOG_URL=
NEXT_PUBLIC_PLAUSIBLE_DOMAIN=
NEXT_PUBLIC_GOOGLE_ANALYTICS_ID=
NEXT_PUBLIC_GOOGLE_ADS_ID=
NEXT_PUBLIC_META_PIXEL_ID=
CONTACT_EMAIL=contact@example.com
GOOGLE_SITE_VERIFICATION=
TWITTER_HANDLE=
```

### 지금부터 적용

- 신규 카피·메타·이메일 템플릿은 처음부터 `siteConfig`/i18n 키로 추출. 개인 도메인·고정 repo URL·연락처 직접 박지 말 것.
- `apps/web/src/lib/site-config.ts`가 public site URL, repo/docs/issues/license 링크, legal/blog 링크, footer author/contact/social 링크의 단일 출처다.
- 이메일 기본 연락처와 literature API contact fallback은 `CONTACT_EMAIL`을 쓴다. 운영 환경은 반드시 실제 수신 가능한 주소를 설정한다.

---

## Operator

- 현재: **Sungblab** (개인) — `sungblab.com`
- 제품 도메인: **OpenCairn** — `opencairn.com`
