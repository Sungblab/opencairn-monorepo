# Plan 9: Billing & Marketing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Stripe-based subscription billing (Free / Pro / BYOK tiers) with usage tracking middleware and plan enforcement, plus a Next.js SSG marketing site with a landing page, MDX blog, docs section, and pricing page.

**Architecture:** Billing logic lives entirely in `apps/api` (Hono route handlers + Drizzle). The web app renders a fully static marketing site built with Next.js SSG — no server components needed for public pages. MDX blog posts are read at build time. Stripe webhooks are handled by a dedicated Hono route. Usage is tracked per-user per-month in the existing `usage_records` table.

**Tech Stack:** Stripe (`stripe` Node SDK), Next.js 16 SSG, MDX (`@next/mdx`), Tailwind CSS 4, Drizzle ORM, TypeScript 5.x, Zod

---

## Plan Definitions

| Plan   | Price        | Ingests/mo | QA/mo | Audio/mo | API Keys     |
|--------|-------------|-----------|-------|----------|-------------|
| Free   | $0          | 50        | 100   | 5        | None (ours) |
| Pro    | $19/mo      | Unlimited | Unlimited | 60   | None (ours) |
| BYOK   | $5/mo       | Unlimited | Unlimited | Unlimited | User's own  |

---

## File Structure

```
apps/api/src/
  routes/
    billing.ts              -- Stripe Checkout, portal, webhook handler
  middleware/
    usage.ts                -- usage counting middleware (ingest, qa, audio)
    plan-guard.ts           -- plan enforcement middleware (check limits)
  lib/
    stripe.ts               -- Stripe client singleton + helpers
    usage.ts                -- usage read/write helpers

apps/web/src/
  app/
    (marketing)/            -- route group: no app shell, pure static
      page.tsx              -- landing page (hero, features, how it works, pricing CTA)
      pricing/
        page.tsx            -- pricing page (plan comparison table + Stripe CTA)
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
  subscriptions.ts          -- subscriptions table (userId, stripeCustomerId, plan, status)
  -- usage_records already exists from Plan 1
```

---

### Task 1: Stripe Integration (Checkout, webhooks, subscription management)

**Files:**
- Create: `apps/api/src/lib/stripe.ts`
- Create: `apps/api/src/routes/billing.ts`
- Create: `packages/db/src/schema/subscriptions.ts`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Install Stripe SDK**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo
pnpm --filter @opencairn/api add stripe
```

- [ ] **Step 2: Add `subscriptions` table**

```typescript
// packages/db/src/schema/subscriptions.ts
import { pgTable, uuid, text, timestamp, pgEnum } from 'drizzle-orm/pg-core'
import { users } from './users'

export const planEnum = pgEnum('plan_type', ['free', 'pro', 'byok'])
export const subStatusEnum = pgEnum('subscription_status', [
  'active', 'canceled', 'past_due', 'trialing', 'incomplete'
])

export const subscriptions = pgTable('subscriptions', {
  id:                 uuid('id').defaultRandom().primaryKey(),
  userId:             text('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  stripeCustomerId:   text('stripe_customer_id').unique(),
  stripeSubId:        text('stripe_sub_id').unique(),
  plan:               planEnum('plan').default('free').notNull(),
  status:             subStatusEnum('status').default('active').notNull(),
  currentPeriodStart: timestamp('current_period_start'),
  currentPeriodEnd:   timestamp('current_period_end'),
  byokGeminiKey:      text('byok_gemini_key'),   -- encrypted at rest
  createdAt:          timestamp('created_at').defaultNow().notNull(),
  updatedAt:          timestamp('updated_at').defaultNow().notNull(),
})

export type Subscription    = typeof subscriptions.$inferSelect
export type NewSubscription = typeof subscriptions.$inferInsert
```

- [ ] **Step 3: Generate and run migration**

```bash
pnpm --filter @opencairn/db db:generate
pnpm --filter @opencairn/db db:migrate
```

- [ ] **Step 4: Create the Stripe client**

```typescript
// apps/api/src/lib/stripe.ts
import Stripe from 'stripe'

if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not set')

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2025-03-31.basil',
  typescript:  true,
})

export const STRIPE_PRICES = {
  pro:  process.env.STRIPE_PRICE_PRO!,    // monthly price ID from Stripe dashboard
  byok: process.env.STRIPE_PRICE_BYOK!,
} as const

export const PLAN_LIMITS = {
  free: { ingests: 50,        qa: 100,       audio: 5   },
  pro:  { ingests: Infinity,  qa: Infinity,  audio: 60  },
  byok: { ingests: Infinity,  qa: Infinity,  audio: Infinity },
} as const
```

- [ ] **Step 5: Create the billing routes**

```typescript
// apps/api/src/routes/billing.ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { stripe, STRIPE_PRICES } from '../lib/stripe'
import { db } from '../lib/db'
import { subscriptions } from '@opencairn/db/schema'
import { eq } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth'

export const billingRouter = new Hono()

