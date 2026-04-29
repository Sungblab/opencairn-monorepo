import { GoogleGenAI } from "@google/genai";

// ── Types ────────────────────────────────────────────────────────────────

export type ChatMsg = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type Usage = {
  tokensIn: number;
  tokensOut: number;
  model: string;
};

/**
 * Streaming chunk yielded by {@link LLMProvider.streamGenerate}.
 *
 * Contract: a generator yields zero or more `{delta}` chunks followed by
 * exactly one `{usage}` chunk on normal completion. If the SDK does not
 * surface usage metadata, providers MUST yield a fallback `{usage}` chunk
 * with `tokensIn: 0`, `tokensOut: 0`, and the model name so callers can
 * always rely on receiving exactly one usage chunk.
 *
 * On abort (caller cancels via `AbortSignal`), the stream may end without
 * a `{usage}` chunk — aborts are special and consumers must handle that
 * case explicitly.
 */
export type StreamChunk = { delta: string } | { usage: Usage };

export interface LLMProvider {
  embed(text: string): Promise<number[]>;
  streamGenerate(opts: {
    messages: ChatMsg[];
    signal?: AbortSignal;
    maxOutputTokens?: number;
    temperature?: number;
  }): AsyncGenerator<StreamChunk>;
}

// ── Errors ───────────────────────────────────────────────────────────────

export class LLMNotConfiguredError extends Error {
  readonly code = "llm_not_configured";
  constructor(detail?: string) {
    super(
      `LLM not configured: ${detail ?? "GEMINI_API_KEY or GOOGLE_API_KEY env var missing"}`,
    );
    this.name = "LLMNotConfiguredError";
  }
}

// ── Factory ──────────────────────────────────────────────────────────────

const CHAT_MODEL_DEFAULT = "gemini-2.5-flash";
const EMBED_MODEL = "gemini-embedding-001";
const EMBED_DIM_DEFAULT = 768; // ADR-007

function readEmbedDim(): number {
  const raw = process.env.VECTOR_DIM;
  if (!raw) return EMBED_DIM_DEFAULT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || `${parsed}` !== raw.trim()) {
    throw new Error(`Invalid VECTOR_DIM: ${raw}`);
  }
  return parsed;
}

export function getGeminiProvider(): LLMProvider {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new LLMNotConfiguredError();

  const client = new GoogleGenAI({ apiKey });
  const chatModel = process.env.GEMINI_CHAT_MODEL ?? CHAT_MODEL_DEFAULT;
  const embedDim = readEmbedDim();

  return {
    async embed(text: string): Promise<number[]> {
      const res = await client.models.embedContent({
        model: EMBED_MODEL,
        contents: [{ parts: [{ text }] }],
        config: {
          taskType: "RETRIEVAL_QUERY",
          outputDimensionality: embedDim,
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
    async *streamGenerate(opts) {
      const { messages, signal, maxOutputTokens, temperature } = opts;

      // Gemini chat is "single-turn with history" via `contents` array. We
      // collapse system messages into a leading systemInstruction (the SDK
      // path) and map user/assistant to user/model roles.
      const systemMsgs = messages.filter((m) => m.role === "system");
      const turns = messages.filter((m) => m.role !== "system");
      const contents = turns.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

      const stream = await client.models.generateContentStream({
        model: chatModel,
        contents,
        config: {
          ...(systemMsgs.length > 0
            ? { systemInstruction: systemMsgs.map((m) => m.content).join("\n\n") }
            : {}),
          ...(maxOutputTokens ? { maxOutputTokens } : {}),
          ...(temperature !== undefined ? { temperature } : {}),
          ...(signal ? { abortSignal: signal } : {}),
        },
      });

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
