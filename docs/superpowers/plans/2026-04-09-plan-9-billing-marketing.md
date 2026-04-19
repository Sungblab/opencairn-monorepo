# Plan 9: Billing & Marketing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement subscription + PAYG billing (Free / BYOK / Pro / Self-host / Enterprise) with usage tracking middleware and plan enforcement, plus a Next.js SSG marketing site with a landing page, MDX blog, docs section, and pricing page.

**Architecture:** Billing logic lives entirely in `apps/api` (Hono route handlers + Drizzle). The web app renders a fully static marketing site built with Next.js SSG — no server components needed for public pages. MDX blog posts are read at build time. **결제 레일(payment rail)은 사업자등록 후 결정 — 현재 BLOCKED**. `payment_provider` 필드로 멀티 레일 추상화는 미리 설계. 빌링키 방식: 프론트에서 카드 등록 → 백엔드 빌링키 발급/저장 → 구독료 매월 cron 직접 청구 + **Pro PAYG 크레딧 차감 시스템 병행**. 웹훅은 provider별 전용 Hono route에서 처리. Usage는 `usage_records` + `credit_ledger` (append-only) 에 기록.

> **⚠️ 실행 순서 주의:** 본 plan의 Task 1~3 (DB 스키마 / plan enforcement / PAYG credit ledger)은 결제 레일 결정과 **무관**하므로 먼저 실행 가능. 결제 레일 의존 task (provider SDK 통합, 빌링키 발급, 웹훅, 결제 UI)는 사업자등록 완료 후 unblock. 순서: provider-agnostic core → 사업자등록 → provider integration.

**Tech Stack:** Payment provider SDK (TBD — 사업자등록 후 결정), Next.js 16 SSG, MDX (`@next/mdx`), Tailwind CSS 4, Drizzle ORM, TypeScript 5.x, Zod

> **⚠️ 가격 모델 전면 개편 (2026-04-19):** **현 모델 = Pro ₩4,900 + PAYG / BYOK ₩2,900 / Free / Self-host / Enterprise.** PAYG 크레딧: 최소 ₩5,000 충전, 만료 없음, $1 = ₩1,650 기준 차감. BYOK는 **OpenCairn 호스티드 1인 계정 임대**(Self-host와 다름 — 우리 서버에서 돌아감). 상세 스펙·환율 정책·잔액 소진 UX·DB 스키마: **[`docs/architecture/billing-model.md`](../../architecture/billing-model.md)**. 본 plan의 Task 3(Plan Enforcement)과 신규 Task 3.5(PAYG Credit System)에서 구현.
>
> *[Historical] 2026-04-19 이전 모델: Pro flat-fee ₩29,000/월 (대부분 사용자가 한도 미달로 불만 → PAYG 전환). 폐기됨.*

> **⚠️ BYOK 재정의 (2026-04-19):** BYOK = **관리형 솔로 tier** (OpenCairn 호스티드 1인 계정 · AI 키만 본인 거). Pro 팀 기능(워크스페이스·게스트·우선 큐·10GB·1년 로그) **포함 안 됨**. Self-host(AGPLv3, 본인 서버)와는 다름 — BYOK는 우리 인프라를 임대하는 관리형. "Pro 저가형"이 아니라 "1인 호스팅 + AI는 본인 키로 감당" 솔로 플랜. plan-9의 BYOK 언급은 이 정의 기준으로 재해석 필요.

> **⚠️ BYOK 정정 (2026-04-14):** BYOK는 OpenAI 전용이 아님. **BYOK Gemini가 추천 모드** — 사용자가 자신의 Gemini 키를 등록하면 모든 프리미엄 기능(Caching, Thinking, Search Grounding, TTS, 멀티모달 embedding) 그대로 보존. BYOK OpenAI는 graceful degrade 모드. 상세: `docs/superpowers/specs/2026-04-13-multi-llm-provider-design.md`

> **⚠️ 데이터 포터빌리티 추가 (2026-04-14):** 본 plan 범위에 다음 항목 포함 (구현 task는 후반에 추가 예정):
> - **계정 export API** (`GET /api/export/account`) — 비동기 Temporal 워크플로우로 ZIP 생성 (Markdown 위키 + JSON 그래프 + 원본 파일), 완료 시 Resend 이메일 알림
> - **선택적 export** — 프로젝트별/폴더별/태그별/날짜 범위
> - **자동 export (Pro/BYOK 전용)** — 주 1회 cron, 사용자 OAuth 연결한 Dropbox/Google Drive/본인 R2로 업로드
> - **GDPR 준수** — 설정 페이지 "내 데이터 다운로드" / "내 계정 삭제" 버튼
> - 상세: `docs/architecture/backup-strategy.md` §3 (사용자 데이터 포터빌리티)

---

## Plan Definitions

> 본 표는 billing-model.md §1과 동기화. 상세 entitlement·환율·PAYG 로직은 [billing-model.md](../../architecture/billing-model.md) 참조.

| Plan   | 월 구독료 | AI 비용 | 대상 | 핵심 entitlement |
|--------|-----------|---------|------|-----------------|
| **Free** | ₩0 | 우리 키 · 월 한도 내 무료 | 체험 | 프로젝트 10 · Q&A 50/월 · 오디오 3/월 · 스토리지 100MB · 12 에이전트 |
| **BYOK** | ₩2,900/월 | 본인 Gemini 키 (₩0 to us) | 관리형 솔로 | 우리 서버 1인 계정 임대 · **Pro 팀 기능 제외** · Self-host와 구분 |
| **Pro** | ₩4,900/월 + **PAYG** | 선불 크레딧 차감 · 최소 ₩5,000 충전 · 만료 없음 · $1=₩1,650 | 팀·연구실 | 워크스페이스 · 게스트 · 공개 링크 · 우선 큐 · 10GB · 1년 로그 · 이메일 지원 |
| Self-host | ₩0 | 본인 LLM | 개발자 | AGPLv3 전체 · 무제한 · Ollama 로컬 · 본인 운영 |
| Enterprise | 맞춤 견적 | 계약별 | 규제 산업 | 온프레미스 · SSO · 감사 로그 · 상용 라이선스 |

**모든 금액 VAT 별도.** 환율(`$1 = ₩1,650`)은 조정 가능 (30일 사전 고지).

---

## File Structure

```
apps/api/src/
  routes/
    billing.ts              -- Toss 빌링키 발급, 구독 관리, 웹훅 handler
  middleware/
    usage.ts                -- usage counting middleware (ingest, qa, audio)
    plan-guard.ts           -- plan enforcement middleware (check limits)
  lib/
    toss.ts                 -- Toss Payments REST 클라이언트 + helpers
    usage.ts                -- usage read/write helpers

apps/web/src/
  app/
    (marketing)/            -- route group: no app shell, pure static
      page.tsx              -- landing page (hero, features, how it works, pricing CTA)
      pricing/
        page.tsx            -- pricing page (plan comparison table + Toss Payments CTA)
      blog/
        page.tsx            -- blog index (MDX post list, SSG)
        [slug]/
          page.tsx          -- individual blog post (MDX, SSG)
      docs/
        page.tsx            -- docs index
        getting-started/
          page.tsx          -- getting started guide (MDX)
        self-hosting/
          page.tsx          -- self-hosting guide (MDX)
    layout.tsx              -- marketing layout (nav + footer, no auth)

  content/
    blog/
      2026-04-09-introducing-opencairn.mdx
      2026-04-09-how-spaced-repetition-works.mdx
    docs/
      getting-started.mdx
      self-hosting.mdx

  components/marketing/
    hero.tsx
    features-grid.tsx
    how-it-works.tsx
    pricing-table.tsx
    nav.tsx
    footer.tsx

packages/db/src/schema/
  subscriptions.ts          -- subscriptions table (userId, tossCustomerKey, tossBillingKey, plan, status)
  -- usage_records already exists from Plan 1
```

---

### Task 1: Toss Payments Integration (빌링키 발급, 정기결제, 웹훅)

> **토스 빌링 플로우:**
> 1. 프론트: `tossPayments.requestBillingAuth({ customerKey, successUrl, failUrl })` → 카드 등록 UI
> 2. 토스가 `successUrl?authKey=...&customerKey=...`으로 리다이렉트
> 3. 백엔드: `POST /v1/billing/authorizations/issue` → `billingKey` 발급 + DB 저장
> 4. 매월 cron: `POST /v1/billing/{billingKey}` 로 직접 청구
> 5. 토스 웹훅으로 결제 성공/실패 수신

**Files:**
- Create: `apps/api/src/lib/toss.ts`
- Create: `apps/api/src/routes/billing.ts`
- Create: `packages/db/src/schema/subscriptions.ts`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Install Toss Payments SDK (프론트)**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo
pnpm --filter @opencairn/web add @tosspayments/tosspayments-sdk
```

- [ ] **Step 2: Add `subscriptions` table**

```typescript
// packages/db/src/schema/subscriptions.ts
import { pgTable, uuid, text, timestamp, pgEnum } from 'drizzle-orm/pg-core'
import { users } from './users'

export const planEnum = pgEnum('plan_type', ['free', 'pro', 'byok'])
export const subStatusEnum = pgEnum('subscription_status', [
  'active', 'canceled', 'past_due'
])

export const subscriptions = pgTable('subscriptions', {
  id:                   uuid('id').defaultRandom().primaryKey(),
  userId:               text('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  tossCustomerKey:      text('toss_customer_key').unique(),  // 우리가 생성한 UUID, 토스에 전달
  tossBillingKey:       text('toss_billing_key').unique(),   // 토스가 발급한 빌링키
  plan:                 planEnum('plan').default('free').notNull(),
  status:               subStatusEnum('status').default('active').notNull(),
  currentPeriodEnd:     timestamp('current_period_end'),     // 다음 결제일
  byokGeminiKey:        text('byok_gemini_key'),             // AES-256-GCM 암호화 필수 (C-1)
  byokGeminiKeyIv:      text('byok_gemini_key_iv'),          // GCM nonce
  createdAt:            timestamp('created_at').defaultNow().notNull(),
  updatedAt:            timestamp('updated_at').defaultNow().notNull(),
})

export type Subscription    = typeof subscriptions.$inferSelect
export type NewSubscription = typeof subscriptions.$inferInsert
```

- [ ] **Step 3: Generate and run migration**

```bash
pnpm --filter @opencairn/db db:generate
pnpm --filter @opencairn/db db:migrate
```

- [ ] **Step 4: Create the Toss client helper**

```typescript
// apps/api/src/lib/toss.ts

if (!process.env.TOSS_SECRET_KEY) throw new Error('TOSS_SECRET_KEY is not set')

const TOSS_API = 'https://api.tosspayments.com/v1'
const authHeader = 'Basic ' + Buffer.from(process.env.TOSS_SECRET_KEY + ':').toString('base64')

// 빌링키 발급 (카드 등록 완료 후 호출)
export async function issueBillingKey(authKey: string, customerKey: string) {
  const res = await fetch(`${TOSS_API}/billing/authorizations/issue`, {
    method:  'POST',
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ authKey, customerKey }),
  })
  if (!res.ok) throw new Error(`Toss billingKey issue failed: ${await res.text()}`)
  return res.json() as Promise<{ billingKey: string; customerKey: string }>
}

// 정기결제 청구
export async function chargeBilling(billingKey: string, opts: {
  customerKey: string
  amount:      number
  orderId:     string
  orderName:   string
}) {
  const res = await fetch(`${TOSS_API}/billing/${billingKey}`, {
    method:  'POST',
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ ...opts, currency: 'KRW' }),
  })
  if (!res.ok) throw new Error(`Toss charge failed: ${await res.text()}`)
  return res.json()
}

