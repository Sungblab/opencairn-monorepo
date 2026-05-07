// Plan 11A — placeholder cost calculation. Each provider's true rate
// comes from the worker side in Plan 11B; the API only needs a stable
// in/out token → KRW conversion to populate the SSE `cost` event and the
// totals on the conversation row.
//
// Rate source: docs/architecture/billing-routing.md (2026-04-23 draft).
// USD→KRW pinned at 1650 to match billing-model.md (2026-04-19); when the
// real per-provider rate plumbing lands this file becomes a thin wrapper
// over packages/llm.
const DEFAULT_USD_TO_KRW = 1650;

// Gemini 2.5 Flash placeholder rates ($/1M tokens). Refined per-provider
// in Plan 11B once usage records are wired through.
const RATES_USD_PER_1M = {
  in: 0.075,
  out: 0.3,
};

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function rateForModel(provider: string, model: string) {
  if (provider === "gemini" || model.toLowerCase().includes("gemini")) {
    return {
      inputUsdPer1M: numberEnv(
        "GEMINI_FLASH_INPUT_USD_PER_1M",
        RATES_USD_PER_1M.in,
      ),
      outputUsdPer1M: numberEnv(
        "GEMINI_FLASH_OUTPUT_USD_PER_1M",
        RATES_USD_PER_1M.out,
      ),
    };
  }
  return {
    inputUsdPer1M: numberEnv("LLM_DEFAULT_INPUT_USD_PER_1M", 0),
    outputUsdPer1M: numberEnv("LLM_DEFAULT_OUTPUT_USD_PER_1M", 0),
  };
}

export type TokenCostInput = {
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  cachedTokens?: number;
};

export type TokenCostEstimate = {
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
  costUsd: number;
  costKrw: number;
  usdToKrw: number;
  inputUsdPer1M: number;
  outputUsdPer1M: number;
};

export function estimateTokenCost(input: TokenCostInput): TokenCostEstimate {
  const tokensIn = Math.max(0, Math.trunc(input.tokensIn));
  const tokensOut = Math.max(0, Math.trunc(input.tokensOut));
  const cachedTokens = Math.max(0, Math.trunc(input.cachedTokens ?? 0));
  const usdToKrw = numberEnv("LLM_COST_USD_TO_KRW", DEFAULT_USD_TO_KRW);
  const { inputUsdPer1M, outputUsdPer1M } = rateForModel(
    input.provider,
    input.model,
  );
  const billableInputTokens = Math.max(0, tokensIn - cachedTokens);
  const costUsd = Number(
    (
      (billableInputTokens / 1_000_000) * inputUsdPer1M +
      (tokensOut / 1_000_000) * outputUsdPer1M
    ).toFixed(6),
  );
  return {
    tokensIn,
    tokensOut,
    cachedTokens,
    costUsd,
    costKrw: Number((costUsd * usdToKrw).toFixed(4)),
    usdToKrw,
    inputUsdPer1M,
    outputUsdPer1M,
  };
}

export function tokensToKrw(tokensIn: number, tokensOut: number): number {
  return estimateTokenCost({
    provider: "gemini",
    model: "gemini-3-flash-preview",
    tokensIn,
    tokensOut,
  }).costKrw;
}
