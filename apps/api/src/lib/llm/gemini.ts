import {
  GoogleGenAI,
  ServiceTier as GeminiServiceTier,
  ThinkingLevel as GeminiThinkingLevel,
} from "@google/genai";
import {
  LLMNotConfiguredError,
  type ChatMsg,
  type GroundedSearchResult,
  type LLMProvider,
  type ThinkingLevel,
  type Usage,
} from "./provider";

// ── Factory ──────────────────────────────────────────────────────────────

const CHAT_MODEL_DEFAULT = "gemini-3-flash-preview";
const EMBED_MODEL_DEFAULT = "gemini-embedding-001";
const EMBED_DIM_DEFAULT = 768; // ADR-007
const GEMINI_THINKING_LEVEL: Record<ThinkingLevel, GeminiThinkingLevel> = {
  minimal: "MINIMAL" as GeminiThinkingLevel,
  low: GeminiThinkingLevel.LOW,
  medium: GeminiThinkingLevel.MEDIUM,
  high: GeminiThinkingLevel.HIGH,
};
const GEMINI_SERVICE_TIER: Record<string, GeminiServiceTier> = {
  standard: GeminiServiceTier.STANDARD,
  flex: GeminiServiceTier.FLEX,
  priority: GeminiServiceTier.PRIORITY,
};

function readEmbedDim(): number {
  const raw = process.env.VECTOR_DIM;
  if (!raw) return EMBED_DIM_DEFAULT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || `${parsed}` !== raw.trim()) {
    throw new Error(`Invalid VECTOR_DIM: ${raw}`);
  }
  return parsed;
}

function readServiceTier(): GeminiServiceTier | undefined {
  const raw =
    process.env.GEMINI_CHAT_SERVICE_TIER ?? process.env.GEMINI_SERVICE_TIER;
  if (!raw?.trim()) return undefined;
  const tier = GEMINI_SERVICE_TIER[raw.trim().toLowerCase()];
  if (!tier) {
    throw new Error(
      `Invalid Gemini service tier: ${raw}. Expected standard, flex, or priority.`,
    );
  }
  return tier;
}

function thinkingConfig(
  thinkingLevel?: ThinkingLevel,
):
  | { thinkingConfig: { thinkingLevel: GeminiThinkingLevel } }
  | Record<string, never> {
  return thinkingLevel
    ? {
        thinkingConfig: { thinkingLevel: GEMINI_THINKING_LEVEL[thinkingLevel] },
      }
    : {};
}

function withoutThinkingConfig<T extends Record<string, unknown>>(
  config: T,
): Omit<T, "thinkingConfig"> {
  const { thinkingConfig: _drop, ...rest } = config;
  return rest;
}

function isThinkingLevelUnsupported(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /thinking level.*is not supported/i.test(text);
}

