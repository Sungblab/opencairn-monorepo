# Billing Model

OpenCairn v0.1 과금 모델. 관리형(hosted) 사용자의 요금제·AI 크레딧·환율·환불·알림을 정의합니다. Self-host(AGPLv3 — 또는 ADR-005의 상용 라이선스 옵션)는 본 문서 대상 아님.

> **⚠️ 결제 레일 BLOCKED (2026-04-20)**: 사업자등록 후 PG 선택. 후보: Toss Payments, 포트원(아임포트), 스트라이프. 그 전까지 **provider-agnostic core만 구현**. Plan 9 Task 1(Payment Rail 연동)은 사업자등록 완료 시점에 unblock.

> **상태**: 2026-04-19 확정. 가격 모델·크레딧 시스템·환율·환불 정책은 확정. 결제 수단(payment rail)만 BLOCKED.

---

## 1. 플랜 구조

| Plan | 월 구독료 | AI 비용 모델 | 대상 | 주요 entitlement |
|------|----------|-------------|------|----------------|
| **Free** | ₩0 | 우리 키 (월 한도 내 무료) | 체험·개인 경량 | 프로젝트 10개, Q&A 50/월, 오디오 3/월, 스토리지 100MB, 12 에이전트 전체 접근, 커뮤니티 지원 |
| **BYOK** | ₩2,900/월 | **본인 Gemini 키** (₩0 to us) | 관리형 솔로 사용자 | 우리가 호스팅(1인 계정) · 서버·스토리지·파싱 파이프라인 운영비 포함 · Pro 팀 기능 제외. **Self-host 아님** — 우리 서버 위 1인 계정을 임대받는 모델 |
| **Pro** | ₩4,900/월 + **PAYG** | 선불 크레딧 차감 (최소 ₩5,000 충전, 만료 없음) | 팀·연구실 | 워크스페이스·역할별 권한·공개 링크·게스트·Deep Research 우선 큐·스토리지 10GB·1년 활동 로그·이메일 지원 |
| **Self-host** | ₩0 | 본인이 LLM 제공 | 개발자·규제 산업 | AGPLv3 전체 코드(또는 상용 라이선스 옵션, ADR-005), 무제한 워크스페이스/멤버, Ollama 완전 로컬 지원. 운영·하드웨어는 본인 책임 |
| **Enterprise** | 맞춤 견적 | 계약별 | 금융·의료·공공·대학 | 온프레미스 · SSO (SAML/OIDC) · 감사 로그 · 상용 라이선스 · 전담 지원 SLA |

**모든 구독료·충전금은 VAT(부가세 10%) 별도.** 영수증에 VAT 분리 표기.

**포지셔닝 메모**
- BYOK는 "Pro 저가형"이 아님. **우리 인프라에서 1인 계정을 임대받고** AI 비용만 본인 Gemini 키로 감당하는 **관리형 솔로 tier**. Self-host(AGPLv3, 본인 서버)와 혼동 주의 — BYOK는 OpenCairn 호스티드.
- Pro는 "팀 협업 + PAYG AI"의 bundle. Pro를 구독하면 기본 entitlement에 더해 AI 크레딧 시스템이 활성화됨.
- Free에서 BYOK 전환 시 Pro 팀 기능은 자동 잠김(워크스페이스·게스트·우선 큐 등). UI에 명확히 표시.

---

## 2. PAYG 크레딧 시스템 (Pro 전용)

### 2.1 환율 락 · 마진

```
effective rate = (base_krw_per_usd) × (1 + margin_pct)
               = 1,500 × 1.10
               = ₩1,650 per USD
```

- `base_krw_per_usd = 1500` (2026-04-19 설정, 실거래 환율 ≈ ₩1,460)
- `margin_pct = 10%` (환율 변동 완충 + 운영 마진)
- **조정 가능**: 실거래 환율이 ±10% 이상 변동 시 또는 OpenCairn 재량에 따라 조정. **30일 사전 고지 의무** (이메일·in-app 배너). 조정 시점 이후 신규 충전·사용에만 적용, 기존 잔액은 충전 시점 환율 유지.
- 환율 스냅샷은 사용자별로 `credit_balances.exchange_rate_krw_per_usd` 에 저장. 변경은 새 거래부터 반영.

### 2.2 최소 충전 · 자동 재충전