export const PLAN_AMOUNTS = {
  pro:  29000,
  byok: 6900,
} as const

export const PLAN_LIMITS = {
  free: { ingests: 50,        qa: 100,       audio: 5          },
  pro:  { ingests: Infinity,  qa: Infinity,  audio: 60         },
  byok: { ingests: Infinity,  qa: Infinity,  audio: Infinity   },
} as const
```

- [ ] **Step 5: Create the billing routes**

```typescript
// apps/api/src/routes/billing.ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { issueBillingKey } from '../lib/toss'
import { db } from '../lib/db'
import { subscriptions } from '@opencairn/db/schema'
import { eq } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth'

export const billingRouter = new Hono()

// GET /billing/prepare — customerKey 발급 (프론트가 requestBillingAuth 호출 전에 먼저 요청)
billingRouter.get('/prepare', authMiddleware, async (c) => {
  const userId = c.get('userId') as string

  let [sub] = await db
    .select({ tossCustomerKey: subscriptions.tossCustomerKey })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))

  if (!sub?.tossCustomerKey) {
    const customerKey = randomUUID()
    await db
      .insert(subscriptions)
      .values({ userId, tossCustomerKey: customerKey, plan: 'free' })
      .onConflictDoUpdate({
        target: subscriptions.userId,
        set:    { tossCustomerKey: customerKey },
      })
    return c.json({ customerKey })
  }

  return c.json({ customerKey: sub.tossCustomerKey })
})

// POST /billing/issue — 카드 등록 완료 후 빌링키 발급 및 구독 활성화
billingRouter.post(
  '/issue',
  authMiddleware,
  zValidator('json', z.object({
    authKey:     z.string(),
    customerKey: z.string(),
    plan:        z.enum(['pro', 'byok']),
  })),
  async (c) => {
    const { authKey, customerKey, plan } = c.req.valid('json')
    const userId = c.get('userId') as string

    // customerKey가 이 userId 소유인지 검증
    const [sub] = await db
      .select({ tossCustomerKey: subscriptions.tossCustomerKey })
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))

    if (sub?.tossCustomerKey !== customerKey) {
      return c.json({ error: 'Invalid customerKey' }, 400)
    }

    const { billingKey } = await issueBillingKey(authKey, customerKey)

    const nextMonth = new Date()
    nextMonth.setMonth(nextMonth.getMonth() + 1)

    await db
      .update(subscriptions)
      .set({ tossBillingKey: billingKey, plan, status: 'active', currentPeriodEnd: nextMonth })
      .where(eq(subscriptions.userId, userId))

    return c.json({ success: true, plan })
  }
)

// DELETE /billing/subscription — 구독 취소 (다음 결제일 이후 free로 전환)
billingRouter.delete('/subscription', authMiddleware, async (c) => {
  const userId = c.get('userId') as string

  await db
    .update(subscriptions)
    .set({ status: 'canceled' })
    .where(eq(subscriptions.userId, userId))

  return c.json({ success: true })
})

// POST /billing/webhook — Toss 웹훅 (no auth middleware)
// 토스 웹훅은 서명 검증: X-Toss-Signature 헤더 (HMAC-SHA256)
billingRouter.post('/webhook', async (c) => {
  const sig     = c.req.header('x-toss-signature') ?? ''
  const rawBody = await c.req.text()

  // HMAC-SHA256 서명 검증
  const { createHmac } = await import('crypto')
  const expected = createHmac('sha256', process.env.TOSS_WEBHOOK_SECRET!)
    .update(rawBody)
    .digest('base64')

  if (sig !== expected) {
    return c.json({ error: 'Invalid signature' }, 400)
  }

  const event = JSON.parse(rawBody)

  // 토스 웹훅 이벤트: https://docs.tosspayments.com/reference/webhook
  if (event.eventType === 'PAYMENT_STATUS_CHANGED') {
    const { status, billingKey } = event.data ?? {}

    if (status === 'DONE') {
      // 결제 성공 → 다음 결제일 연장
      const nextMonth = new Date()
      nextMonth.setMonth(nextMonth.getMonth() + 1)
      await db
        .update(subscriptions)
        .set({ status: 'active', currentPeriodEnd: nextMonth })
        .where(eq(subscriptions.tossBillingKey, billingKey))
    } else if (status === 'ABORTED' || status === 'EXPIRED') {
      // 결제 실패 → past_due
      await db
        .update(subscriptions)
        .set({ status: 'past_due' })
        .where(eq(subscriptions.tossBillingKey, billingKey))
    }
  }

  return c.json({ received: true })
})

// GET /billing/subscription — 현재 플랜 조회
billingRouter.get('/subscription', authMiddleware, async (c) => {
  const userId = c.get('userId') as string
  const [sub]  = await db
    .select({
      plan:             subscriptions.plan,
      status:           subscriptions.status,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
    })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))

  return c.json(sub ?? { plan: 'free', status: 'active', currentPeriodEnd: null })
})
```

- [ ] **Step 6: Mount billing routes**

```typescript
// In apps/api/src/app.ts:
import { billingRouter } from './routes/billing'
app.route('/billing', billingRouter)
```

- [ ] **Step 7: 프론트엔드 카드 등록 플로우 (pricing page)**

```typescript
// apps/web/src/components/marketing/pricing-table.tsx (구독 버튼 onClick)
import { loadTossPayments } from '@tosspayments/tosspayments-sdk'

async function handleSubscribe(plan: 'pro' | 'byok') {
  // 1. 백엔드에서 customerKey 받기
  const { customerKey } = await fetch('/api/billing/prepare').then(r => r.json())

  // 2. 토스 빌링 인증창 호출
  const toss = await loadTossPayments(process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY!)
  await toss.requestBillingAuth({
    method:      'CARD',
    customerKey,
    successUrl:  `${window.location.origin}/billing/success?plan=${plan}`,
    failUrl:     `${window.location.origin}/billing/fail`,
  })
  // → 토스가 successUrl로 리다이렉트 (authKey, customerKey 쿼리파람 포함)
}
```

```typescript
// apps/web/src/app/(app)/billing/success/page.tsx
// 'use client' 필수 — CLAUDE.md: "No Server Actions, API calls only (TanStack Query)"
// 서버 컴포넌트에서 직접 fetch 금지
'use client'

import { useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { apiClient } from '@/lib/api-client'

export default function BillingSuccessPage() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const called       = useRef(false)

  useEffect(() => {
    if (called.current) return
    called.current = true

    const authKey     = searchParams.get('authKey')     ?? ''
    const customerKey = searchParams.get('customerKey') ?? ''
    const plan        = searchParams.get('plan') as 'pro' | 'byok' | null

    if (!authKey || !customerKey || !plan) {
      router.replace('/dashboard?billing=error')
      return
    }

    apiClient('/billing/issue', {
      method: 'POST',
      body:   JSON.stringify({ authKey, customerKey, plan }),
    })
      .then(() => router.replace('/dashboard?billing=success'))
      .catch(() => router.replace('/dashboard?billing=error'))
  }, [])

  return <p className="p-8 text-center text-gray-500">결제 처리 중...</p>
}
```

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/schema/subscriptions.ts \
        apps/api/src/lib/toss.ts \
        apps/api/src/routes/billing.ts \
        apps/api/src/app.ts \
        packages/db/drizzle/
git commit -m "feat(billing): Toss Payments 빌링키 기반 구독 (Pro/BYOK), 웹훅 처리"
```

---

### Task 2: Usage Tracking Middleware (count ingests, QA, audio per user per month)

**Files:**
- Create: `apps/api/src/lib/usage.ts`
- Create: `apps/api/src/middleware/usage.ts`
- Modify: `apps/api/src/routes/agents/` (apply middleware to relevant routes)

The `usage_records` table already exists from Plan 1 with columns: `userId`, `action` (enum), `month` (YYYY-MM), `count`.

- [ ] **Step 1: Create usage read/write helpers**

```typescript
// apps/api/src/lib/usage.ts
import { db } from './db'
import { usageRecords } from '@opencairn/db/schema'
import { eq, and, sql } from 'drizzle-orm'

export type UsageAction = 'ingest' | 'qa' | 'audio'

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export async function incrementUsage(userId: string, action: UsageAction): Promise<number> {
  const month = currentMonth()

  const [row] = await db
    .insert(usageRecords)
    .values({ userId, action, month, count: 1 })
    .onConflictDoUpdate({
      target: [usageRecords.userId, usageRecords.action, usageRecords.month],
      set:    { count: sql`${usageRecords.count} + 1` },
    })
    .returning({ count: usageRecords.count })

  return row.count
}

export async function getUsage(
  userId: string,
  action: UsageAction,
  month  = currentMonth()
): Promise<number> {
  const [row] = await db
    .select({ count: usageRecords.count })
    .from(usageRecords)
    .where(
      and(
        eq(usageRecords.userId, userId),
        eq(usageRecords.action, action),
        eq(usageRecords.month, month)
      )
    )

  return row?.count ?? 0
}
```

- [ ] **Step 2: Create the usage tracking middleware factory**

```typescript
// apps/api/src/middleware/usage.ts
import { createMiddleware } from 'hono/factory'
import { incrementUsage, type UsageAction } from '../lib/usage'

/**
 * Usage tracking middleware.
 * Call AFTER the route handler succeeds (use as an "after" hook via response interception).
 * Place before the handler so it can wrap it.
 */
export function trackUsage(action: UsageAction) {
  return createMiddleware(async (c, next) => {
    await next()
    // Only count successful responses
    if (c.res.status < 400) {
      const userId = c.get('userId') as string | undefined
      if (userId) {
        await incrementUsage(userId, action).catch(() => {
          // Usage tracking should never break the response
          console.error(`Failed to track usage: ${action} for user ${userId}`)
        })
      }
    }
  })
}
```

- [ ] **Step 3: Apply usage middleware to agent routes**

```typescript
// In apps/api/src/app.ts — update the agent route registrations:
import { trackUsage } from './middleware/usage'

// Ingest routes (from Plan 2/3):
app.use('/ingest/*', trackUsage('ingest'))

// QA routes (from Plan 4/5):
app.use('/agents/qa/*', trackUsage('qa'))

// Audio route:
app.use('/agents/narrator/*', trackUsage('audio'))
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/lib/usage.ts \
        apps/api/src/middleware/usage.ts \
        apps/api/src/app.ts
git commit -m "feat(billing): usage tracking middleware for ingest, QA, and audio actions"
```

---

### Task 3: Plan Enforcement (Free tier limits, Pro unlimited, BYOK API key management)

**Files:**
- Create: `apps/api/src/middleware/plan-guard.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Create plan enforcement middleware**

```typescript
// apps/api/src/middleware/plan-guard.ts
import { createMiddleware } from 'hono/factory'
import { db } from '../lib/db'
import { subscriptions } from '@opencairn/db/schema'
import { eq } from 'drizzle-orm'
import { getUsage, type UsageAction } from '../lib/usage'
import { PLAN_LIMITS } from '../lib/toss'

