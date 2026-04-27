// Plan 11A — placeholder cost calculation. Each provider's true rate
// comes from the worker side in Plan 11B; the API only needs a stable
// in/out token → KRW conversion to populate the SSE `cost` event and the
// totals on the conversation row.
//
// Rate source: docs/architecture/billing-routing.md (2026-04-23 draft).
// USD→KRW pinned at 1650 to match billing-model.md (2026-04-19); when the
// real per-provider rate plumbing lands this file becomes a thin wrapper
// over packages/llm.
const USD_TO_KRW = 1650;

// Gemini 2.5 Flash placeholder rates ($/1M tokens). Refined per-provider
// in Plan 11B once usage records are wired through.
const RATES_USD_PER_1M = {
  in: 0.075,
  out: 0.3,
};

export function tokensToKrw(tokensIn: number, tokensOut: number): number {
  const usd =
    (tokensIn / 1_000_000) * RATES_USD_PER_1M.in +
    (tokensOut / 1_000_000) * RATES_USD_PER_1M.out;
  return Number((usd * USD_TO_KRW).toFixed(4));
}
