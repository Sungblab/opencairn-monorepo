const DEFAULT_USD_TO_KRW = 1650;
const DEFAULT_MARGIN_MULTIPLIER = 1.6;

export type PricingTier = "standard" | "batch" | "flex" | "priority";

type ModelRate = {
  inputUsdPer1M: number;
  outputUsdPer1M: number;
  cachedInputUsdPer1M?: number;
  searchUsdPer1K?: number;
};

const GEMINI_SEARCH_USD_PER_1K = 14;

const GEMINI_RATES: Record<string, Partial<Record<PricingTier, ModelRate>>> = {
  "gemini-3-flash-preview": {
    standard: {
      inputUsdPer1M: 0.5,
      outputUsdPer1M: 3,
      cachedInputUsdPer1M: 0.05,
      searchUsdPer1K: GEMINI_SEARCH_USD_PER_1K,
    },
    batch: {
      inputUsdPer1M: 0.25,
      outputUsdPer1M: 1.5,
      cachedInputUsdPer1M: 0.05,
      searchUsdPer1K: GEMINI_SEARCH_USD_PER_1K,
    },
    flex: {
      inputUsdPer1M: 0.25,
      outputUsdPer1M: 1.5,
      cachedInputUsdPer1M: 0.05,
      searchUsdPer1K: GEMINI_SEARCH_USD_PER_1K,
    },
    priority: {
      inputUsdPer1M: 0.9,
      outputUsdPer1M: 5.4,
      cachedInputUsdPer1M: 0.09,
      searchUsdPer1K: GEMINI_SEARCH_USD_PER_1K,
    },
  },
  "gemini-3.1-flash-lite": {
    standard: {
      inputUsdPer1M: 0.25,
      outputUsdPer1M: 1.5,
      cachedInputUsdPer1M: 0.025,
      searchUsdPer1K: GEMINI_SEARCH_USD_PER_1K,
    },
    batch: {
      inputUsdPer1M: 0.125,
      outputUsdPer1M: 0.75,
      cachedInputUsdPer1M: 0.0125,
      searchUsdPer1K: GEMINI_SEARCH_USD_PER_1K,
    },
    flex: {
      inputUsdPer1M: 0.125,
      outputUsdPer1M: 0.75,
      cachedInputUsdPer1M: 0.0125,
      searchUsdPer1K: GEMINI_SEARCH_USD_PER_1K,
    },
    priority: {
      inputUsdPer1M: 0.45,
      outputUsdPer1M: 2.7,
      cachedInputUsdPer1M: 0.045,
      searchUsdPer1K: GEMINI_SEARCH_USD_PER_1K,
    },
  },
  "gemini-3.1-pro-preview": {
    standard: {
      inputUsdPer1M: 2,
      outputUsdPer1M: 12,
      cachedInputUsdPer1M: 0.2,
      searchUsdPer1K: GEMINI_SEARCH_USD_PER_1K,
    },
    batch: {
      inputUsdPer1M: 1,
      outputUsdPer1M: 6,
      cachedInputUsdPer1M: 0.2,
      searchUsdPer1K: GEMINI_SEARCH_USD_PER_1K,
    },
    flex: {
      inputUsdPer1M: 1,
      outputUsdPer1M: 6,
      cachedInputUsdPer1M: 0.2,
      searchUsdPer1K: GEMINI_SEARCH_USD_PER_1K,
    },
    priority: {
      inputUsdPer1M: 3.6,
      outputUsdPer1M: 21.6,
      cachedInputUsdPer1M: 0.36,
      searchUsdPer1K: GEMINI_SEARCH_USD_PER_1K,
    },
  },
  "gemini-embedding-001": {
    standard: {
      inputUsdPer1M: 0.15,
      outputUsdPer1M: 0,
    },
    batch: {
      inputUsdPer1M: 0.075,
      outputUsdPer1M: 0,
    },
  },
  "gemini-embedding-2": {
    standard: {
      inputUsdPer1M: 0.2,
      outputUsdPer1M: 0,
    },
  },
};

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function normaliseGeminiModel(model: string): string {
  return model.replace(/^models\//, "").trim().toLowerCase();
}

function pricingTierForInput(input: TokenCostInput): PricingTier {
  if (input.pricingTier) return input.pricingTier;
  return input.operation?.includes("batch") ? "batch" : "standard";
}

function rateForModel(
  provider: string,
  model: string,
  pricingTier: PricingTier,
): ModelRate {
  const normalised = normaliseGeminiModel(model);
  if (provider === "gemini" || normalised.includes("gemini")) {
    const table = GEMINI_RATES[normalised];
    return (
      table?.[pricingTier] ??
      table?.standard ?? {
        inputUsdPer1M: numberEnv("LLM_DEFAULT_INPUT_USD_PER_1M", 0),
        outputUsdPer1M: numberEnv("LLM_DEFAULT_OUTPUT_USD_PER_1M", 0),
      }
    );
  }
  return {
    inputUsdPer1M: numberEnv("LLM_DEFAULT_INPUT_USD_PER_1M", 0),
    outputUsdPer1M: numberEnv("LLM_DEFAULT_OUTPUT_USD_PER_1M", 0),
  };
}

export type TokenCostInput = {
  provider: string;
  model: string;
  operation?: string;
  pricingTier?: PricingTier;
  tokensIn: number;
  tokensOut: number;
  cachedTokens?: number;
  searchQueries?: number;
  featureMultiplier?: number;
};

export type TokenCostEstimate = {
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
  searchQueries: number;
  pricingTier: PricingTier;
  costUsd: number;
  costKrw: number;
  billableCredits: number;
  usdToKrw: number;
  marginMultiplier: number;
  featureMultiplier: number;
  inputUsdPer1M: number;
  outputUsdPer1M: number;
  cachedInputUsdPer1M: number;
  searchUsdPer1K: number;
};

export function estimateTokenCost(input: TokenCostInput): TokenCostEstimate {
  const tokensIn = Math.max(0, Math.trunc(input.tokensIn));
  const tokensOut = Math.max(0, Math.trunc(input.tokensOut));
  const cachedTokens = Math.min(
    tokensIn,
    Math.max(0, Math.trunc(input.cachedTokens ?? 0)),
  );
  const searchQueries = Math.max(0, Math.trunc(input.searchQueries ?? 0));
  const usdToKrw = numberEnv("LLM_COST_USD_TO_KRW", DEFAULT_USD_TO_KRW);
  const marginMultiplier = numberEnv(
    "LLM_COST_MARGIN_MULTIPLIER",
    DEFAULT_MARGIN_MULTIPLIER,
  );
  const featureMultiplier = Math.max(0, input.featureMultiplier ?? 1);
  const pricingTier = pricingTierForInput(input);
  const rate = rateForModel(
    input.provider,
    input.model,
    pricingTier,
  );
  const {
    inputUsdPer1M,
    outputUsdPer1M,
    cachedInputUsdPer1M = inputUsdPer1M,
    searchUsdPer1K = 0,
  } = rate;
  const billableInputTokens = Math.max(0, tokensIn - cachedTokens);
  const costUsd = Number(
    (
      (billableInputTokens / 1_000_000) * inputUsdPer1M +
      (cachedTokens / 1_000_000) * cachedInputUsdPer1M +
      (tokensOut / 1_000_000) * outputUsdPer1M +
      (searchQueries / 1_000) * searchUsdPer1K
    ).toFixed(6),
  );
  const costKrw = Number((costUsd * usdToKrw).toFixed(4));
  return {
    tokensIn,
    tokensOut,
    cachedTokens,
    searchQueries,
    pricingTier,
    costUsd,
    costKrw,
    billableCredits: Math.ceil(
      costKrw * marginMultiplier * featureMultiplier,
    ),
    usdToKrw,
    marginMultiplier,
    featureMultiplier,
    inputUsdPer1M,
    outputUsdPer1M,
    cachedInputUsdPer1M,
    searchUsdPer1K,
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
