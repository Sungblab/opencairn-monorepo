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
const EMBED_DIM = 768; // ADR-007

export function getGeminiProvider(): LLMProvider {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new LLMNotConfiguredError();

  const client = new GoogleGenAI({ apiKey });
  const chatModel = process.env.GEMINI_CHAT_MODEL ?? CHAT_MODEL_DEFAULT;

  return {
    async embed(text: string): Promise<number[]> {
      const res = await client.models.embedContent({
        model: EMBED_MODEL,
        contents: [{ parts: [{ text }] }],
        config: {
          taskType: "RETRIEVAL_QUERY",
          outputDimensionality: EMBED_DIM,
        },
      });
      const values = res.embeddings?.[0]?.values;
      if (!values || values.length !== EMBED_DIM) {
        throw new Error(
          `Gemini returned no embedding (got ${values?.length ?? 0}d, expected ${EMBED_DIM}d)`,
        );
      }
      return values;
    },
    async *streamGenerate(_opts) {
      // Stub — implemented in Task 2.6
      void chatModel;
      throw new Error("not implemented yet");
      // unreachable yield to satisfy AsyncGenerator return type
      yield { delta: "" };
    },
  };
}