export function enforcePlanLimit(action: UsageAction) {
  return createMiddleware(async (c, next) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) return c.json({ error: 'Unauthorized' }, 401)

    // Fetch the user's current plan (default free)
    const [sub] = await db
      .select({ plan: subscriptions.plan, status: subscriptions.status })
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))

    const plan   = sub?.plan   ?? 'free'
    const status = sub?.status ?? 'active'

    // Treat past_due as free (degraded access)
    const effectivePlan = status === 'active' || status === 'trialing' ? plan : 'free'
    const limit         = PLAN_LIMITS[effectivePlan][action]

    if (limit === Infinity) {
      // Pro / BYOK — no limit, but attach plan to context for downstream use
      c.set('userPlan', effectivePlan)
      return next()
    }

    const currentUsage = await getUsage(userId, action)
    if (currentUsage >= limit) {
      return c.json(
        {
          error: `Monthly ${action} limit reached (${limit} on ${effectivePlan} plan). Upgrade to Pro for unlimited access.`,
          code:  'PLAN_LIMIT_EXCEEDED',
          limit,
          used:  currentUsage,
        },
        429
      )
    }

    c.set('userPlan', effectivePlan)
    await next()
  })
}
```

- [ ] **Step 2: Add BYOK crypto helper + key resolver**

```typescript
// apps/api/src/lib/byok-crypto.ts
// AES-256-GCM 암호화/복호화 — BYOK Gemini API 키 저장용
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGO = 'aes-256-gcm'

function getEncryptionKey(): Buffer {
  const raw = process.env.BYOK_ENCRYPTION_KEY
  if (!raw) throw new Error('BYOK_ENCRYPTION_KEY is not set')
  const buf = Buffer.from(raw, 'base64')
  if (buf.length !== 32) throw new Error('BYOK_ENCRYPTION_KEY must be 32 bytes (base64 encoded)')
  return buf
}

export function encryptByokKey(plaintext: string): { ciphertext: string; iv: string } {
  const iv     = randomBytes(12)                       // GCM 표준 96-bit nonce
  const cipher = createCipheriv(ALGO, getEncryptionKey(), iv)
  const enc    = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag    = cipher.getAuthTag()
  // ciphertext = enc + authTag (16 bytes) 를 base64로
  return {
    ciphertext: Buffer.concat([enc, tag]).toString('base64'),
    iv:         iv.toString('base64'),
  }
}

export function decryptByokKey(ciphertext: string, iv: string): string {
  const buf      = Buffer.from(ciphertext, 'base64')
  const ivBuf    = Buffer.from(iv, 'base64')
  const tag      = buf.subarray(buf.length - 16)
  const enc      = buf.subarray(0, buf.length - 16)
  const decipher = createDecipheriv(ALGO, getEncryptionKey(), ivBuf)
  decipher.setAuthTag(tag)
  return decipher.update(enc) + decipher.final('utf8')
}
```

BYOK users store their own Gemini API key in `subscriptions.byokGeminiKey` (AES-256-GCM 암호화). Agents should use the user's key when available.

```typescript
// apps/api/src/middleware/plan-guard.ts — append:
import { decryptByokKey } from '../lib/byok-crypto'

export function resolveGeminiKey() {
  return createMiddleware(async (c, next) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) return next()

    const [sub] = await db
      .select({
        plan:            subscriptions.plan,
        byokGeminiKey:   subscriptions.byokGeminiKey,
        byokGeminiKeyIv: subscriptions.byokGeminiKeyIv,
      })
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))

    let geminiKey = process.env.GEMINI_API_KEY!

    if (sub?.plan === 'byok' && sub.byokGeminiKey && sub.byokGeminiKeyIv) {
      // DB에서 복호화 후 사용
      geminiKey = decryptByokKey(sub.byokGeminiKey, sub.byokGeminiKeyIv)
    }

    c.set('geminiKey', geminiKey)
    await next()
  })
}
```

- [ ] **Step 3: Apply plan guard to all gated routes in app.ts**

```typescript
// In apps/api/src/app.ts:
import { enforcePlanLimit, resolveGeminiKey } from './middleware/plan-guard'

// Apply limit enforcement BEFORE the usage tracking middleware so over-limit
// requests never reach the handler and are never counted.
app.use('/ingest/*',          enforcePlanLimit('ingest'))
app.use('/agents/qa/*',       enforcePlanLimit('qa'))
app.use('/agents/narrator/*', enforcePlanLimit('audio'))

// Resolve Gemini API key for all agent routes
app.use('/agents/*', resolveGeminiKey())
```

- [ ] **Step 4: Add BYOK key management endpoint**

```typescript
// Append to apps/api/src/routes/billing.ts:
import { encryptByokKey } from '../lib/byok-crypto'

billingRouter.put(
  '/byok-key',
  authMiddleware,
  zValidator('json', z.object({ geminiKey: z.string().min(10) })),
  async (c) => {
    const { geminiKey } = c.req.valid('json')
    const userId = c.get('userId') as string

    const [sub] = await db
      .select({ plan: subscriptions.plan })
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))

    if (sub?.plan !== 'byok') {
      return c.json({ error: 'BYOK key management requires the BYOK plan' }, 403)
    }

    // AES-256-GCM 암호화 후 저장 (C-1 수정)
    const { ciphertext, iv } = encryptByokKey(geminiKey)
    await db
      .update(subscriptions)
      .set({ byokGeminiKey: ciphertext, byokGeminiKeyIv: iv })
      .where(eq(subscriptions.userId, userId))

    return c.json({ success: true })
  }
)
```

- [ ] **Step 5: BYOK usage 요금 집계 제외 (is_byok 플래그)**

usage_records는 BYOK 사용자도 **카운팅**은 하되 **요금 계산**에서는 제외해야 한다 (사용자가 이미 본인 Gemini 비용을 부담). 이는 향후 usage-based overage 요금을 Pro에만 적용할 때 필요.

```typescript
// packages/db/src/schema/usage-records.ts (수정 — 이미 Plan 1에 존재한다면 ALTER)
// 스키마에 is_byok 컬럼 추가:
//   isByok: boolean('is_byok').notNull().default(false)

// apps/api/src/middleware/usage.ts (수정)
export function trackUsage(action: UsageAction) {
  return createMiddleware(async (c, next) => {
    await next()
    if (c.res.status < 400) {
      const userId = c.get('userId') as string | undefined
      const plan = c.get('userPlan') as string | undefined
      if (userId) {
        await incrementUsage(userId, action, { isByok: plan === 'byok' }).catch(() => {
          console.error(`Failed to track usage: ${action} for user ${userId}`)
        })
      }
    }
  })
}

// apps/api/src/lib/usage.ts incrementUsage 시그니처 확장:
export async function incrementUsage(
  userId: string,
  action: UsageAction,
  opts: { isByok?: boolean } = {}
): Promise<number> {
  // ... is_byok 값 함께 upsert
}
```

**월간 청구서 집계 쿼리**: `SUM(count) FILTER (WHERE is_byok = false)`만 요금 대상. BYOK usage는 **대시보드**에는 표시되지만 **invoice**에서는 제외.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/middleware/plan-guard.ts \
        apps/api/src/middleware/usage.ts \
        apps/api/src/lib/usage.ts \
        apps/api/src/routes/billing.ts \
        apps/api/src/app.ts \
        packages/db/src/schema/usage-records.ts \
        drizzle/
git commit -m "feat(billing): plan enforcement + BYOK exclusion from paid usage aggregation"
```

---

### Task 3b: Refund / Dispute Policy

**Files:**
- Create: `apps/api/src/routes/billing-refund.ts`
- Create: `docs/legal/refund-policy.md` (사용자 대면 정책)
- Modify: `apps/api/src/routes/billing.ts` (웹훅에 환불 이벤트 처리 추가)

OpenCairn 구독 환불 정책 (한국 전자상거래법 + Toss 규약 기반):
- **결제 후 7일 이내 + 서비스를 실질적으로 사용하지 않은 경우**: 전액 환불
  - "실질적 사용"의 판정: 해당 기간 동안 `usage_records.count` 총합이 Free 티어 한도(`PLAN_LIMITS.free`) 이하
- **결제 후 7일 초과 or 실질 사용 발생**: 일할 계산 환불 (사용 일수 × (월 요금 / 30))
  - 예: ₩6,900 Pro 플랜 결제 10일 후 환불 요청 시 → `6900 - 6900 * 10/30 = ₩4,600` 환불
- **BYOK 사용자**: OpenCairn 자체는 요금을 받지 않지만 플랜 차액이 있다면 동일한 규칙 적용. 사용자의 Gemini 직접 결제는 환불 대상 아님(별도 Google 계정 문제)
- **서비스 장애로 인한 환불**: 다운타임 ≥ 24시간 연속 or 월 누계 99.5% SLA 미달성 시 해당 월 요금 100% 환불 청구 가능
- **챌린지/dispute(Toss)**: 자동으로 구독 `status='past_due'` 전환, 고객센터 대응 큐 진입

구현 스케치:

```typescript
// apps/api/src/routes/billing-refund.ts
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth";
import { db } from "../lib/db";
import { subscriptions, refunds } from "@opencairn/db/schema";

export const refundRouter = new Hono().use("*", authMiddleware);

// POST /billing/refund-request — 사용자 요청 접수
refundRouter.post(
  "/refund-request",
  zValidator("json", z.object({ reason: z.string().min(5).max(1000) })),
  async (c) => {
    const userId = c.get("userId") as string;
    const { reason } = c.req.valid("json");
    // ... 정책 평가 로직:
    //   1. 구독 조회 → plan, current_period_start, amount
    //   2. 7일 이내 & usage ≤ free limit → 전액
    //   3. 그 외 → 일할 계산
    //   4. refunds 테이블에 row insert (status='pending')
    //   5. admin 알림 (Plan 10 incident-response 참조)
    return c.json({ status: "pending" });
  }
);
```

테이블 추가:

```typescript
// packages/db/src/schema/refunds.ts
import { pgTable, uuid, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { users } from "./users";

export const refundStatus = pgEnum("refund_status", [
  "pending", "approved", "rejected", "processed",
]);

export const refunds = pgTable("refunds", {
  id:          uuid("id").defaultRandom().primaryKey(),
  userId:      text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  amountKrw:   integer("amount_krw").notNull(),
  reason:      text("reason").notNull(),
  status:      refundStatus("status").notNull().default("pending"),
  tossPaymentKey: text("toss_payment_key"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
});
```

Toss webhook 환불 이벤트 처리 추가:

```typescript
// billing.ts 웹훅 핸들러에 CASE 추가:
//   case 'PAYMENT_REFUNDED':
//     const refund = payload.data;
//     await db.update(refunds).set({ status: 'processed', processedAt: new Date() })
//       .where(eq(refunds.tossPaymentKey, refund.paymentKey));
//     await db.update(subscriptions).set({ status: 'canceled' })
//       .where(eq(subscriptions.userId, refund.userId));
//     break;
```

- [ ] **Step 1**: `refunds` 테이블 스키마 추가
- [ ] **Step 2**: `POST /billing/refund-request` 엔드포인트 구현
- [ ] **Step 3**: Toss webhook에 `PAYMENT_REFUNDED` 이벤트 처리
- [ ] **Step 4**: `docs/legal/refund-policy.md` 사용자 대면 문서 (한국어 + 영어). FTC 준수를 위한 투명한 조건 명시
- [ ] **Step 5**: 랜딩 페이지 Footer에 환불 정책 링크 추가
- [ ] **Step 6**: Commit

```bash
git add packages/db/src/schema/refunds.ts \
        apps/api/src/routes/billing-refund.ts \
        apps/api/src/routes/billing.ts \
        docs/legal/refund-policy.md \
        apps/web/src/components/marketing/footer.tsx \
        drizzle/
git commit -m "feat(billing): refund policy (7-day/prorated/SLA) + Toss PAYMENT_REFUNDED webhook + public legal doc"
```

---

### Task 4: Landing Page (hero, features, how it works, pricing CTA)