- **최소 1회 충전액: ₩5,000 + VAT** (= ₩5,500 결제, 크레딧 ₩5,000 적립)
- 자동 재충전 (옵션):
  - `auto_recharge_enabled`: 사용자 on/off
  - `auto_recharge_threshold_krw`: 기본 ₩1,000. 이 값 이하로 떨어지면 트리거
  - `auto_recharge_amount_krw`: 기본 ₩5,000. 트리거 시 충전 금액
  - 실패 시 즉시 알림 + 수동 충전 전까지 모든 AI 작업 차단

### 2.3 잔액 만료 · 환불

- **만료 없음.** 충전된 크레딧은 계정 유지 기간 동안 유효.
- 전자상거래법 선불 충전금 보존 의무(5년)를 넘어, 탈퇴 전까지 보존.
- 계정 삭제 시 미사용 잔액은 자동 환불 시도(원결제수단으로). 실패 시 이메일로 계좌 입금 안내.

**환불 정책**
| 상황 | 정책 |
|------|------|
| 충전 후 7일 이내 · 미사용 | 전액 환불 (수수료 없음) |
| 충전 후 7일 이내 · 일부 사용 | 미사용분 환불 (사용분 공제) |
| 충전 후 7일 경과 · 미사용 | 요청 시 환불 (영업일 5일 내 처리) |
| 계정 삭제 | 미사용분 자동 환불 |
| Pro 구독료 ₩4,900 | 가입 14일 이내 & AI 사용 0원 시 전액 환불 |
| BYOK 구독료 ₩2,900 | 가입 14일 이내 월할 환불 |

### 2.4 크레딧 차감 (deduction)

```
[LLM 호출 종료]
  → input_tokens · output_tokens 로그
  → 모델별 단가 조회 (providers/pricing.ts 테이블)
  → usd_cost = input_tokens × in_rate + output_tokens × out_rate
  → krw_cost = round(usd_cost × exchange_rate, KRW_MINOR_UNIT=1)
  → credit_balances.balance_krw -= krw_cost
  → credit_ledger INSERT (kind='usage', request_id, tokens, usd_cost, rate, delta_krw=-krw_cost)
```

- 모든 크레딧 거래는 **append-only ledger** (`credit_ledger`). 잔액은 파생값으로 재계산 가능.
- **차감은 호출 성공 시에만.** 실패 · 취소된 요청은 차감 없음.
- 캐시 히트(Gemini Context Caching)는 input 토큰 단가 1/4 적용 — 그대로 반영.

### 2.5 잔액 소진 UX (graceful degrade)

| 상황 | 자동충전 ON | 자동충전 OFF |
|------|-------------|-------------|
| 잔액 < threshold × 1.5 | — (아직 여유) | in-app 배너 경고 (조치 권장) |
| 잔액 < threshold | 즉시 자동충전 트리거 | 이메일 + in-app 긴급 경고 |
| 자동충전 실패 / 잔액 ≤ 0 | 마지막 작업까지 실행 (최대 -₩500 허용) · 신규 작업 차단 | 동일 |
| **Deep Research 시작 전** | 예상 비용 × 1.2 선검증 · 미달 시 자동충전 대기 | 예상 비용 × 1.2 선검증 · 미달 시 **거부** |

**핵심 원칙**: 사용자가 자동충전을 껐어도 **진행 중인 일반 작업은 완료시킨다.** 음수 잔액이 발생할 수 있으나 상한 ₩500까지 허용(소비자 친화). 음수 잔액은 다음 충전 시 자동 정산.

**Deep Research 예외**: 건당 $2-5+ 예상 → 음수 허용 범위 초과 가능성 → 시작 전 하드 체크. 잔액 부족 시 "₩X 추가 충전 필요" CTA 표시 후 중단.

**진행 중 작업 취소**: 사용자는 활동 로그(Hocuspocus presence + agent feed)에서 진행 중인 에이전트 작업을 수동 취소 가능 (Temporal `SignalWorkflow('cancel')`).

---

## 3. 알림 임계값

