# Billing Model

OpenCairn hosted billing is a credit-based model. The open-source self-hosted
distribution remains separate: self-host operators bring their own
infrastructure, provider keys, and payment policy.

> Status: Billing Core v1 is provider-agnostic product infrastructure. Payment
> rails, VAT handling, refunds, and automatic top-up are not wired into the
> application yet.

## Launch Plans

| Plan | Monthly price | Managed credits | LLM cost path | Notes |
| --- | ---: | ---: | --- | --- |
| Free | ₩0 | 500 / month | OpenCairn managed key | Starter pool for onboarding and light usage. |
| BYOK | ₩4,900 / month | 0 | User Gemini key | Hosted OpenCairn account; LLM API charges are paid by the user to their provider. |
| Pro | ₩9,900 / month | 8,000 / month | OpenCairn managed key | Personal managed plan for normal document, chat, RAG, and generation usage. |
| Max | ₩19,900 / month | 18,000 / month | OpenCairn managed key | Higher-usage managed plan for long documents, larger RAG jobs, and research workflows. |

Included credits are product policy, not a promise that every workload is
unlimited. Fair-use and anti-abuse limits can still apply.

## Credit Semantics

Credits are integer KRW-like units used for user-facing balance accounting.
Provider costs are stored separately as raw USD and KRW estimates.

For each managed LLM usage event:

1. The API estimates raw provider cost from provider, model, pricing tier,
   input tokens, output tokens, cached input tokens, and search queries.
2. The estimate snapshots `usdToKrw`, `marginMultiplier`, and optional
   `featureMultiplier`.
3. The user-facing charge is `ceil(rawCostKrw * marginMultiplier *
   featureMultiplier)`.
4. The credit ledger writes an append-only row with the raw cost, pricing
   assumptions, charged credits, request/source metadata, and resulting balance.

The margin and exchange-rate values are operational settings. They are stored
per ledger transaction so later policy changes do not rewrite historical
charges.

## Current Schema

Billing Core v1 adds two tables:

- `credit_balances`: one row per user with current plan, current balance,
  monthly grant amount, monthly grant anchor, and auto-recharge flag.
- `credit_ledger_entries`: append-only ledger for subscription grants, top-ups,
  usage, refunds, adjustments, and manual grants.
- `admin_credit_campaigns`: operator-created credit grant campaigns for
  promotions, launch cohorts, manual recovery, or other non-payment credit
  programs. Campaign execution writes normal `manual_grant` ledger entries with
  `sourceType = "credit_campaign"` so balances and audits still use the single
  credit ledger.

`llm_usage_events` remains the raw operational usage log. The credit ledger is
the user-facing balance and billing audit trail.

The `user_plan` enum currently contains `free`, `pro`, `max`, and `byok`.

## Out Of Scope

Billing Core v1 deliberately does not include:

- payment provider integration,
- card vaulting or billing keys,
- automatic top-up execution,
- refund execution,
- VAT invoice handling,
- public checkout flows.

Those should be added behind the existing ledger and plan model rather than
creating a parallel billing store.

Admin operations can still grant credits, change plans, inspect low-balance
users, review estimated MRR and provider cost, and run credit campaigns. These
operator actions are not payment collection; they are control-plane mutations
over the existing credit ledger.

## Routing

The current default routing policy is:

- BYOK plan: use the user's Gemini key for LLM calls that support BYOK.
- Managed plans: use OpenCairn managed Gemini credentials and charge credits.
- Free: use OpenCairn managed Gemini credentials with a small monthly credit
  pool and stricter product limits.

See [billing-routing.md](./billing-routing.md) for key-source routing policy
notes.