// POST /billing/checkout — create Stripe Checkout session
billingRouter.post(
  '/checkout',
  authMiddleware,
  zValidator('json', z.object({
    plan:       z.enum(['pro', 'byok']),
    successUrl: z.string().url(),
    cancelUrl:  z.string().url(),
  })),
  async (c) => {
    const { plan, successUrl, cancelUrl } = c.req.valid('json')
    const userId = c.get('userId') as string

    // Get or create Stripe customer
    let [sub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))

    let customerId = sub?.stripeCustomerId

    if (!customerId) {
      const customer = await stripe.customers.create({ metadata: { userId } })
      customerId = customer.id

      // Upsert subscription row with customer ID
      await db
        .insert(subscriptions)
        .values({ userId, stripeCustomerId: customerId, plan: 'free' })
        .onConflictDoUpdate({
          target: subscriptions.userId,
          set: { stripeCustomerId: customerId },
        })
    }

    const session = await stripe.checkout.sessions.create({
      customer:   customerId,
      mode:       'subscription',
      line_items: [{ price: STRIPE_PRICES[plan], quantity: 1 }],
      success_url: successUrl,
      cancel_url:  cancelUrl,
      metadata:   { userId, plan },
    })

    return c.json({ url: session.url })
  }
)

// POST /billing/portal — customer portal for managing subscription
billingRouter.post(
  '/portal',
  authMiddleware,
  zValidator('json', z.object({ returnUrl: z.string().url() })),
  async (c) => {
    const { returnUrl } = c.req.valid('json')
    const userId = c.get('userId') as string

    const [sub] = await db
      .select({ stripeCustomerId: subscriptions.stripeCustomerId })
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))

    if (!sub?.stripeCustomerId) {
      return c.json({ error: 'No billing account found' }, 404)
    }

    const session = await stripe.billingPortal.sessions.create({
      customer:   sub.stripeCustomerId,
      return_url: returnUrl,
    })

    return c.json({ url: session.url })
  }
)

// POST /billing/webhook — Stripe webhook handler (no auth middleware)
billingRouter.post('/webhook', async (c) => {
  const sig     = c.req.header('stripe-signature') ?? ''
  const rawBody = await c.req.arrayBuffer()

  let event: import('stripe').Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(
      Buffer.from(rawBody),
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
  } catch (err: any) {
    return c.json({ error: `Webhook Error: ${err.message}` }, 400)
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as import('stripe').Stripe.Checkout.Session
      const userId  = session.metadata?.userId
      const plan    = session.metadata?.plan as 'pro' | 'byok' | undefined
      if (!userId || !plan) break

      await db
        .update(subscriptions)
        .set({ plan, status: 'active', stripeSubId: session.subscription as string })
        .where(eq(subscriptions.userId, userId))
      break
    }

    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub    = event.data.object as import('stripe').Stripe.Subscription
      const status = event.type === 'customer.subscription.deleted' ? 'canceled' : sub.status
      const plan   = event.type === 'customer.subscription.deleted' ? 'free'
        : (sub.metadata?.plan as 'pro' | 'byok' | undefined) ?? 'free'

      await db
        .update(subscriptions)
        .set({
          status:             status as any,
          plan:               plan as any,
          currentPeriodStart: sub.current_period_start
            ? new Date(sub.current_period_start * 1000) : null,
          currentPeriodEnd:   sub.current_period_end
            ? new Date(sub.current_period_end * 1000) : null,
        })
        .where(eq(subscriptions.stripeSubId, sub.id))
      break
    }

    case 'invoice.payment_failed': {
      const inv = event.data.object as import('stripe').Stripe.Invoice
      if (inv.subscription) {
        await db
          .update(subscriptions)
          .set({ status: 'past_due' })
          .where(eq(subscriptions.stripeSubId, inv.subscription as string))
      }
      break
    }
  }

  return c.json({ received: true })
})

// GET /billing/subscription — get current user's plan
billingRouter.get('/subscription', authMiddleware, async (c) => {
  const userId = c.get('userId') as string
  const [sub]  = await db
    .select({
      plan:              subscriptions.plan,
      status:            subscriptions.status,
      currentPeriodEnd:  subscriptions.currentPeriodEnd,
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

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema/subscriptions.ts \
        apps/api/src/lib/stripe.ts \
        apps/api/src/routes/billing.ts \
        apps/api/src/app.ts \
        packages/db/drizzle/
git commit -m "feat(billing): Stripe Checkout, portal, and webhook handler with subscription management"
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
import { PLAN_LIMITS } from '../lib/stripe'

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

- [ ] **Step 2: Add BYOK key resolver**

BYOK users store their own Gemini API key in `subscriptions.byokGeminiKey`. Agents should use the user's key when available.

```typescript
// apps/api/src/middleware/plan-guard.ts — append:

export function resolveGeminiKey() {
  return createMiddleware(async (c, next) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) return next()

    const [sub] = await db
      .select({ plan: subscriptions.plan, byokGeminiKey: subscriptions.byokGeminiKey })
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))

    // BYOK users: use their key, otherwise fall back to platform key
    const geminiKey = sub?.plan === 'byok' && sub.byokGeminiKey
      ? sub.byokGeminiKey
      : process.env.GEMINI_API_KEY!

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

    // In production: encrypt geminiKey before storage using a KMS or AES-256
    await db
      .update(subscriptions)
      .set({ byokGeminiKey: geminiKey })
      .where(eq(subscriptions.userId, userId))

    return c.json({ success: true })
  }
)
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/middleware/plan-guard.ts \
        apps/api/src/routes/billing.ts \
        apps/api/src/app.ts
git commit -m "feat(billing): plan enforcement middleware with Free/Pro/BYOK limits and BYOK key management"
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

Add to `.env.example` and Vercel/production secrets:

```
# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_PRO=price_...       # Pro plan monthly price ID
STRIPE_PRICE_BYOK=price_...      # BYOK plan monthly price ID

# Supabase (shared with Narrator from Plan 8)
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

### Stripe Webhook Setup

In the Stripe Dashboard → Webhooks, add an endpoint pointing to:
`https://api.your-domain.com/billing/webhook`

Listen for the following events:
- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_failed`

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
