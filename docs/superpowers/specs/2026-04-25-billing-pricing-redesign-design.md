# Billing & Pricing Redesign — Cash-Based PAYG with Solo-Free Promise

> **Status**: design complete (2026-04-25). 구현은 `project_plan9b_deferred` 정책에 따라 모든 dev plan 종료 후로 보류.
> **Supersedes**: `docs/architecture/billing-model.md` § 1 (Plan structure), § 2 (PAYG credit system). 그 외 (§ 3 알림, § 4 DB 스키마, § 5 Payment Rails) 는 호환 유지 + 일부 수정.
> **Related**: `docs/architecture/billing-routing.md` (키 라우팅 — 호환), `docs/superpowers/specs/2026-04-22-super-admin-console-design.md` (Promotion Engine 확장 대상), `docs/superpowers/specs/2026-04-22-ai-usage-visibility-design.md` (캐시 UI 정합).

---

## 1. Problem & Decision Summary

### 1.1 Problem

기존 모델 (Pro ₩4,900 + PAYG, BYOK ₩2,900) 은 다음 4 가지 문제를 가짐:

1. **마케팅·CAC 비용 미반영** → ₩4,900 정액의 실제 마진 거의 0 (인프라 + PG 수수료 + CAC 회수 24개월 가정 시 적자)
2. **정액 구독은 burst-pattern AI 사용자와 utility 불일치** — 시험기간 학생, 프로젝트 직장인의 실제 사용 패턴은 균등하지 않음. 한국 SaaS 구독 피로감 41% (2026)
3. **추상 크레딧 단위는 시장에서 반복 실패** — Cursor 2025-06 pricing crisis ($350 overage in a week, 7월 4일 공개 사과), Vercel v0 사용자 이탈, Replit effort-based 백래시, 다글로 추가 충전 3개월 만료 불만
4. **한국 사용자 멘탈 모델은 캐시 (₩ 1:1)** — 네이버캐시·리디캐시·카카오캐시 패턴이 압도적. "크레딧"은 영어 외래어, "토큰"은 암호화폐 연상

### 1.2 Decision (한 페이지 요약)

**4-tier 단순화 + 캐시 (₩ 1:1) 단위 + 솔로 구독 폐지 + Welcome 캐시 + Promotion Engine + 7 안전장치**

| Tier | 월정액 | 핵심 entitlement |
|------|--------|------------------|
| **Solo PAYG** | ₩0 | 캐시 충전만, 노트·storage 100MB 무료, 협업 ✗ |
| **BYOK** | ₩3,900 | 본인 Gemini 키, AI 비용 0, storage 10GB, 협업 ✗ |
| **Team** | ₩9,900/seat | 워크스페이스·게스트·공개 링크·우선 큐, 캐시 워크스페이스 공유 |
| **Self-host** | ₩0 | AGPLv3 (변경 없음) |

→ **Pro 정액 ₩4,900 폐지**. Pro 의 "협업 + PAYG 번들" 역할은 Team 단독으로 흡수.

### 1.3 Why this works (시장 데이터 기반)

- **Cursor 실패 회피**: 캐시 모델 + hard cap default + 작업 전 cost preview → surprise bills 구조적으로 불가능
- **Windsurf 실패 회피**: 영구 보유 + 만료 없음 → burst 사용자 banking 가능 (시험기간 몰빵 OK)
- **다글로 약점 공격**: 추가 충전 3개월 만료 vs 우리 영구 보유
- **뤼튼 차별화**: 카테고리 분리 (chatbot vs knowledge OS) — 직접 가격 경쟁 회피
- **한국 학생 시장 무주공산**: .ac.kr 자동 인식 + abuse-watchlist 차별화 인프라

---

## 2. Tier Structure 상세

### 2.1 Solo PAYG (₩0/월)

- 노트 작성·편집·로컬 검색 무제한 (Hocuspocus solo)
- Storage 100MB
- 프로젝트 10개
- AI 기능: 캐시 잔액 차감 (충전 후)
- 12 에이전트 모두 접근 가능 (캐시 차감 시)
- 협업 없음 (워크스페이스·게스트·공개 링크 ✗)

### 2.2 BYOK (₩3,900/월)

- Solo PAYG 전체 +
- 본인 Gemini 키 사용 (AES-256-GCM 암호화 저장, security-model.md § 4)
- **AI 비용 0** (본인 Gemini 콘솔로 직접 결제)
- Storage 10GB
- 잔액 표시: ₩ 통화 ("이번 달 ₩2,340 부담 — Gemini 콘솔 기준")
- 협업 없음