function isGeminiEmbedding2Model(model: string): boolean {
  return model.replace(/^models\//, "").startsWith("gemini-embedding-2");
}

function embedQueryText(text: string, model: string): string {
  if (!isGeminiEmbedding2Model(model)) return text;
  return `task: search result | query: ${text}`;
}

export function getGeminiProvider(): LLMProvider {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new LLMNotConfiguredError(
      "GEMINI_API_KEY or GOOGLE_API_KEY env var missing",
    );
  }

  const client = new GoogleGenAI({ apiKey });
  const chatModel = process.env.GEMINI_CHAT_MODEL ?? CHAT_MODEL_DEFAULT;
  const embedModel =
    process.env.GEMINI_EMBED_MODEL ??
    process.env.EMBED_MODEL ??
    EMBED_MODEL_DEFAULT;
  const embedDim = readEmbedDim();
  const serviceTier = readServiceTier();

  return {
    async embed(text: string): Promise<number[]> {
      const embedding2 = isGeminiEmbedding2Model(embedModel);
      const res = await client.models.embedContent({
        model: embedModel,
        contents: [{ parts: [{ text: embedQueryText(text, embedModel) }] }],
        config: {
          outputDimensionality: embedDim,
          ...(embedding2 ? {} : { taskType: "RETRIEVAL_QUERY" }),
        },
      });
      const values = res.embeddings?.[0]?.values;
      if (!values || values.length !== embedDim) {
        throw new Error(
          `Gemini returned no embedding (got ${values?.length ?? 0}d, expected ${embedDim}d)`,
        );
      }
      return values;
    },
    async groundSearch(query, opts): Promise<GroundedSearchResult | null> {
      const config = {
        tools: [{ googleSearch: {} }],
        ...(serviceTier ? { serviceTier } : {}),
        ...(opts?.maxOutputTokens
          ? { maxOutputTokens: opts.maxOutputTokens }
          : {}),
        ...thinkingConfig(opts?.thinkingLevel),
        ...(opts?.cachedContent ? { cachedContent: opts.cachedContent } : {}),
        ...(opts?.signal ? { abortSignal: opts.signal } : {}),
      };
      let res;
      try {
        res = await client.models.generateContent({
          model: chatModel,
          contents: query,
          config,
        });
      } catch (error) {
        if (
          !("thinkingConfig" in config) ||
          !isThinkingLevelUnsupported(error)
        ) {
          throw error;
        }
        res = await client.models.generateContent({
          model: chatModel,
          contents: query,
          config: withoutThinkingConfig(config),
        });
      }
      const grounding = res.candidates?.[0]?.groundingMetadata;
      const sources =
        grounding?.groundingChunks?.flatMap((chunk) => {
          const web = chunk.web;
          if (!web?.uri) return [];
          return [
            {
              title: web.title || web.domain || web.uri,
              url: web.uri,
              ...(web.domain ? { snippet: web.domain } : {}),
            },
          ];
        }) ?? [];
      const usage = res.usageMetadata
        ? {
            tokensIn: res.usageMetadata.promptTokenCount ?? 0,
            tokensOut: res.usageMetadata.candidatesTokenCount ?? 0,
            model: chatModel,
          }
        : undefined;
      return {
        answer: res.text ?? "",
        sources,
        ...(usage ? { usage } : {}),
      };
    },
    async *streamGenerate(opts) {
      const {
        messages,
        signal,
        maxOutputTokens,
        temperature,
        thinkingLevel,
        cachedContent,
      } = opts;

      // Gemini chat is "single-turn with history" via `contents` array. We
      // collapse system messages into a leading systemInstruction (the SDK
      // path) and map user/assistant to user/model roles.
      const systemMsgs = messages.filter((m) => m.role === "system");
      const turns = messages.filter((m) => m.role !== "system");
      const contents = turns.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

      const config = {
        ...(systemMsgs.length > 0
          ? { systemInstruction: systemMsgs.map((m) => m.content).join("\n\n") }
          : {}),
        ...(serviceTier ? { serviceTier } : {}),
        ...(maxOutputTokens ? { maxOutputTokens } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
        ...thinkingConfig(thinkingLevel),
        ...(cachedContent ? { cachedContent } : {}),
        ...(signal ? { abortSignal: signal } : {}),
      };

      let stream;
      try {
        stream = await client.models.generateContentStream({
          model: chatModel,
          contents,
          config,
        });
      } catch (error) {
        if (
          !("thinkingConfig" in config) ||
          !isThinkingLevelUnsupported(error)
        ) {
          throw error;
        }
        stream = await client.models.generateContentStream({
          model: chatModel,
          contents,
          config: withoutThinkingConfig(config),
        });
      }

      let lastUsage: Usage | null = null;
      for await (const chunk of stream as AsyncIterable<{
        text?: string;
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
        };
      }>) {
        if (signal?.aborted) return;
        if (chunk.text) yield { delta: chunk.text };
        if (chunk.usageMetadata) {
          lastUsage = {
            tokensIn: chunk.usageMetadata.promptTokenCount ?? 0,
            tokensOut: chunk.usageMetadata.candidatesTokenCount ?? 0,
            model: chatModel,
          };
        }
      }
      // Contract: always emit exactly one usage chunk on normal completion.
      // If the SDK never surfaced usageMetadata, fall back to zeros so
      // consumers (e.g. cost trackers) can rely on a terminal usage event.
      yield {
        usage: lastUsage ?? { tokensIn: 0, tokensOut: 0, model: chatModel },
      };
    },
  };
}
