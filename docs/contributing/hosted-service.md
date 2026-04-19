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

## Operator

- 현재: **Sungblab** (개인) — `sungblab.com`
- 정식 출시 후: **OpenCairn** (법인 또는 개인사업자) — `opencairn.com` (도메인 확보 + 사업자등록 완료 후 이관)