### 2.3 Team (₩9,900/seat/월)

- BYOK 전체 + 협업 +
- 워크스페이스·역할별 권한·공개 링크·게스트
- Deep Research 우선 큐
- 1년 활동 로그 보존
- **워크스페이스 공유 캐시** (seat × N seat 합산, 워크스페이스 단위 잔액)
- 이메일 지원

### 2.4 Self-host (₩0)

변경 없음. AGPLv3 무제한 워크스페이스/멤버, Ollama 완전 로컬, 운영·하드웨어 본인 책임.

### 2.5 Enterprise (별도 트랙)

기존 billing-model.md § 1 그대로 유지 (맞춤 견적, SSO, 온프레미스).

---

## 3. 캐시 시스템

### 3.1 단위

- **표시 단위**: ₩ 캐시 (KRW 1:1)
- **DB 단위**: KRW (`credit_balances.balance_krw` BIGINT — 기존 그대로, 변경 0)
- **레이블**: "캐시" — 네이버캐시·리디캐시·카카오캐시 멘탈 모델
- **추상 크레딧 폐기**: "100 credits" 같은 별도 단위 도입하지 않음. 모든 UI는 ₩ 직접 표시.

### 3.2 충전팩

| 팩 | 결제 | 적립 캐시 | 보너스 |
|---|------|----------|--------|
| 기본 | ₩5,000 | ₩5,000 | — |
| 중간 | ₩30,000 | ₩33,000 | +₩3,000 (10%) |
| 대형 | ₩100,000 | ₩115,000 | +₩15,000 (15%) |

VAT 10% 별도 (기존 정책 유지).

**왜 팩 단위로 인지 부여**: 사용자가 "정해진 양 받음" 만족감 (endowed progress effect) 을 캐시 모델에서도 누림. 충전 = 한 팩 = 명확한 경계.

### 3.3 차감 (model multipliers)

모델별 KRW 단가는 **admin 설정 가능** (별도 `pricing_models` 테이블, Promotion Engine 과 분리). 환율·모델 단가 변동 흡수 layer.

기준 비율 (2026-04-25 기준 추정, 구현 시점 재산정):

| 작업 | 차감 |
|------|------|
| Flash 채팅 1회 | ≈ ₩30~50 |
| Pro 채팅 1회 | ≈ ₩300~500 |
| Deep Research 1회 | ≈ ₩2,000~3,000 |
| PDF 100페이지 임베딩 | ≈ ₩200~300 |
| Wiki 1페이지 자동 생성 | ≈ ₩100~200 |

**원칙**:
- **실패한 작업 차감 X** (Replit effort-based 실패 회피, 기존 billing-model.md § 2.4 정합)
- 캐시 히트 (Gemini Context Caching) → input 단가 1/4 반영
- 환율·모델 단가 변동 → admin 조정 + **30일 사전 고지** (이메일 + in-app 배너)

### 3.4 만료

- **만료 없음. 영구 보유.**
- 다글로 (추가 충전 3개월 만료) 와 차별화 핵심 메시지
- 전자상거래법 선불 충전금 보존 의무 5년 → 우리는 **계정 유지 동안 무기한**

---

## 4. Welcome 캐시 + Promotion Engine

### 4.1 Welcome Grant 구조

| 시점 | 적립 | 카드 필요 | 대상 |
|------|------|----------|------|
| 신규 가입 (이메일 verify) | ₩3,000 | 불필요 | 모든 가입자 |
| 카드 등록 (PG 검증) | +₩2,000 | 필수 | abuse 차단 + 전환율 (Anthropic $5 패턴) |
| .ac.kr 인증 | +₩7,000 | 불필요 | 학생 (1년 재인증) |
| 추천 (referral) | 추천인 +₩2,000 / 피추천인 +₩3,000 | — | 5명/연 한도 |
| Incident makegood | admin 재량 (예: ₩5,000) | — | 장애 보상 (Anthropic $50 패턴) |

**최대 적립**:
- 일반 가입: ₩5,000 (가입 + 카드)
- 학생: ₩12,000 (가입 + 카드 + 학생)

### 4.2 Welcome 표현 (UI)

```
🎁 환영합니다!
   ₩3,000 캐시 증정 · 만료 없음

   카드 등록하면 +₩2,000 추가
   학생 인증(.ac.kr)하면 +₩7,000 추가
```