| Threshold | 트리거 | 채널 |
|-----------|--------|------|
| 잔액 < ₩1,000 (기본 threshold × 1.5) | in-app 배너 | in-app only |
| 잔액 < ₩500 (기본 threshold 근접) | 경고 배너 + 이메일 1회 | in-app + email |
| 잔액 < ₩100 | 긴급 배너 | in-app + email |
| 자동충전 실패 | 즉시 알림 | in-app + email |
| 월 사용량 지난 달 대비 +50% (이상 사용) | 1회 알림 | email |
| 환율 조정 예정 (30일 전) | 공지 배너 | in-app + email |

Threshold 값은 사용자가 설정 → DB 저장 → 알림 엔진이 cron으로 체크.

---

## 4. DB 스키마 (제안)

`packages/db/src/schema/credits.ts`에 추가 예정. 본 스키마는 **plan-9 billing 작업과 별도 task**로 후속 구현.

```sql
-- 잔액 (user 1:1)
CREATE TABLE credit_balances (
  user_id                         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance_krw                     BIGINT NOT NULL DEFAULT 0,
  auto_recharge_enabled           BOOLEAN NOT NULL DEFAULT false,
  auto_recharge_threshold_krw     BIGINT NOT NULL DEFAULT 1000,
  auto_recharge_amount_krw        BIGINT NOT NULL DEFAULT 5000,
  exchange_rate_krw_per_usd       INTEGER NOT NULL DEFAULT 1650,
  notified_low_balance_at         TIMESTAMPTZ,
  notified_critical_balance_at    TIMESTAMPTZ,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 거래 이력 (append-only ledger)
CREATE TABLE credit_ledger (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                    UUID NOT NULL REFERENCES users(id),
  kind                       TEXT NOT NULL CHECK (kind IN ('topup','usage','refund','adjust','auto_topup')),
  delta_krw                  BIGINT NOT NULL,      -- +충전 / -차감
  balance_after_krw          BIGINT NOT NULL,      -- 거래 후 잔액 (빠른 조회용)

  -- usage 전용
  request_id                 TEXT,                  -- LLM request id
  model                      TEXT,                  -- 'gemini-2.5-pro', 'ollama:llama3:8b', ...
  usage_tokens_in            INTEGER,
  usage_tokens_out           INTEGER,
  usage_tokens_cached        INTEGER DEFAULT 0,     -- Gemini context cache hits
  usage_usd_cost             NUMERIC(10,6),
  exchange_rate_at_txn       INTEGER,

  -- topup 전용
  payment_provider           TEXT,                  -- 'toss' | 'lemonsqueezy'
  payment_key                TEXT,                  -- provider 영수증 key
  vat_krw                    BIGINT,

  -- refund 전용
  refund_reason              TEXT,
  refund_original_ledger_id  UUID REFERENCES credit_ledger(id),

  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX credit_ledger_user_created_idx ON credit_ledger (user_id, created_at DESC);
CREATE INDEX credit_ledger_request_idx      ON credit_ledger (request_id) WHERE request_id IS NOT NULL;

-- 구독 (Pro/BYOK 활성 상태 + BYOK 키 암호화 저장)
CREATE TABLE subscriptions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  plan text NOT NULL CHECK (plan IN ('free','pro','byok')),
  status text NOT NULL CHECK (status IN ('active','cancelled','past_due')),
  current_period_start timestamptz NOT NULL,
  current_period_end timestamptz NOT NULL,
  -- BYOK 전용 (AES-256-GCM, security-model.md §4 참조)
  byok_gemini_key_ciphertext bytea,
  byok_gemini_key_iv bytea,
  byok_gemini_key_version int DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX subscriptions_user_active ON subscriptions(user_id) WHERE status = 'active';
```

