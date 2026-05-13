import { z } from "zod";
import { billingPlanConfigs, type UserPlan } from "@opencairn/shared";
import {
  estimateTokenCost,
  type PricingTier,
  type TokenCostEstimate,
} from "./cost";

export const studioToolProfileSchema = z.enum([
  "explain",
  "summary",
  "quiz",
  "flashcards",
  "mock_exam",
  "fill_blank",
  "exam_prep",
  "compare",
  "glossary",
  "cheat_sheet",
  "slides",
  "document",
  "interactive_html",
  "data_table",
  "deep_research",
]);

export type StudioToolProfileId = z.infer<typeof studioToolProfileSchema>;

export type StudioToolExecutionClass =
  | "realtime"
  | "agent_action"
  | "durable_run";

type StudioToolProfile = {
  executionClass: StudioToolExecutionClass;
  sourceTokenCap: number;
  tokensOut: number;
  featureMultiplier: number;
  pricingTier?: PricingTier;
  searchQueries?: number;
  requiresConfirmation: boolean;
};

const STUDIO_TOOL_PROFILES: Record<StudioToolProfileId, StudioToolProfile> = {
  explain: {
    executionClass: "realtime",
    sourceTokenCap: 4_000,
    tokensOut: 1_200,
    featureMultiplier: 1,
    requiresConfirmation: false,
  },
  summary: {
    executionClass: "realtime",
    sourceTokenCap: 6_000,
    tokensOut: 1_800,
    featureMultiplier: 1,
    requiresConfirmation: false,
  },
  compare: {
    executionClass: "realtime",
    sourceTokenCap: 8_000,
    tokensOut: 2_000,
    featureMultiplier: 1.1,
    requiresConfirmation: false,
  },
  quiz: {
    executionClass: "durable_run",
    sourceTokenCap: 16_000,
    tokensOut: 5_000,
    featureMultiplier: 1.4,
    requiresConfirmation: true,
  },
  flashcards: {
    executionClass: "durable_run",
    sourceTokenCap: 14_000,
    tokensOut: 4_000,
    featureMultiplier: 1.3,
    requiresConfirmation: true,
  },
  mock_exam: {
    executionClass: "durable_run",
    sourceTokenCap: 32_000,
    tokensOut: 12_000,
    featureMultiplier: 2,
    requiresConfirmation: true,
  },
  fill_blank: {
    executionClass: "durable_run",
    sourceTokenCap: 12_000,
    tokensOut: 4_000,
    featureMultiplier: 1.3,
    requiresConfirmation: true,
  },
  exam_prep: {
    executionClass: "durable_run",
    sourceTokenCap: 24_000,
    tokensOut: 8_000,
    featureMultiplier: 1.7,
    requiresConfirmation: true,
  },
  glossary: {
    executionClass: "durable_run",
    sourceTokenCap: 16_000,
    tokensOut: 4_000,
    featureMultiplier: 1.2,
    requiresConfirmation: true,
  },
  cheat_sheet: {
    executionClass: "durable_run",
    sourceTokenCap: 18_000,
    tokensOut: 5_000,
    featureMultiplier: 1.3,
    requiresConfirmation: true,
  },
  slides: {
    executionClass: "durable_run",
    sourceTokenCap: 24_000,
    tokensOut: 8_000,
    featureMultiplier: 1.8,
    requiresConfirmation: true,
  },
  document: {
    executionClass: "durable_run",
    sourceTokenCap: 32_000,
    tokensOut: 10_000,
    featureMultiplier: 1.8,
    requiresConfirmation: true,
  },
  interactive_html: {
    executionClass: "durable_run",
    sourceTokenCap: 24_000,
    tokensOut: 10_000,
    featureMultiplier: 1.8,
    requiresConfirmation: true,
  },
  data_table: {
    executionClass: "agent_action",
    sourceTokenCap: 12_000,
    tokensOut: 4_000,
    featureMultiplier: 1.2,
    requiresConfirmation: true,
  },
  deep_research: {
    executionClass: "durable_run",
    sourceTokenCap: 64_000,
    tokensOut: 16_000,
    featureMultiplier: 3,
    pricingTier: "priority",
    searchQueries: 8,
    requiresConfirmation: true,
  },
};

export type StudioToolPreflightInput = {
  tool: StudioToolProfileId;
  plan: UserPlan;
  provider: string;
  model: string;
  sourceTokenEstimate: number;
  cachedTokenEstimate?: number;
};

export type StudioToolPreflightEstimate = {
  tool: StudioToolProfileId;
  billingPath: "managed" | "byok";
  chargeRequired: boolean;
  requiresConfirmation: boolean;
  profile: StudioToolProfile & { tokensIn: number };
  cost: TokenCostEstimate;
};

export function estimateStudioToolPreflight(
  input: StudioToolPreflightInput,
): StudioToolPreflightEstimate {
  const plan = billingPlanConfigs[input.plan];
  const profile = STUDIO_TOOL_PROFILES[input.tool];
  const sourceTokens = Math.max(0, Math.trunc(input.sourceTokenEstimate));
  const tokensIn = Math.min(sourceTokens, profile.sourceTokenCap) + 800;
  const cost = estimateTokenCost({
    provider: input.provider,
    model: input.model,
    operation: `studio.${input.tool}`,
    pricingTier: profile.pricingTier,
    tokensIn,
    tokensOut: profile.tokensOut,
    cachedTokens: input.cachedTokenEstimate,
    searchQueries: profile.searchQueries,
    featureMultiplier: profile.featureMultiplier,
  });
  const billingPath = plan.managedLlm ? "managed" : "byok";
  return {
    tool: input.tool,
    billingPath,
    chargeRequired: billingPath === "managed" && cost.billableCredits > 0,
    requiresConfirmation: profile.requiresConfirmation,
    profile: { ...profile, tokensIn },
    cost,
  };
}