**원칙**: "환영 캐시" 표현 (NOT "무료 체험") — 선물 vs 끝나는 trial 인지 차이.

### 4.3 Promotion Engine

`promotions` 테이블 + admin UI (super_admin_console spec 확장):

```sql
CREATE TABLE promotions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT UNIQUE NOT NULL,
  type          TEXT NOT NULL CHECK (type IN (
                  -- Day 1 필수 (4 core)
                  'welcome_grant',
                  'student_bonus',
                  'referral_credit',
                  'makegood_grant',
                  -- 확장 (Promotion Engine 위에 추가)
                  'topup_bonus',
                  'partner_university'
                )),
  conditions    JSONB NOT NULL,  -- {email_domain, university_partner, signup_source, ...}
  params        JSONB NOT NULL,  -- {credit_krw, expires_at_days, max_per_user, ...}
  active        BOOLEAN NOT NULL DEFAULT true,
  start_at      TIMESTAMPTZ,
  end_at        TIMESTAMPTZ,
  priority      INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE promotion_redemptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  promotion_id    UUID NOT NULL REFERENCES promotions(id),
  credit_krw      BIGINT NOT NULL,
  ledger_id       UUID REFERENCES credit_ledger(id),  -- audit chain to credit_ledger
  idempotency_key TEXT NOT NULL UNIQUE,               -- user_id + promo_code + period
  redeemed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX promotion_redemptions_user_idx ON promotion_redemptions(user_id);
```

**매칭 시점**:
- 가입 직후
- 이메일 verify 직후
- 카드 등록 직후
- 충전 직전 (PG 호출 전 가격 산정 후 적용)
- 매월 1일 (월간 갱신형 프로모션)

**감사 추적**: 모든 redemption 은 `credit_ledger` 와 1:1 연결 (audit chain). idempotency_key 로 중복 적립 방지.

---

## 5. 학생 정책 (.ac.kr)

### 5.1 인증

- **.ac.kr 이메일 인증** (1년 재인증)
- SheerID 같은 유료 서비스 사용하지 않음 (비용 절감)
- 영문 enrollment certificate 강요하지 않음 — JetBrains 한국 학생 불만 회피
- 졸업생 자동 거름: .ac.kr 메일 만료 + 1년 재인증 미응답 시 일반 PAYG 강등

### 5.2 Abuse Watchlist

```sql
CREATE TABLE blocked_email_domains (
  domain      TEXT PRIMARY KEY,           -- e.g., 'abuse.ac.kr'
  reason      TEXT NOT NULL,              -- 차단 사유
  blocked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  blocked_by  UUID REFERENCES users(id)   -- admin user
);
```

- **GitHub repo 공개** (JetBrains 식 transparency)
- 차단 사유: 다중 계정 abuse 확인된 도메인
- 디바이스 fingerprint + IP 분석 보조 (super_admin_spec 영역)

### 5.3 학생 정액 플랜 미도입 (옵션 β 채택)

- **별도 학생 정액 플랜 도입하지 않음**
- 이유:
  1. "구독 0원" 메시지 일관 — 학생만 예외 두면 메시지 약화
  2. Wrtn 교훈 — 한국 B2C 정액 결제 저항 (무료 한국 대안 있을 때)
  3. 시장 표준 = 할인 코드 (라이너·세타웨이브·퍼플렉시티)
  4. abuse 면역 — 정기 결제 안 받으니 .ac.kr 도용 동기 약함
- 학생 혜택: **Welcome ₩7,000 추가 + 충전 시 +X% 보너스** (Promotion Engine `student_bonus` type 으로 동적 조정)

### 5.4 제휴 대학 (deferred)

- 첫 1~2개 학교 (KAIST/POSTECH/SNU/UNIST 후보) 시범 협의
- 검증된 모델 매뉴얼화 후 확장
- `partner_university` Promotion type 으로 지원
- 본 spec 범위 외 — 사업개발 별도 트랙

---

## 6. 안전장치 7개 (Cursor 실패 회피)

day 1 부터 필수 구현. 사후 추가 불가능 (Cursor 가 사후 추가하다 사용자 신뢰 회복 못 함).