> **BYOK 키 컬럼 네이밍**: `byok_gemini_key_ciphertext` / `byok_gemini_key_iv` / `byok_gemini_key_version` 은 [security-model.md §4](./security-model.md#4-byok-key-management)와 정합. 다른 문서는 이 이름을 그대로 참조(재명명 금지).

### 4.1 사용량 차감 트랜잭션 (pseudocode)

```typescript
// apps/api/src/lib/credits.ts
async function deductUsage(params: {
  userId: string
  requestId: string
  model: string
  tokensIn: number
  tokensOut: number
  tokensCached?: number
}) {
  const usdCost = computeUsdCost(params.model, params)
  const rate = await getExchangeRate(params.userId)  // per-user snapshot
  const krwCost = Math.ceil(usdCost * rate)

  return await db.transaction(async (tx) => {
    const [bal] = await tx
      .update(creditBalances)
      .set({ balance_krw: sql`${creditBalances.balance_krw} - ${krwCost}` })
      .where(eq(creditBalances.user_id, params.userId))
      .returning()

    await tx.insert(creditLedger).values({
      user_id:                params.userId,
      kind:                   'usage',
      delta_krw:              -krwCost,
      balance_after_krw:      bal.balance_krw,
      request_id:             params.requestId,
      model:                  params.model,
      usage_tokens_in:        params.tokensIn,
      usage_tokens_out:       params.tokensOut,
      usage_tokens_cached:    params.tokensCached ?? 0,
      usage_usd_cost:         usdCost,
      exchange_rate_at_txn:   rate,
    })

    // post-check: 임계값 도달 시 알림 enqueue
    if (bal.balance_krw < bal.auto_recharge_threshold_krw) {
      await enqueueLowBalanceAlert(params.userId, bal)
    }
    return bal.balance_krw
  })
}
```

---

## 5. 결제 수단 (Payment Rails) — **v0.1 미확정**

2026-04-19 기준 두 옵션 검토 중:

| | Toss Payments | Lemon Squeezy |
|---|---------------|----------------|
| 결제 통화 | KRW only | USD (글로벌) |
| 과세 | VAT 수동 (우리 책임) | Merchant of Record (LS가 전 세계 세금 처리) |
| 빌링키 / 구독 | 빌링키 방식 (직접 청구 cron) | 기본 제공 (구독·업그레이드·프로레이트 자동) |
| PAYG 대응 | 카드 온타임 충전 + 빌링키 자동충전 가능 | API top-up 별도 구현 필요 |
| 한국 사용자 결제 경험 | ★★★★★ (카드·계좌·카카오페이·네이버페이 통합) | ★★★ (해외 카드 UX, 한국 카드 일부만 동작) |
| 수수료 | ~3.3% (국내 카드) | 5% + $0.50 per txn (MoR 프리미엄 포함) |
| 해외 유저 | × (KRW 고정) | ★★★★★ |
| 추천 시점 | **v0.1 (한국 중심)** | v0.2+ (해외 확장) |

**v0.1 계획**: Toss Payments 우선 채택 + billing-model 스키마는 `payment_provider` 필드로 멀티 레일 대응. v0.2에서 Lemon Squeezy 병행 추가.

**미확정 리스크**: 결제 쪽 진짜 확정 전까지 랜딩·문서에서는 `"국내 카드·간편결제 지원 · 해외 확장 예정"` 정도로 추상화.

---

## 6. 용량 매핑 (storage-planning 연계)

각 플랜이 실제로 어느 정도 자료를 수용 가능한지 — 상세는 [storage-planning.md](./storage-planning.md) Plan별 용량 매핑 참조.

| Plan | 스토리지 한도 | 가정 PDF 개수 (Gemini 3072d 기준) | 의미 |
|------|--------------|----------------------------------|------|
| Free | 100 MB | ~40 | 가벼운 개인 노트 (시험·요약 체험) |
| Pro | 10 GB | ~3,600 | Medium 유저(275MB, PDF 100개) 기준 **~36명분** 용량 |
| BYOK | 무제한 | 본인 인프라 고려, 공정 사용 정책 별도 | 1인 계정 관리형, AI 비용은 본인 Gemini 키 |

- "PDF 개수"는 평균 30페이지·청크당 9KB·1청크당 3072d 벡터 가정.
- Pro의 "36명" 계산은 "Pro 1 seat의 스토리지가 Medium 유저 36명을 담을 만큼 넉넉하다"는 여유도 표현. 실제 과금은 seat 단위.

---

## 7. 연관 문서

- [plan-9 billing-marketing](../superpowers/plans/2026-04-09-plan-9-billing-marketing.md) — 구현 플랜 (본 문서에 맞춰 후속 업데이트 필요)
- [security-model.md](./security-model.md) — BYOK 키 암호화, rate limit (Pro/BYOK 600 req/min)
- [agent-behavior-spec.md](../agents/agent-behavior-spec.md) — Deep Research 비용 guard, Free 티어 cost-heavy 에이전트 차단
- [backup-strategy.md](./backup-strategy.md) — 데이터 export, 계정 삭제 시 잔액 환불 플로우
