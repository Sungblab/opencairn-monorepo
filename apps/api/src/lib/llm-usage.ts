import { db, llmUsageEvents } from "@opencairn/db";
import { estimateTokenCost } from "./cost";

export type RecordLlmUsageEventInput = {
  userId?: string | null;
  workspaceId?: string | null;
  provider: string;
  model: string;
  operation: string;
  tokensIn: number;
  tokensOut: number;
  cachedTokens?: number;
  sourceType?: string | null;
  sourceId?: string | null;
  metadata?: Record<string, unknown>;
};

export async function recordLlmUsageEvent(input: RecordLlmUsageEventInput) {
  const cost = estimateTokenCost(input);
  const [event] = await db
    .insert(llmUsageEvents)
    .values({
      userId: input.userId ?? null,
      workspaceId: input.workspaceId ?? null,
      provider: input.provider,
      model: input.model,
      operation: input.operation,
      tokensIn: cost.tokensIn,
      tokensOut: cost.tokensOut,
      cachedTokens: cost.cachedTokens,
      costUsd: cost.costUsd.toFixed(6),
      costKrw: cost.costKrw.toFixed(4),
      usdToKrw: cost.usdToKrw.toFixed(4),
      inputUsdPer1M: cost.inputUsdPer1M.toFixed(6),
      outputUsdPer1M: cost.outputUsdPer1M.toFixed(6),
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      metadata: input.metadata ?? {},
    })
    .returning();
  return event;
}