1. **Hard cap on by default** — 잔액 0 = 작업 차단. 자동충전은 explicit opt-in. 한국 소비자 보호법 정합.
2. **작업 전 ₩ preview** — 헤비 작업 (Deep Research, 12 에이전트 헤비 호출) 사전 비용 표시 + 모델 badge
3. **실시간 잔액 위젯** — 차감 직후 즉시 갱신 (Cursor 폭발 핵심 원인: counter 사라짐)
4. **모델별 cost 도움말 항상 접근 가능** — Settings/footer 링크. 12 에이전트 카드 UI 에 ₩X cost 명시. 숨김 X.
5. **실패 작업 차감 X** — Replit effort-based 백래시 회피 (이미 billing-model.md § 2.4 정합)
6. **모델 multiplier 변경 30일 사전 고지** — 이메일 + in-app 배너 (Cursor silent change 핵심 회피)
7. **월간 자율 한도 설정** — "이번 달 ₩X 이상 안 쓰겠다" 사용자 설정 → 한도 도달 시 충전 차단 (헤비 학생 죄책감 방지)

---

## 7. UI/UX (캐시 + 충전팩 표시)

### 7.1 잔액 위젯 (대시보드)

```
┌──────────────────────────┐
│ ₩4,640 캐시              │
│ └ 충전하기 →             │
├──────────────────────────┤
│ 이번 달 사용  ₩1,360     │
│ 다음 충전 권장 ₩1,000 이하│
└──────────────────────────┘
```

### 7.2 충전 다이얼로그

```
┌─ 캐시 충전 ──────────────────────┐
│  ○ ₩5,000  → ₩5,000  캐시         │
│  ○ ₩30,000 → ₩33,000 캐시 +10%    │
│  ● ₩100,000→ ₩115,000 캐시 +15%   │
│                                  │
│  [충전하기]                      │
│                                  │
│  ✓ 만료 없음 · 영구 보유          │
│  ✓ 자동충전 OFF (옵션)            │
└──────────────────────────────────┘
```

### 7.3 작업 시작 전 preview (헤비 작업)

```
┌─ Deep Research 시작 ─────────────┐
│  예상 차감  ≈ ₩2,500             │
│  현재 잔액  ₩4,640 (충분)        │
│                                  │
│  [실행하기]  [모델 변경]         │
└──────────────────────────────────┘
```

### 7.4 차감 토스트 (작업 직후)

```
✓ Deep Research 완료
  ₩2,500 차감 · 잔액 ₩2,140
```

### 7.5 12 에이전트 카드 UI

각 에이전트 카드에 expected cost 명시 (Linear/Notion AI 패턴):

```
┌─────────────────┐  ┌─────────────────┐
│  Wiki Compiler  │  │  Deep Research  │
│  ≈ ₩150/페이지   │  │  ≈ ₩2,500/회    │
└─────────────────┘  └─────────────────┘
```

→ "₩1 의 사용이 무엇을 사주는지" 항상 명확. Cursor 실패 핵심 (hidden multiplier) 정확히 회피.

### 7.6 BYOK 사용자 (별도 트랙)

크레딧/캐시 개념 없음. 본인 Gemini 키 사용량 표시:

```
┌──────────────────────────┐
│ BYOK 활성                │
│ 이번 달 ₩2,340 부담      │
│ Gemini 콘솔에서 확인 →   │
└──────────────────────────┘
```

---

## 8. 마케팅 카피 가이드라인

기존 `feedback_opencairn_copy` 규칙 (존댓말 · 경쟁사 미언급 · 기술 스택 최소화) 유지.

### 8.1 핵심 메시지 (3개)

1. **"구독 없는 AI 노트"** — 솔로 ₩0 약속
2. **"만료 없는 캐시"** — 영구 보유 (다글로 차별)
3. **"surprise 없는 PAYG"** — hard cap default + cost preview (Cursor 차별)

### 8.2 카피 금지

- 환율 노출 ("$1=₩1,650" 같은 표현) — 내부 마진 노출
- "from us" 같은 내부 마진 구조 암시
- "Subscription + AI usage separate" 같은 회계 용어
- 부정형 마무리 ("not included" 류) — 강점으로 재프레임
- 영문 헤드라인 한국 랜딩 잔존 — 전부 존댓말 국문

### 8.3 카피 사용 가능

- "Notion 절반 가격" (Notion Plus ≈ ₩16,500 / 우리 Team ₩9,900) — 단 직접 비교 회피, 카테고리 비교만
- "ChatGPT 의 1/6" (₩29,000 vs Welcome 시나리오)
- "노트는 영원히 무료"
- "충전한 만큼, 영원히, 쓴 만큼만"
- "시험 끝나면 잠수 OK" (학생 타겟)

---

## 9. 변경 영향

### 9.1 기존 문서 업데이트