**Files:**
- Create: `apps/web/src/app/(marketing)/page.tsx`
- Create: `apps/web/src/app/(marketing)/layout.tsx`
- Create: `apps/web/src/components/marketing/hero.tsx`
- Create: `apps/web/src/components/marketing/features-grid.tsx`
- Create: `apps/web/src/components/marketing/how-it-works.tsx`
- Create: `apps/web/src/components/marketing/pricing-table.tsx`
- Create: `apps/web/src/components/marketing/nav.tsx`
- Create: `apps/web/src/components/marketing/footer.tsx`

- [ ] **Step 1: Create the marketing layout (no app shell)**

```tsx
// apps/web/src/app/(marketing)/layout.tsx
import type { ReactNode } from 'react'
import { Nav }    from '@/components/marketing/nav'
import { Footer } from '@/components/marketing/footer'

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white text-gray-900">
      <Nav />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  )
}
```

- [ ] **Step 2: Create Nav component**

```tsx
// apps/web/src/components/marketing/nav.tsx
import Link from 'next/link'

export function Nav() {
  return (
    <header className="border-b border-gray-100 px-6 py-4">
      <div className="mx-auto flex max-w-6xl items-center justify-between">
        <Link href="/" className="text-xl font-bold tracking-tight">
          OpenCairn
        </Link>
        <nav className="flex items-center gap-6 text-sm text-gray-600">
          <Link href="/docs"    className="hover:text-gray-900 transition-colors">Docs</Link>
          <Link href="/blog"    className="hover:text-gray-900 transition-colors">Blog</Link>
          <Link href="/pricing" className="hover:text-gray-900 transition-colors">Pricing</Link>
          <Link
            href="https://github.com/your-org/opencairn"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-gray-900 transition-colors"
          >
            GitHub
          </Link>
          <Link
            href="/login"
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors"
          >
            Sign in
          </Link>
        </nav>
      </div>
    </header>
  )
}
```

- [ ] **Step 3: Create Hero component**

```tsx
// apps/web/src/components/marketing/hero.tsx
import Link from 'next/link'

export function Hero() {
  return (
    <section className="mx-auto max-w-4xl px-6 py-24 text-center">
      <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-500">
        Open source · Self-hostable
      </div>
      <h1 className="text-5xl font-extrabold tracking-tight text-gray-900 sm:text-6xl">
        Your AI-powered
        <br />
        <span className="text-indigo-600">knowledge brain</span>
      </h1>
      <p className="mx-auto mt-6 max-w-2xl text-lg text-gray-600">
        OpenCairn connects your notes, surfaces forgotten knowledge, generates
        podcasts from your ideas, and researches topics autonomously — so you
        can think more and remember everything.
      </p>
      <div className="mt-10 flex justify-center gap-4">
        <Link
          href="/signup"
          className="rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow hover:bg-indigo-500 transition-colors"
        >
          Get started free
        </Link>
        <Link
          href="https://github.com/your-org/opencairn"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border border-gray-300 px-6 py-3 text-sm font-semibold text-gray-700 hover:border-gray-400 transition-colors"
        >
          View on GitHub
        </Link>
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Create FeaturesGrid component**

```tsx
// apps/web/src/components/marketing/features-grid.tsx
const FEATURES = [
  {
    title:       'Smart Ingestion',
    description: 'Paste URLs, PDFs, or plain text. OpenCairn extracts concepts, builds a knowledge graph, and embeds everything automatically.',
    icon:        '📥',
  },
  {
    title:       'Concept Graph',
    description: 'Auto-detected concepts link your notes across projects, revealing hidden connections you would never find manually.',
    icon:        '🕸️',
  },
  {
    title:       'Spaced Repetition',
    description: 'The Temporal Agent tracks how long since you last reviewed each note and surfaces stale knowledge before you forget it.',
    icon:        '🔁',
  },
  {
    title:       'Cross-Domain Synthesis',
    description: 'Discover structural analogies between ideas from completely different fields — the kind of insight that sparks breakthroughs.',
    icon:        '⚗️',
  },
  {
    title:       'Podcast Generation',
    description: 'Turn any note into a two-speaker podcast with Gemini MultiSpeaker TTS. Learn on the go without reading a word.',
    icon:        '🎙️',
  },
  {
    title:       'Deep Research',
    description: 'Submit a research question. The Deep Research Agent runs a long-horizon Gemini job and writes the report directly to your knowledge base.',
    icon:        '🔬',
  },
] as const