| 파일 | 변경 내용 |
|------|----------|
| `docs/architecture/billing-model.md` | § 1 4-tier 재작성 (Pro 폐지, BYOK ₩2,900→₩3,900) · § 2 캐시로 재명명 (DB 변경 0) · § 3 알림 그대로 · § 4 promotions/promotion_redemptions/blocked_email_domains 추가 · § 6 BYOK 가격만 수정 |
| `docs/architecture/billing-routing.md` | 호환됨. 본 redesign 이 라우팅 영향 없음 (라우팅 = 키 출처 결정, 본 spec = 단가/표시 결정) |
| `docs/superpowers/specs/2026-04-22-super-admin-console-design.md` | **Promotion Engine 섹션 추가** (4 grant type + abuse watchlist UI). 별도 spec 보다 기존 확장 권장 |
| `docs/superpowers/specs/2026-04-22-ai-usage-visibility-design.md` | 캐시 표시 UI 정합 확인 — 본 spec 이 우선 (UI 가이드) |
| `apps/web/messages/{ko,en}/landing.json` | "Free/Pro/BYOK" → "Solo/BYOK/Team" 카드 재작성, 환율 표기·"from us"·영문 헤드라인 제거 |

### 9.2 신규 코드 영향 (Plan 9b 구현 시)

- `packages/db/src/schema/promotions.ts` — Promotion Engine 테이블 신규
- `packages/db/src/schema/credits.ts` — `subscriptions.plan` enum 변경 (`'free'`/`'pro'`/`'byok'` → `'solo'`/`'byok'`/`'team'`)
- `apps/api/src/routes/admin/promotions.ts` — admin CRUD
- `apps/api/src/routes/billing/cash.ts` — 충전팩 + Welcome 적립 + redemption
- `apps/web/src/components/billing/` — 잔액 위젯·충전 다이얼로그·preview·토스트
- `apps/web/messages/{ko,en}/billing.json` — i18n
- `apps/web/messages/{ko,en}/landing.json` — 4-tier 카드 재작성

### 9.3 마이그레이션

DB 스키마 변경 거의 없음. `subscriptions.plan` CHECK 제약조건 갱신 + `promotions`/`promotion_redemptions`/`blocked_email_domains` 신규 테이블만.

dev 환경 (현재 사용자 0명) 에서는 단순 마이그레이션. prod 사용자 발생 시:
- Pro 사용자 → Team 으로 자동 이전 (₩4,900 → ₩9,900 인상이라 60일 사전 고지 + 옵트아웃 기간)
- BYOK 사용자 → ₩2,900 → ₩3,900 인상 (60일 사전 고지)

---

## 10. 시장 포지셔닝

| 경쟁사 | 가격 | 우리 차별화 |
|--------|------|------------|
| 뤼튼 | 무료 (chatbot) | 카테고리 다름 (지식 OS) — 직접 비교 회피 |
| 다글로 | ₩14,900~24,900 (크레딧 3개월 만료) | "만료 없는 캐시" |
| UnivAI | ₩9,900 정액 | "구독 강요 없음, 시험 끝나면 잠수 OK" |
| 라이너 | ₩29,000 (대학원생 ₩15,000) | "학생도 진짜 솔로는 무료" |
| ChatGPT Plus | ₩29,000 | "1/6 가격에 노트 + 12 에이전트" |
| 세타웨이브 | $19.90/주 | 영구 노트 + 협업 |
| Cursor (해외) | $20 + 위험 overage | hard cap default, surprise 없음 |
| Notion AI | $20/seat (Business 통합) | AI 비용 분리 = 가벼운 사용자 부담 ↓ |

---

## 11. Open Questions

- [ ] 신규 Pro 폐지 시 기존 메모 (`project_billing_model`) 와 web 랜딩 카피 동기화 시점 — Plan 9b 시작 시 함께
- [ ] 1 캐시 단위 minimum: ₩1 vs ₩10 (차감 round-up 정책) — 구현 시점 결정
- [ ] Team 워크스페이스 캐시는 모든 seat 공유 vs 분배 — 구현 시점 spec 확장
- [ ] 충전 자동충전 기본값: OFF (안전) vs OFF + 권장 모달 — UX 결정
- [ ] referral abuse threshold: 5명/연 vs 다른 숫자 — 시장 데이터 누적 후
- [ ] 제휴 대학 첫 타겟 (KAIST/POSTECH/SNU/UNIST) — 사업개발 트랙
- [ ] 환불 정책 (기존 § 2.3) — 그대로 유지하되 **Welcome 캐시는 환불 대상 X** (gift) 명시 필요
- [ ] BYOK 사용자에게 Promotion (Welcome 등) 적용 정책 — Welcome 받고 BYOK 전환 시 캐시 어떻게 처리할지
- [ ] Self-host 사용자에게 Welcome 캐시 의미 — 무관 (관리형만 적용)