export function FeaturesGrid() {
  return (
    <section className="bg-gray-50 py-20">
      <div className="mx-auto max-w-6xl px-6">
        <h2 className="mb-12 text-center text-3xl font-bold tracking-tight text-gray-900">
          Everything your second brain needs
        </h2>
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="mb-3 text-3xl">{f.icon}</div>
              <h3 className="mb-2 font-semibold text-gray-900">{f.title}</h3>
              <p className="text-sm leading-relaxed text-gray-600">{f.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 5: Create HowItWorks component**

```tsx
// apps/web/src/components/marketing/how-it-works.tsx
const STEPS = [
  { number: '01', title: 'Add your notes',       description: 'Paste text, drop a URL, or upload a PDF. OpenCairn handles ingestion.' },
  { number: '02', title: 'AI builds your graph',  description: 'Concepts are extracted, embedded, and linked across all your projects.' },
  { number: '03', title: 'Agents do the work',    description: 'Curator finds sources. Narrator makes podcasts. Deep Research writes reports.' },
  { number: '04', title: 'Knowledge compounds',   description: 'Temporal Agent reminds you to review stale ideas before they fade.' },
] as const

export function HowItWorks() {
  return (
    <section className="py-20">
      <div className="mx-auto max-w-4xl px-6">
        <h2 className="mb-12 text-center text-3xl font-bold tracking-tight text-gray-900">
          How it works
        </h2>
        <div className="space-y-8">
          {STEPS.map((step) => (
            <div key={step.number} className="flex gap-6">
              <div className="flex-shrink-0 text-2xl font-black text-indigo-200">
                {step.number}
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">{step.title}</h3>
                <p className="mt-1 text-sm text-gray-600">{step.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 6: Create Footer component**

```tsx
// apps/web/src/components/marketing/footer.tsx
import Link from 'next/link'

export function Footer() {
  return (
    <footer className="border-t border-gray-100 px-6 py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-sm text-gray-500 sm:flex-row">
        <span>© {new Date().getFullYear()} OpenCairn. Open source under MIT.</span>
        <div className="flex gap-6">
          <Link href="/docs"    className="hover:text-gray-900 transition-colors">Docs</Link>
          <Link href="/blog"    className="hover:text-gray-900 transition-colors">Blog</Link>
          <Link href="/pricing" className="hover:text-gray-900 transition-colors">Pricing</Link>
          <Link
            href="https://github.com/your-org/opencairn"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-gray-900 transition-colors"
          >
            GitHub
          </Link>
        </div>
      </div>
    </footer>
  )
}
```

- [ ] **Step 7: Create the landing page**

```tsx
// apps/web/src/app/(marketing)/page.tsx
import { Hero }         from '@/components/marketing/hero'
import { FeaturesGrid } from '@/components/marketing/features-grid'
import { HowItWorks }   from '@/components/marketing/how-it-works'
import { PricingTable } from '@/components/marketing/pricing-table'

export default function LandingPage() {
  return (
    <>
      <Hero />
      <FeaturesGrid />
      <HowItWorks />
      <PricingTable />
    </>
  )
}
```

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/app/\(marketing\)/ \
        apps/web/src/components/marketing/
git commit -m "feat(marketing): landing page with hero, features, how-it-works, and pricing sections"
```

---

### Task 5: Pricing Page + PricingTable component

**Files:**
- Create: `apps/web/src/components/marketing/pricing-table.tsx`
- Create: `apps/web/src/app/(marketing)/pricing/page.tsx`

- [ ] **Step 1: Create PricingTable component**

```tsx
// apps/web/src/components/marketing/pricing-table.tsx
import Link from 'next/link'

const PLANS = [
  {
    name:        'Free',
    price:       '$0',
    period:      'forever',
    description: 'For personal exploration and getting started.',
    cta:         'Start for free',
    ctaHref:     '/signup',
    highlighted: false,
    features: [
      '50 ingests per month',
      '100 Q&A queries per month',
      '5 podcast generations per month',
      'Concept graph',
      'Spaced repetition reminders',
      'Community support',
    ],
  },
  {
    name:        'Pro',
    price:       '$19',
    period:      '/month',
    description: 'For power users who need unlimited AI-assisted research.',
    cta:         'Upgrade to Pro',
    ctaHref:     '/signup?plan=pro',
    highlighted: true,
    features: [
      'Unlimited ingests',
      'Unlimited Q&A queries',
      '60 podcast generations per month',
      'Deep Research Agent',
      'Synthesis & Curator Agents',
      'Priority support',
    ],
  },
  {
    name:        'BYOK',
    price:       '$5',
    period:      '/month',
    description: 'Bring your own Gemini API key for fully unlimited usage.',
    cta:         'Get BYOK',
    ctaHref:     '/signup?plan=byok',
    highlighted: false,
    features: [
      'Everything in Pro',
      'Unlimited podcast generations',
      'Use your own Gemini API key',
      'Pay only platform fee',
      'Full data portability',
      'Self-host ready',
    ],
  },
] as const

export function PricingTable() {
  return (
    <section id="pricing" className="bg-gray-50 py-20">
      <div className="mx-auto max-w-6xl px-6">
        <h2 className="mb-4 text-center text-3xl font-bold tracking-tight text-gray-900">
          Simple, transparent pricing
        </h2>
        <p className="mb-12 text-center text-gray-600">
          Start free. Upgrade when you need more. Self-host for free forever.
        </p>
        <div className="grid gap-8 sm:grid-cols-3">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={`flex flex-col rounded-2xl border p-8 shadow-sm ${
                plan.highlighted
                  ? 'border-indigo-500 bg-indigo-600 text-white shadow-indigo-100'
                  : 'border-gray-200 bg-white text-gray-900'
              }`}
            >
              <div className="mb-6">
                <h3 className="text-lg font-semibold">{plan.name}</h3>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-4xl font-extrabold">{plan.price}</span>
                  <span className={`text-sm ${plan.highlighted ? 'text-indigo-200' : 'text-gray-500'}`}>
                    {plan.period}
                  </span>
                </div>
                <p className={`mt-3 text-sm ${plan.highlighted ? 'text-indigo-100' : 'text-gray-500'}`}>
                  {plan.description}
                </p>
              </div>

              <ul className="mb-8 flex-1 space-y-3 text-sm">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <span className={plan.highlighted ? 'text-indigo-200' : 'text-indigo-500'}>✓</span>
                    {f}
                  </li>
                ))}
              </ul>

              <Link
                href={plan.ctaHref}
                className={`rounded-lg px-5 py-3 text-center text-sm font-semibold transition-colors ${
                  plan.highlighted
                    ? 'bg-white text-indigo-600 hover:bg-indigo-50'
                    : 'bg-indigo-600 text-white hover:bg-indigo-500'
                }`}
              >
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>

        <p className="mt-10 text-center text-sm text-gray-500">
          OpenCairn is open source. Self-host for free —{' '}
          <a
            href="https://github.com/your-org/opencairn"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline hover:text-gray-700"
          >
            view the repo
          </a>
          .
        </p>
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Create the standalone pricing page**

```tsx
// apps/web/src/app/(marketing)/pricing/page.tsx
import type { Metadata } from 'next'
import { PricingTable } from '@/components/marketing/pricing-table'

export const metadata: Metadata = {
  title:       'Pricing — OpenCairn',
  description: 'Free, Pro, and BYOK plans for your AI knowledge base.',
}

export default function PricingPage() {
  return (
    <div className="py-12">
      <PricingTable />
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/marketing/pricing-table.tsx \
        apps/web/src/app/\(marketing\)/pricing/
git commit -m "feat(marketing): pricing page with Free/Pro/BYOK plan comparison table"
```

---

### Task 6: Blog Setup (MDX + Next.js SSG)

**Files:**
- Modify: `apps/web/next.config.ts`
- Modify: `apps/web/package.json`
- Create: `apps/web/src/app/(marketing)/blog/page.tsx`
- Create: `apps/web/src/app/(marketing)/blog/[slug]/page.tsx`
- Create: `apps/web/src/lib/mdx.ts`
- Create: `apps/web/content/blog/2026-04-09-introducing-opencairn.mdx`
- Create: `apps/web/content/blog/2026-04-09-how-spaced-repetition-works.mdx`

- [ ] **Step 1: Install MDX dependencies**

```bash
pnpm --filter @opencairn/web add @next/mdx @mdx-js/loader @mdx-js/react gray-matter reading-time
pnpm --filter @opencairn/web add -D @types/mdx
```

- [ ] **Step 2: Configure Next.js for MDX**

```typescript
// apps/web/next.config.ts
import type { NextConfig } from 'next'
import createMDX from '@next/mdx'

const withMDX = createMDX({
  options: {
    remarkPlugins: [],
    rehypePlugins: [],
  },
})

const nextConfig: NextConfig = {
  pageExtensions: ['ts', 'tsx', 'mdx'],
  output: 'standalone',
}

export default withMDX(nextConfig)
```

- [ ] **Step 3: Create MDX file reader utility**

```typescript
// apps/web/src/lib/mdx.ts
import fs          from 'fs'
import path        from 'path'
import matter      from 'gray-matter'
import readingTime from 'reading-time'

const BLOG_DIR = path.join(process.cwd(), 'content/blog')

export interface PostMeta {
  slug:        string
  title:       string
  description: string
  date:        string
  readingTime: string
}

export interface Post extends PostMeta {
  content: string
}

export function getAllPosts(): PostMeta[] {
  const files = fs.readdirSync(BLOG_DIR).filter((f) => f.endsWith('.mdx'))

  return files
    .map((filename) => {
      const slug     = filename.replace(/\.mdx$/, '')
      const filepath = path.join(BLOG_DIR, filename)
      const raw      = fs.readFileSync(filepath, 'utf8')
      const { data } = matter(raw)

      return {
        slug,
        title:       data.title       as string,
        description: data.description as string,
        date:        data.date        as string,
        readingTime: readingTime(raw).text,
      }
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

export function getPost(slug: string): Post {
  const filepath   = path.join(BLOG_DIR, `${slug}.mdx`)
  const raw        = fs.readFileSync(filepath, 'utf8')
  const { data, content } = matter(raw)

  return {
    slug,
    title:       data.title       as string,
    description: data.description as string,
    date:        data.date        as string,
    readingTime: readingTime(raw).text,
    content,
  }
}
```

- [ ] **Step 4: Create blog index page (SSG)**

```tsx
// apps/web/src/app/(marketing)/blog/page.tsx
import type { Metadata }   from 'next'
import Link                from 'next/link'
import { getAllPosts }      from '@/lib/mdx'

export const metadata: Metadata = {
  title:       'Blog — OpenCairn',
  description: 'Articles on knowledge management, spaced repetition, and AI.',
}

export default function BlogIndex() {
  const posts = getAllPosts()

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="mb-10 text-3xl font-bold tracking-tight text-gray-900">Blog</h1>
      <ul className="space-y-10">
        {posts.map((post) => (
          <li key={post.slug}>
            <Link href={`/blog/${post.slug}`} className="group block">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                {new Date(post.date).toLocaleDateString('en-US', {
                  year: 'numeric', month: 'long', day: 'numeric'
                })}
                {' · '}
                {post.readingTime}
              </p>
              <h2 className="mt-2 text-xl font-semibold text-gray-900 group-hover:text-indigo-600 transition-colors">
                {post.title}
              </h2>
              <p className="mt-1 text-gray-600">{post.description}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 5: Create blog post page (SSG with generateStaticParams)**

```tsx
// apps/web/src/app/(marketing)/blog/[slug]/page.tsx
import type { Metadata }      from 'next'
import { notFound }           from 'next/navigation'
import { getAllPosts, getPost } from '@/lib/mdx'
import { compileMDX }         from 'next-mdx-remote/rsc'

export async function generateStaticParams() {
  return getAllPosts().map((p) => ({ slug: p.slug }))
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const { slug } = await params
  try {
    const post = getPost(slug)
    return { title: `${post.title} — OpenCairn Blog`, description: post.description }
  } catch {
    return { title: 'Post not found' }
  }
}

export default async function BlogPost(
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  let post
  try {
    post = getPost(slug)
  } catch {
    notFound()
  }

  const { content } = await compileMDX({ source: post.content })

  return (
    <article className="mx-auto max-w-2xl px-6 py-16">
      <header className="mb-10">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
          {new Date(post.date).toLocaleDateString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric'
          })}
          {' · '}
          {post.readingTime}
        </p>
        <h1 className="mt-3 text-4xl font-extrabold tracking-tight text-gray-900">
          {post.title}
        </h1>
        <p className="mt-3 text-lg text-gray-600">{post.description}</p>
      </header>
      <div className="prose prose-gray max-w-none">{content}</div>
    </article>
  )
}
```

- [ ] **Step 6: Create seed blog posts**

```mdx
---
title: "Introducing OpenCairn: Your AI-Powered Knowledge Brain"
description: "Why we built an open-source AI knowledge base and what makes it different."
date: "2026-04-09"
---

OpenCairn started with a simple frustration: we kept re-reading the same papers, re-discovering the same ideas, and forgetting insights we had spent hours learning.

## The problem with note-taking apps

Most note-taking tools are great at capture and terrible at retrieval. Your notes become a graveyard of well-intentioned ideas.

OpenCairn takes a different approach. Instead of just storing notes, it builds a living knowledge graph — connecting concepts across projects, detecting when knowledge has gone stale, and surfacing the right idea at the right time.

## What OpenCairn does differently

- **Concept extraction**: every note is automatically analyzed for key concepts
- **Cross-project linking**: the Connector Agent finds notes in other projects that are semantically related
- **Spaced repetition**: the Temporal Agent tracks staleness using Ebbinghaus curves and reminds you to review
- **Podcast generation**: any note can become a two-speaker podcast with Gemini TTS

We're open source, self-hostable, and free to get started. [Try it today](/signup).
```

Save as `apps/web/content/blog/2026-04-09-introducing-opencairn.mdx`.

```mdx
---
title: "How Spaced Repetition Makes Your Knowledge Stick"
description: "The science behind Ebbinghaus forgetting curves and how OpenCairn uses them to surface stale knowledge."
date: "2026-04-09"
---

Hermann Ebbinghaus discovered in 1885 that memory follows a predictable decay curve. Without reinforcement, we forget roughly 50% of new information within an hour, and 70% within 24 hours.

## The forgetting curve

The retention formula is: **R = e^(-t/S)** where:
- **R** is retention (0–1)
- **t** is time since last review (in days)
- **S** is the stability factor (how well-learned the material is)

## How OpenCairn's Temporal Agent uses this

Every time you edit a note, OpenCairn logs the change in `wiki_logs`. The Temporal Agent periodically scans these logs and computes a staleness score for each note using the forgetting curve.

Notes with a staleness score above 0.5 appear in your review queue — surfaced at exactly the right moment before they fade from memory.

The result: you spend less time re-learning and more time building on what you already know.
```

Save as `apps/web/content/blog/2026-04-09-how-spaced-repetition-works.mdx`.

- [ ] **Step 7: Install next-mdx-remote**

```bash
pnpm --filter @opencairn/web add next-mdx-remote
```

- [ ] **Step 8: Commit**

```bash
git add apps/web/next.config.ts \
        apps/web/src/lib/mdx.ts \
        apps/web/src/app/\(marketing\)/blog/ \
        apps/web/content/blog/
git commit -m "feat(marketing): MDX blog with SSG — blog index, post pages, and two seed posts"
```

---

### Task 7: Docs Section (getting started, self-hosting guide)

**Files:**
- Create: `apps/web/src/app/(marketing)/docs/page.tsx`
- Create: `apps/web/src/app/(marketing)/docs/getting-started/page.tsx`
- Create: `apps/web/src/app/(marketing)/docs/self-hosting/page.tsx`
- Create: `apps/web/src/lib/docs.ts`
- Create: `apps/web/content/docs/getting-started.mdx`
- Create: `apps/web/content/docs/self-hosting.mdx`

- [ ] **Step 1: Create docs file reader (mirrors mdx.ts for the docs directory)**

```typescript
// apps/web/src/lib/docs.ts
import fs          from 'fs'
import path        from 'path'
import matter      from 'gray-matter'

const DOCS_DIR = path.join(process.cwd(), 'content/docs')

export interface DocMeta {
  slug:        string
  title:       string
  description: string
  order:       number
}

export interface Doc extends DocMeta {
  content: string
}

export function getAllDocs(): DocMeta[] {
  const files = fs.readdirSync(DOCS_DIR).filter((f) => f.endsWith('.mdx'))

  return files
    .map((filename) => {
      const slug     = filename.replace(/\.mdx$/, '')
      const filepath = path.join(DOCS_DIR, filename)
      const raw      = fs.readFileSync(filepath, 'utf8')
      const { data } = matter(raw)

      return {
        slug,
        title:       data.title       as string,
        description: data.description as string,
        order:       (data.order as number) ?? 99,
      }
    })
    .sort((a, b) => a.order - b.order)
}

export function getDoc(slug: string): Doc {
  const filepath          = path.join(DOCS_DIR, `${slug}.mdx`)
  const raw               = fs.readFileSync(filepath, 'utf8')
  const { data, content } = matter(raw)

  return {
    slug,
    title:       data.title       as string,
    description: data.description as string,
    order:       (data.order as number) ?? 99,
    content,
  }
}
```

- [ ] **Step 2: Create docs index page**

```tsx
// apps/web/src/app/(marketing)/docs/page.tsx
import type { Metadata } from 'next'
import Link              from 'next/link'
import { getAllDocs }    from '@/lib/docs'

export const metadata: Metadata = {
  title:       'Documentation — OpenCairn',
  description: 'Guides for getting started and self-hosting OpenCairn.',
}

export default function DocsIndex() {
  const docs = getAllDocs()

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="mb-4 text-3xl font-bold tracking-tight text-gray-900">Documentation</h1>
      <p className="mb-10 text-gray-600">
        Everything you need to get started with OpenCairn or run it yourself.
      </p>
      <ul className="space-y-4">
        {docs.map((doc) => (
          <li key={doc.slug}>
            <Link
              href={`/docs/${doc.slug}`}
              className="group block rounded-lg border border-gray-200 p-5 hover:border-indigo-300 transition-colors"
            >
              <h2 className="font-semibold text-gray-900 group-hover:text-indigo-600 transition-colors">
                {doc.title}
              </h2>
              <p className="mt-1 text-sm text-gray-600">{doc.description}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 3: Create individual doc pages**

```tsx
// apps/web/src/app/(marketing)/docs/getting-started/page.tsx
import type { Metadata } from 'next'
import { notFound }      from 'next/navigation'
import { compileMDX }    from 'next-mdx-remote/rsc'
import { getDoc }        from '@/lib/docs'

export const metadata: Metadata = {
  title:       'Getting Started — OpenCairn Docs',
  description: 'Set up OpenCairn in minutes.',
}

export default async function GettingStartedPage() {
  let doc
  try { doc = getDoc('getting-started') } catch { notFound() }

  const { content } = await compileMDX({ source: doc.content })

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="mb-6 text-3xl font-bold tracking-tight text-gray-900">{doc.title}</h1>
      <div className="prose prose-gray max-w-none">{content}</div>
    </div>
  )
}
```

```tsx
// apps/web/src/app/(marketing)/docs/self-hosting/page.tsx
import type { Metadata } from 'next'
import { notFound }      from 'next/navigation'
import { compileMDX }    from 'next-mdx-remote/rsc'
import { getDoc }        from '@/lib/docs'

export const metadata: Metadata = {
  title:       'Self-Hosting — OpenCairn Docs',
  description: 'Run OpenCairn on your own infrastructure with Docker.',
}

export default async function SelfHostingPage() {
  let doc
  try { doc = getDoc('self-hosting') } catch { notFound() }

  const { content } = await compileMDX({ source: doc.content })

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="mb-6 text-3xl font-bold tracking-tight text-gray-900">{doc.title}</h1>
      <div className="prose prose-gray max-w-none">{content}</div>
    </div>
  )
}
```

- [ ] **Step 4: Create seed docs content**

```mdx
---
title: "Getting Started"
description: "Set up OpenCairn in minutes using the hosted version or Docker."
order: 1
---

## Prerequisites

- A free OpenCairn account ([sign up here](/signup))
- Or: Docker + Docker Compose for self-hosting

## Hosted setup (recommended)

1. **Create an account** at [opencairn.com/signup](/signup)
2. **Create your first project** from the dashboard
3. **Add a note** — paste text, drop a URL, or upload a PDF
4. Wait a few seconds for the AI agents to process it
5. View your auto-generated concept graph

## Your first AI action

Once a note is ingested, try:
- **Q&A**: click "Ask" on any note to ask questions against its content
- **Connector**: click "Find Links" to discover related notes in other projects
- **Narrator**: click "Make Podcast" to generate a two-speaker audio version

## API access

Every action is available via the REST API at `https://api.opencairn.com`. Get your API key from **Settings → API Keys**.

```bash
curl -X POST https://api.opencairn.com/ingest/url \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://example.com/article", "projectId": "YOUR_PROJECT_ID" }'
```
```

Save as `apps/web/content/docs/getting-started.mdx`.

```mdx
---
title: "Self-Hosting Guide"
description: "Run OpenCairn on your own infrastructure using Docker Compose."
order: 2
---

## Requirements

- Docker & Docker Compose v2
- A Gemini API key (for AI agents)
- At least 2 GB RAM

## Quick start

```bash
git clone https://github.com/your-org/opencairn.git
cd opencairn
cp .env.example .env
# Fill in required values in .env (see below)
docker compose up -d
```

The app will be available at `http://localhost:3000` and the API at `http://localhost:4000`.

## Required environment variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `GEMINI_API_KEY` | Your Google Gemini API key |
| `BETTER_AUTH_SECRET` | Random 32-char secret for session signing |

## Production deployment

For production, we recommend:
1. Setting `output: 'standalone'` in `next.config.ts` (already set)
2. Running behind a reverse proxy (nginx or Caddy) for TLS termination
3. Using a managed PostgreSQL instance (Supabase, Neon, or Railway)
4. Storing audio files in an S3-compatible bucket

See `docker-compose.prod.yml` in the repository for a production-ready Compose file.

## Updates

```bash
git pull
docker compose build
docker compose up -d
```

Always run `pnpm --filter @opencairn/db db:migrate` after pulling to apply any new migrations.
```

Save as `apps/web/content/docs/self-hosting.mdx`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/docs.ts \
        apps/web/src/app/\(marketing\)/docs/ \
        apps/web/content/docs/
git commit -m "feat(marketing): docs section with getting started and self-hosting guides (MDX + SSG)"
```

---

### Env Vars to Add

Add to `.env.example` and production secrets:

```
# Toss Payments
TOSS_SECRET_KEY=test_sk_...          # 라이브: live_sk_...
NEXT_PUBLIC_TOSS_CLIENT_KEY=test_ck_...  # 라이브: live_ck_...
TOSS_WEBHOOK_SECRET=...              # 토스 대시보드 → 웹훅 → 시크릿

# BYOK 키 암호화 (AES-256-GCM) — 32바이트 랜덤
BYOK_ENCRYPTION_KEY=base64_encoded_32_bytes
```

### Toss Webhook Setup

토스페이먼츠 대시보드 → 웹훅에서 엔드포인트 등록:
`https://api.your-domain.com/billing/webhook`

수신 이벤트:
- `PAYMENT_STATUS_CHANGED`

웹훅 시크릿은 대시보드에서 확인 후 `TOSS_WEBHOOK_SECRET`에 설정.

---

### Task 8: i18n (Internationalization)

**Files:**
- Create: `apps/web/src/i18n/request.ts`
- Create: `apps/web/src/i18n/routing.ts`
- Create: `apps/web/messages/en.json`
- Create: `apps/web/messages/ko.json`
- Modify: `apps/web/next.config.ts`
- Modify: `apps/web/src/app/layout.tsx`

- [ ] **Step 1: Install next-intl**

```bash
cd apps/web && pnpm add next-intl && cd ../..
```

- [ ] **Step 2: Create routing config**

Create `apps/web/src/i18n/routing.ts`:

```typescript
import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "ko"],
  defaultLocale: "en",
});
```

- [ ] **Step 3: Create request config**

Create `apps/web/src/i18n/request.ts`:

```typescript
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;
  if (!locale || !routing.locales.includes(locale as any)) {
    locale = routing.defaultLocale;
  }
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
```

- [ ] **Step 4: Create English messages**

Create `apps/web/messages/en.json`:

```json
{
  "common": {
    "appName": "OpenCairn",
    "tagline": "AI knowledge base for learning, research, and work.",
    "getStarted": "Get Started",
    "signIn": "Sign In",
    "signUp": "Sign Up",
    "dashboard": "Dashboard",
    "settings": "Settings",
    "pricing": "Pricing",
    "blog": "Blog",
    "docs": "Docs"
  },
  "landing": {
    "hero": {
      "title": "Your AI Knowledge Base",
      "subtitle": "Ingest anything. Auto-build a wiki. Ask questions.",
      "cta": "Get Started Free"
    },
    "howItWorks": {
      "title": "How It Works",
      "step1": "Upload documents — PDFs, audio, video, images, URLs",
      "step2": "AI compiles your knowledge into a linked wiki",
      "step3": "Ask questions, generate quizzes, create podcasts"
    },
    "features": {
      "title": "Features",
      "ingest": "Smart Ingest",
      "ingestDesc": "PDF, audio, video, image, YouTube, URL — AI parses everything",
      "wiki": "Auto Wiki",
      "wikiDesc": "11 AI agents build and maintain your knowledge base",
      "qa": "Graph RAG Q&A",
      "qaDesc": "Vector + BM25 + knowledge graph hybrid search",
      "graph": "Knowledge Graph",
      "graphDesc": "Interactive visualization of concept relationships",
      "learn": "Learning System",
      "learnDesc": "Flashcards, quizzes, spaced repetition, Socratic dialogue",
      "audio": "Audio Overview",
      "audioDesc": "NotebookLM-style podcast from your notes"
    },
    "openSource": {
      "title": "Open Source",
      "desc": "Self-host with Docker. AGPLv3 license.",
      "cta": "View on GitHub"
    }
  },
  "pricing": {
    "title": "Pricing",
    "free": "Free",
    "pro": "Pro",
    "byok": "BYOK",
    "byokFull": "Bring Your Own Key",
    "perMonth": "/month",
    "currentPlan": "Current Plan",
    "upgrade": "Upgrade",
    "unlimited": "Unlimited",
    "features": {
      "ingests": "Monthly ingests",
      "qa": "Monthly Q&A",
      "audio": "Audio generation",
      "storage": "Storage"
    }
  },
  "app": {
    "newProject": "New Project",
    "newNote": "New Note",
    "newFolder": "New Folder",
    "upload": "Upload",
    "search": "Search...",
    "chat": "Ask AI",
    "knowledgeGraph": "Knowledge Graph",
    "flashcards": "Flashcards",
    "noProjects": "No projects yet. Create one to get started.",
    "noNotes": "No notes in this project.",
    "editor": {
      "untitled": "Untitled",
      "saving": "Saving...",
      "saved": "Saved",
      "aiGenerated": "AI Generated"
    },
    "tools": {
      "quiz": "Quiz",
      "flashcard": "Flashcards",
      "mockExam": "Mock Exam",
      "slides": "Slides",
      "podcast": "Podcast",
      "deepResearch": "Deep Research",
      "mindmap": "Mind Map",
      "cheatsheet": "Cheat Sheet",
      "codeChallenge": "Code Challenge"
    },
    "jobs": {
      "title": "Background Jobs",
      "queued": "Queued",
      "running": "Running",
      "completed": "Completed",
      "failed": "Failed"
    }
  },
  "auth": {
    "email": "Email",
    "password": "Password",
    "confirmPassword": "Confirm Password",
    "forgotPassword": "Forgot password?",
    "noAccount": "Don't have an account?",
    "hasAccount": "Already have an account?"
  }
}
```

- [ ] **Step 5: Create Korean messages**

Create `apps/web/messages/ko.json`:

```json
{
  "common": {
    "appName": "OpenCairn",
    "tagline": "학습, 연구, 업무를 위한 AI 지식 베이스.",
    "getStarted": "시작하기",
    "signIn": "로그인",
    "signUp": "회원가입",
    "dashboard": "대시보드",
    "settings": "설정",
    "pricing": "가격",
    "blog": "블로그",
    "docs": "문서"
  },
  "landing": {
    "hero": {
      "title": "AI 지식 베이스",
      "subtitle": "자료를 넣으면 AI가 위키를 만들고, 질문에 답합니다.",
      "cta": "무료로 시작하기"
    },
    "howItWorks": {
      "title": "어떻게 작동하나요?",
      "step1": "문서를 업로드하세요 — PDF, 오디오, 영상, 이미지, URL",
      "step2": "AI가 지식을 연결된 위키로 컴파일합니다",
      "step3": "질문하고, 퀴즈를 만들고, 팟캐스트를 생성하세요"
    },
    "features": {
      "title": "기능",
      "ingest": "스마트 인제스트",
      "ingestDesc": "PDF, 오디오, 영상, 이미지, YouTube, URL — AI가 모든 것을 파싱",
      "wiki": "자동 위키",
      "wikiDesc": "11개 AI 에이전트가 지식 베이스를 구축하고 관리",
      "qa": "Graph RAG Q&A",
      "qaDesc": "벡터 + BM25 + 지식 그래프 하이브리드 검색",
      "graph": "지식 그래프",
      "graphDesc": "개념 관계의 인터랙티브 시각화",
      "learn": "학습 시스템",
      "learnDesc": "플래시카드, 퀴즈, 간격 반복, 소크라테스 대화",
      "audio": "오디오 오버뷰",
      "audioDesc": "노트를 NotebookLM 스타일 팟캐스트로 변환"
    },
    "openSource": {
      "title": "오픈소스",
      "desc": "Docker로 셀프호스팅. AGPLv3 라이선스.",
      "cta": "GitHub에서 보기"
    }
  },
  "pricing": {
    "title": "가격",
    "free": "무료",
    "pro": "프로",
    "byok": "BYOK",
    "byokFull": "나만의 API 키 사용",
    "perMonth": "/월",
    "currentPlan": "현재 플랜",
    "upgrade": "업그레이드",
    "unlimited": "무제한",
    "features": {
      "ingests": "월간 인제스트",
      "qa": "월간 Q&A",
      "audio": "오디오 생성",
      "storage": "스토리지"
    }
  },
  "app": {
    "newProject": "새 프로젝트",
    "newNote": "새 노트",
    "newFolder": "새 폴더",
    "upload": "업로드",
    "search": "검색...",
    "chat": "AI에게 질문",
    "knowledgeGraph": "지식 그래프",
    "flashcards": "플래시카드",
    "noProjects": "프로젝트가 없습니다. 하나 만들어보세요.",
    "noNotes": "이 프로젝트에 노트가 없습니다.",
    "editor": {
      "untitled": "제목 없음",
      "saving": "저장 중...",
      "saved": "저장됨",
      "aiGenerated": "AI 생성"
    },
    "tools": {
      "quiz": "퀴즈",
      "flashcard": "플래시카드",
      "mockExam": "모의시험",
      "slides": "슬라이드",
      "podcast": "팟캐스트",
      "deepResearch": "딥 리서치",
      "mindmap": "마인드맵",
      "cheatsheet": "치트시트",
      "codeChallenge": "코딩 과제"
    },
    "jobs": {
      "title": "백그라운드 작업",
      "queued": "대기 중",
      "running": "실행 중",
      "completed": "완료",
      "failed": "실패"
    }
  },
  "auth": {
    "email": "이메일",
    "password": "비밀번호",
    "confirmPassword": "비밀번호 확인",
    "forgotPassword": "비밀번호를 잊으셨나요?",
    "noAccount": "계정이 없으신가요?",
    "hasAccount": "이미 계정이 있으신가요?"
  }
}
```

- [ ] **Step 6: Update Next.js config**

Add to `apps/web/next.config.ts`:

```typescript
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
};

export default withNextIntl(nextConfig);
```

- [ ] **Step 7: Update root layout to use NextIntlClientProvider**

Wrap layout with locale provider. Use `useTranslations('common')` hook in components.

- [ ] **Step 8: Commit**

```bash
git add apps/web/
git commit -m "feat(web): add i18n with next-intl (en + ko)"
```

---

## Task E1: Account Export API (GDPR + 데이터 포터빌리티)

> **Added 2026-04-14** — 사용자가 자신의 전체 데이터를 Markdown + JSON + 원본 파일로 ZIP export. Obsidian 호환 폴더 구조. 비동기 Temporal 워크플로우. 상세: `docs/architecture/backup-strategy.md` §3

**Files:**
- Create: `apps/api/src/routes/export.ts`
- Create: `apps/worker/src/worker/activities/export_activity.py`
- Create: `apps/worker/src/worker/workflows/export_workflow.py`
- Modify: `apps/worker/src/worker/main.py` (register)
- Modify: `packages/db/src/schema.ts` (`export_jobs` 테이블 추가)
- Modify: `apps/web/src/app/(app)/settings/page.tsx` (export 버튼)

### E1.1 DB 스키마

- [ ] **Step 1:** `packages/db/src/schema.ts`에 `export_jobs` 테이블 추가:
  - `id` UUID PK
  - `user_id` UUID FK
  - `scope` ENUM (`account`, `project`, `folder`, `tag`)
  - `scope_id` UUID nullable
  - `status` ENUM (`pending`, `running`, `completed`, `failed`)
  - `zip_key` TEXT nullable (R2 object key)
  - `download_url` TEXT nullable (signed URL, 7일 유효)
  - `error` TEXT nullable
  - `created_at`, `completed_at` TIMESTAMP
- [ ] **Step 2:** `pnpm db:generate && pnpm db:migrate`

### E1.2 Temporal Export Workflow

- [ ] **Step 3:** `apps/worker/src/worker/activities/export_activity.py` 생성:
  - `export_user_data(user_id, scope, scope_id) -> r2_key`
  - 로직:
    1. DB에서 사용자의 wiki_pages/notes/conversations/concepts/concept_edges 쿼리 (scope 필터 적용)
    2. 임시 디렉토리에 폴더 구조 생성:
       ```
       opencairn_export_<user_id>_<timestamp>/
         README.md               (export 메타, 포맷 설명)
         metadata.json           (user info, 생성 시각, 스코프)
         wiki/                   (Markdown 파일들, 폴더 구조 반영)
           project_a/
             concept_1.md
             concept_2.md
         notes/
         sources/                (원본 PDF/DOCX 등, R2에서 다운로드)
         graph.json              (concepts + concept_edges)
         wiki_logs.json          (변경 이력)
         conversations.json      (대화 히스토리)
       ```
    3. `zipfile.ZipFile`로 압축
    4. 압축된 ZIP을 R2에 업로드 (`exports/<user_id>/<job_id>.zip`)
    5. 반환: R2 object key
- [ ] **Step 4:** `apps/worker/src/worker/workflows/export_workflow.py`:
  - `ExportWorkflow` 정의
  - activity 호출 (`start_to_close_timeout=30min`, retry_policy 3회)
  - 완료 후 DB의 `export_jobs` row 업데이트 (signed URL 7일 생성)
  - Resend로 완료 이메일 발송 (`provider.send_email()` 또는 직접)
- [ ] **Step 5:** `main.py`에 activity와 workflow 등록.

### E1.3 API Route

- [ ] **Step 6:** `apps/api/src/routes/export.ts`:
  - `POST /api/export/account` — 계정 전체 export 시작, `export_jobs` row 생성, Temporal workflow 트리거, `{ job_id }` 응답
  - `POST /api/export/project/:id` — 특정 프로젝트만
  - `GET /api/export/jobs` — 사용자의 export 작업 히스토리
  - `GET /api/export/jobs/:id` — 단일 작업 상태 + download URL (완료 시)
  - 비율 제한: 사용자당 동시 1개만, 하루 최대 5회
- [ ] **Step 7:** `app.ts`에 라우트 마운트, `requireAuth` 미들웨어.

### E1.4 설정 페이지 UI

- [ ] **Step 8:** `apps/web/src/app/(app)/settings/page.tsx`에 "데이터 & 프라이버시" 섹션 추가:
  - "내 데이터 다운로드" 버튼 → POST /api/export/account 호출
  - 작업 목록 (완료된 export, 다운로드 링크, 만료 시각)
  - "내 계정 삭제" 버튼 (확인 모달, 30일 soft delete 후 hard delete)
- [ ] **Step 9:** 작업 진행 상태 실시간 표시 (폴링 또는 Hocuspocus broadcast).

### E1.5 자동 Export (Pro/BYOK 전용)

- [ ] **Step 10:** `user_preferences`에 `auto_export_enabled` boolean, `auto_export_target` (dropbox/gdrive/r2), `auto_export_oauth_token` encrypted 컬럼 추가.
- [ ] **Step 11:** Temporal cron schedule (`@workflow.defn` + `Schedule`)로 주 1회 자동 실행, 사용자 OAuth 연결 대상에 업로드.
- [ ] **Step 12:** 설정 페이지에 OAuth 연결 UI + 토글.

### E1.6 Commit

- [ ] **Step 13:**
```bash
git add apps/api/src/routes/export.ts \
        apps/worker/src/worker/activities/export_activity.py \
        apps/worker/src/worker/workflows/export_workflow.py \
        packages/db/src/schema.ts \
        apps/web/src/app/\(app\)/settings/page.tsx
git commit -m "feat(billing): add account export API with Markdown + JSON + sources"
```

---

## Task A1: Admin Panel (SaaS 운영자용)

> **대상:** OpenCairn을 직접 호스팅해서 서비스하는 운영자 전용. 셀프호스팅 사용자에게는 노출 불필요.
> **접근:** DB `users.role = 'admin'` 컬럼 기반. 초기 admin 지정은 DB 직접 업데이트 또는 `ADMIN_USER_IDS` env 시드.

**Files:**
- Modify: `packages/db/src/schema/users.ts` — `role` 컬럼 추가
- Create: `apps/api/src/middleware/admin.ts`
- Create: `apps/api/src/routes/admin.ts`
- Create: `apps/web/src/app/(admin)/layout.tsx`
- Create: `apps/web/src/app/(admin)/admin/page.tsx` — 개요 대시보드
- Create: `apps/web/src/app/(admin)/admin/users/page.tsx` — 유저 목록
- Create: `apps/web/src/app/(admin)/admin/users/[id]/page.tsx` — 유저 상세
- Create: `apps/web/src/app/(admin)/admin/subscriptions/page.tsx` — 구독 현황
- Create: `apps/web/src/app/(admin)/admin/usage/page.tsx` — 사용량 통계
- Create: `apps/web/src/app/(admin)/admin/jobs/page.tsx` — 백그라운드 작업
- Modify: `apps/api/src/app.ts` — admin 라우트 마운트

---

### A1.1 DB 스키마 (role 컬럼)

- [ ] **Step 1:** `packages/db/src/schema/users.ts`에 role 추가

```typescript
// packages/db/src/schema/users.ts 에 컬럼 추가
export const userRoleEnum = pgEnum('user_role', ['user', 'admin'])

// users 테이블 정의 안에:
role: userRoleEnum('role').default('user').notNull(),
```

- [ ] **Step 2:** migration 생성 + 실행

```bash
pnpm db:generate && pnpm db:migrate
```

초기 어드민 지정:
```sql
UPDATE users SET role = 'admin' WHERE email = 'your@email.com';
```

---

### A1.2 Admin Middleware

- [ ] **Step 3:** `apps/api/src/middleware/admin.ts`

```typescript
// apps/api/src/middleware/admin.ts
import { createMiddleware } from 'hono/factory'
import { db } from '../lib/db'
import { users } from '@opencairn/db/schema'
import { eq } from 'drizzle-orm'

export const adminMiddleware = createMiddleware(async (c, next) => {
  const user = c.get('user')  // Better Auth가 세팅한 세션 유저
  if (!user) return c.json({ error: 'Unauthorized' }, 401)

  const [u] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, user.id))

  if (u?.role !== 'admin') {
    return c.json({ error: 'Forbidden' }, 403)
  }

  await next()
})
```

---

### A1.3 Admin API Routes

- [ ] **Step 4:** `apps/api/src/routes/admin.ts`

```typescript
// apps/api/src/routes/admin.ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../lib/db'
import { users, subscriptions, usageRecords, jobs } from '@opencairn/db/schema'
import { eq, desc, sql, and, gte, count } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth'
import { adminMiddleware } from '../middleware/admin'

export const adminRouter = new Hono()

// 모든 admin 라우트에 인증 + admin 권한 체크
adminRouter.use('*', authMiddleware, adminMiddleware)

// ── 개요 (Overview) ──────────────────────────────────────

// GET /admin/stats — 대시보드 핵심 지표
adminRouter.get('/stats', async (c) => {
  const now = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  const [
    totalUsers,
    newUsersThisMonth,
    planCounts,
    totalUsageThisMonth,
  ] = await Promise.all([
    // 전체 유저 수
    db.select({ count: count() }).from(users),

    // 이번달 신규 유저
    db.select({ count: count() })
      .from(users)
      .where(gte(users.createdAt, thirtyDaysAgo)),

    // 플랜별 유저 수
    db.select({ plan: subscriptions.plan, count: count() })
      .from(subscriptions)
      .groupBy(subscriptions.plan),

    // 이번달 전체 사용량
    db.select({ action: usageRecords.action, total: sql<number>`sum(${usageRecords.count})` })
      .from(usageRecords)
      .where(eq(usageRecords.month, `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`))
      .groupBy(usageRecords.action),
  ])

  return c.json({
    totalUsers:          totalUsers[0].count,
    newUsersThisMonth:   newUsersThisMonth[0].count,
    planCounts:          Object.fromEntries(planCounts.map(r => [r.plan, r.count])),
    usageThisMonth:      Object.fromEntries(totalUsageThisMonth.map(r => [r.action, r.total])),
  })
})

// ── 유저 관리 ────────────────────────────────────────────

// GET /admin/users?page=1&q=keyword
adminRouter.get('/users', zValidator('query', z.object({
  page: z.coerce.number().default(1),
  q:    z.string().optional(),
})), async (c) => {
  const { page, q } = c.req.valid('query')
  const PAGE_SIZE = 50

  const rows = await db
    .select({
      id:        users.id,
      email:     users.email,
      name:      users.name,
      role:      users.role,
      createdAt: users.createdAt,
      plan:      subscriptions.plan,
      status:    subscriptions.status,
    })
    .from(users)
    .leftJoin(subscriptions, eq(subscriptions.userId, users.id))
    .where(q ? sql`${users.email} ILIKE ${'%' + q + '%'} OR ${users.name} ILIKE ${'%' + q + '%'}` : undefined)
    .orderBy(desc(users.createdAt))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE)

  return c.json({ users: rows, page, pageSize: PAGE_SIZE })
})

// GET /admin/users/:id — 유저 상세 (플랜 + 사용량 + 최근 작업)
adminRouter.get('/users/:id', async (c) => {
  const id = c.req.param('id')

  const [user] = await db
    .select({
      id:        users.id,
      email:     users.email,
      name:      users.name,
      role:      users.role,
      createdAt: users.createdAt,
      plan:             subscriptions.plan,
      status:           subscriptions.status,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      tossBillingKey:   subscriptions.tossBillingKey,
    })
    .from(users)
    .leftJoin(subscriptions, eq(subscriptions.userId, users.id))
    .where(eq(users.id, id))

  if (!user) return c.json({ error: 'User not found' }, 404)

  // 월별 사용량 (최근 3개월)
  const usage = await db
    .select({ action: usageRecords.action, month: usageRecords.month, count: usageRecords.count })
    .from(usageRecords)
    .where(eq(usageRecords.userId, id))
    .orderBy(desc(usageRecords.month))
    .limit(30)

  // 최근 작업 5개
  const recentJobs = await db
    .select({ id: jobs.id, type: jobs.type, status: jobs.status, createdAt: jobs.createdAt })
    .from(jobs)
    .where(eq(jobs.userId, id))
    .orderBy(desc(jobs.createdAt))
    .limit(5)

  return c.json({ ...user, usage, recentJobs })
})

// PATCH /admin/users/:id — 플랜 강제 변경, 역할 변경, 계정 정지
adminRouter.patch(
  '/users/:id',
  zValidator('json', z.object({
    plan:   z.enum(['free', 'pro', 'byok']).optional(),
    role:   z.enum(['user', 'admin']).optional(),
    status: z.enum(['active', 'canceled', 'past_due']).optional(),
  })),
  async (c) => {
    const id      = c.req.param('id')
    const updates = c.req.valid('json')

    if (updates.role !== undefined) {
      await db.update(users).set({ role: updates.role }).where(eq(users.id, id))
    }

    if (updates.plan !== undefined || updates.status !== undefined) {
      await db.update(subscriptions)
        .set({
          ...(updates.plan   !== undefined && { plan:   updates.plan   }),
          ...(updates.status !== undefined && { status: updates.status }),
        })
        .where(eq(subscriptions.userId, id))
    }

    return c.json({ success: true })
  }
)

// DELETE /admin/users/:id — 계정 즉시 삭제 (cascade)
adminRouter.delete('/users/:id', async (c) => {
  const id = c.req.param('id')
  await db.delete(users).where(eq(users.id, id))
  return c.json({ success: true })
})

// ── 구독 관리 ────────────────────────────────────────────

// GET /admin/subscriptions?status=past_due
adminRouter.get('/subscriptions', zValidator('query', z.object({
  status: z.enum(['active', 'canceled', 'past_due']).optional(),
  plan:   z.enum(['free', 'pro', 'byok']).optional(),
  page:   z.coerce.number().default(1),
})), async (c) => {
  const { status, plan, page } = c.req.valid('query')
  const PAGE_SIZE = 50

  const rows = await db
    .select({
      userId:           subscriptions.userId,
      email:            users.email,
      name:             users.name,
      plan:             subscriptions.plan,
      status:           subscriptions.status,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      updatedAt:        subscriptions.updatedAt,
    })
    .from(subscriptions)
    .innerJoin(users, eq(users.id, subscriptions.userId))
    .where(and(
      status ? eq(subscriptions.status, status) : undefined,
      plan   ? eq(subscriptions.plan,   plan)   : undefined,
    ))
    .orderBy(desc(subscriptions.updatedAt))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE)

  return c.json({ subscriptions: rows, page, pageSize: PAGE_SIZE })
})

// ── 사용량 통계 ──────────────────────────────────────────

// GET /admin/usage?month=2026-04
adminRouter.get('/usage', zValidator('query', z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
})), async (c) => {
  const now = new Date()
  const month = c.req.valid('query').month
    ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  // 액션별 합계
  const totals = await db
    .select({ action: usageRecords.action, total: sql<number>`sum(${usageRecords.count})` })
    .from(usageRecords)
    .where(eq(usageRecords.month, month))
    .groupBy(usageRecords.action)

  // 상위 20명 heavy user
  const topUsers = await db
    .select({
      userId: usageRecords.userId,
      email:  users.email,
      total:  sql<number>`sum(${usageRecords.count})`,
    })
    .from(usageRecords)
    .innerJoin(users, eq(users.id, usageRecords.userId))
    .where(eq(usageRecords.month, month))
    .groupBy(usageRecords.userId, users.email)
    .orderBy(desc(sql`sum(${usageRecords.count})`))
    .limit(20)

  return c.json({ month, totals, topUsers })
})

// ── 백그라운드 작업 ──────────────────────────────────────

// GET /admin/jobs?status=failed&page=1
adminRouter.get('/jobs', zValidator('query', z.object({
  status: z.enum(['queued', 'running', 'completed', 'failed']).optional(),
  page:   z.coerce.number().default(1),
})), async (c) => {
  const { status, page } = c.req.valid('query')
  const PAGE_SIZE = 50

  const rows = await db
    .select({
      id:        jobs.id,
      type:      jobs.type,
      status:    jobs.status,
      userId:    jobs.userId,
      email:     users.email,
      createdAt: jobs.createdAt,
      error:     jobs.error,
    })
    .from(jobs)
    .innerJoin(users, eq(users.id, jobs.userId))
    .where(status ? eq(jobs.status, status) : undefined)
    .orderBy(desc(jobs.createdAt))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE)

  return c.json({ jobs: rows, page, pageSize: PAGE_SIZE })
})
```

- [ ] **Step 5:** `apps/api/src/app.ts`에 라우트 마운트

```typescript
import { adminRouter } from './routes/admin'

// admin 라우트 선제 인증 — adminRouter 내부 미들웨어 우회 방지 (H-2 수정)
app.use('/admin/*', authMiddleware)
app.route('/admin', adminRouter)
```

---

### A1.4 Admin UI (Next.js)

- [ ] **Step 6:** `apps/web/src/app/(admin)/layout.tsx` — 어드민 레이아웃 (role 체크 + 사이드바)

```tsx
// apps/web/src/app/(admin)/layout.tsx
import { redirect } from 'next/navigation'
import { headers }  from 'next/headers'
import { auth }     from '@/lib/auth'  // 서버사이드 auth 인스턴스 (api-client 아님)

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // 서버사이드 세션 체크 — Next.js 16 headers() API 사용
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user || (session.user as any).role !== 'admin') redirect('/dashboard')

  return (
    <div className="flex h-screen">
      <aside className="w-56 shrink-0 border-r border-gray-200 bg-gray-50 p-4">
        <p className="mb-6 text-xs font-semibold uppercase tracking-widest text-gray-400">Admin</p>
        <nav className="space-y-1 text-sm">
          {[
            { href: '/admin',               label: '개요'         },
            { href: '/admin/users',         label: '유저 관리'    },
            { href: '/admin/subscriptions', label: '구독 현황'    },
            { href: '/admin/usage',         label: '사용량 통계'  },
            { href: '/admin/jobs',          label: '백그라운드 작업' },
          ].map(({ href, label }) => (
            <a key={href} href={href}
              className="block rounded-md px-3 py-2 text-gray-700 hover:bg-gray-100 hover:text-gray-900"
            >
              {label}
            </a>
          ))}
        </nav>
      </aside>
      <main className="flex-1 overflow-auto p-8">{children}</main>
    </div>
  )
}
```

- [ ] **Step 7:** `apps/web/src/app/(admin)/admin/page.tsx` — 개요 대시보드

  - `/admin/stats` 호출 → 전체 유저 수, 이번달 신규 유저, 플랜별 분포, 액션별 사용량 카드 표시

- [ ] **Step 8:** `apps/web/src/app/(admin)/admin/users/page.tsx` — 유저 목록

  - 검색 입력 (`?q=`), 페이지네이션
  - 테이블: 이메일 / 이름 / 플랜 / 상태 / 가입일 / 액션 버튼 (상세 보기)

- [ ] **Step 9:** `apps/web/src/app/(admin)/admin/users/[id]/page.tsx` — 유저 상세

  - 유저 정보 헤더 (이메일, 가입일, 플랜)
  - 플랜 강제 변경 드롭다운 (`PATCH /admin/users/:id`)
  - 계정 정지 / 어드민 권한 부여 / 계정 삭제 버튼 (확인 모달)
  - 월별 사용량 차트 (최근 3개월)
  - 최근 작업 목록

- [ ] **Step 10:** `apps/web/src/app/(admin)/admin/subscriptions/page.tsx` — 구독 현황

  - 필터: 전체 / 활성 / 결제 실패(`past_due`) / 취소
  - 테이블: 이메일 / 플랜 / 상태 / 다음 결제일
  - `past_due` 행은 빨간색 강조

- [ ] **Step 11:** `apps/web/src/app/(admin)/admin/usage/page.tsx` — 사용량 통계

  - 월 선택기
  - 액션별 총계 카드 (ingest / QA / audio)
  - Heavy user top 20 테이블

- [ ] **Step 12:** `apps/web/src/app/(admin)/admin/jobs/page.tsx` — 백그라운드 작업

  - 필터: 전체 / 실행중 / 실패
  - 테이블: 작업 타입 / 유저 / 상태 / 생성일 / 에러 메시지

---

### A1.5 Env Vars

```
# Admin 시드 (최초 admin 계정 지정용, 이후 DB role 컬럼으로 관리)
ADMIN_SEED_EMAIL=your@email.com
```

### A1.6 Commit

- [ ] **Step 13:**

```bash
git add packages/db/src/schema/users.ts \
        apps/api/src/middleware/admin.ts \
        apps/api/src/routes/admin.ts \
        apps/api/src/app.ts \
        apps/web/src/app/\(admin\)/ \
        packages/db/drizzle/
git commit -m "feat(billing): SaaS admin panel — user mgmt, subscriptions, usage stats, job monitoring"
```