---

## 12. References

### 메모리
- `feedback_byok_cost_philosophy` — 사용자 지불 경로 게이팅 금지
- `feedback_llm_provider_env_only` — provider 노출 금지
- `feedback_opencairn_copy` — 마케팅 카피 규칙
- `project_plan9b_deferred` — billing 구현은 모든 dev plan 끝난 뒤
- `project_billing_routing_exploring` — 키 라우팅 정책

### 기존 문서
- `docs/architecture/billing-model.md` — 본 spec 이 § 1, § 2 superseded
- `docs/architecture/billing-routing.md` — 호환
- `docs/superpowers/specs/2026-04-22-super-admin-console-design.md` — Promotion Engine 확장 대상
- `docs/superpowers/specs/2026-04-22-ai-usage-visibility-design.md` — 캐시 UI 정합

### 외부 (시장 리서치, 2026-04-25)
- Cursor pricing controversy (2025-06): TechCrunch · Cursor blog · wearefounders.uk
- Windsurf credits→quotas backlash (2026-03): Product Hunt · Efficienist
- Replit cycles effort-pricing backlash: InfoWorld · blog.replit.com
- Vercel v0 token-credit failure: Medium · Vercel community
- Lovable 1 credit = 1 message (작동한 단순 매핑): docs.lovable.dev
- Linear AI bundled in seat: linear.app/pricing
- Notion AI complimentary 20 responses: notion.com/help/complimentary-ai-responses
- Anthropic Console $5 free credit: aicreditmart.com
- Anthropic $50 makegood grant pattern: xda-developers.com
- Korean competitors: 다글로 daglo.ai · 세타웨이브 · UnivAI univai.co.kr · 뤼튼 wrtn.ai · 라이너 liner.com
- Korean B2C anchors: 네이버 치지직 ₩4,900 · SKT subscription ₩9,900 통합
- Subscription fatigue 2026: 41% consumer reports
- 한국 ChatGPT 유료 구독 세계 2위: the14f.com
- 한국 대학생 71.2% AI 사용: wiseapp.co.kr
- JetBrains Korea 학생 라이센스 차단 사례: blog.jetbrains.com/ko
- Endowed progress effect: Nunes & Drèze 2006

---

## 13. Decision Log

| Date | Decision | Reason |
|------|----------|--------|
| 2026-04-25 | 추상 크레딧 → 캐시 (₩) 단위 채택 | 한국 시장 멘탈 모델 (네이버캐시·리디캐시) + Cursor/Vercel 실패 회피 + 다글로 약점 공격 |
| 2026-04-25 | Pro 정액 ₩4,900 폐지, 4-tier 단순화 | 마케팅 비용 미반영 + 메시지 단순화 + Team 이 Pro 역할 흡수 |
| 2026-04-25 | BYOK ₩2,900 → ₩3,900 | 인프라 운영비 회수 + 시장 최저가 유지 |
| 2026-04-25 | 학생 정액 플랜 도입 안 함 (옵션 β 채택) | "구독 0원" 메시지 일관 + 시장 표준 = 할인 코드 + Wrtn 교훈 |
| 2026-04-25 | Welcome ₩3,000 + 카드 ₩2,000 + 학생 ₩7,000 | 부트스트랩 stingy 원칙 + Anthropic $5 패턴 + 차별화 |
| 2026-04-25 | 충전팩 보너스 (단계별 +10%/15%) | 헤비 충전 인센티브 + 게임화 + 사용자 "정해진 양 받음" 만족감 |
| 2026-04-25 | 만료 없음 영구 보유 | 다글로 (3개월 만료) 차별화 + Windsurf banking 원칙 |
| 2026-04-25 | 안전장치 7개 day 1 필수 | Cursor 4-failure stack 회피 (silent change · hidden multiplier · no cap · counter 사라짐) |
| 2026-04-25 | Promotion Engine + abuse watchlist 공개 | 모든 정책을 admin 동적 + JetBrains transparency |
| 2026-04-25 | BYOK 는 별도 트랙 (₩ 통화 표시, 캐시 개념 없음) | 본인 키 사용량은 캐시 추상화 부적합 |
