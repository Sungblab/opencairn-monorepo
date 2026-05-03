export type ChatMsg = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type Usage = {
  tokensIn: number;
  tokensOut: number;
  model: string;
};

export type ThinkingLevel = "low" | "medium" | "high";

/**
 * Streaming chunk yielded by {@link LLMProvider.streamGenerate}.
 *
 * Contract: a generator yields zero or more `{delta}` chunks followed by
 * exactly one `{usage}` chunk on normal completion. If the provider does not
 * surface usage metadata, providers MUST yield a fallback `{usage}` chunk
 * with `tokensIn: 0`, `tokensOut: 0`, and the model name.
 *
 * On abort, the stream may end without a `{usage}` chunk.
 */
export type StreamChunk = { delta: string } | { usage: Usage };

export interface LLMProvider {
  embed(text: string): Promise<number[]>;
  streamGenerate(opts: {
    messages: ChatMsg[];
    signal?: AbortSignal;
    maxOutputTokens?: number;
    temperature?: number;
    thinkingLevel?: ThinkingLevel;
  }): AsyncGenerator<StreamChunk>;
}

export class LLMNotConfiguredError extends Error {
  readonly code = "llm_not_configured";
  constructor(detail?: string) {
    super(`LLM not configured: ${detail ?? "provider env vars missing"}`);
    this.name = "LLMNotConfiguredError";
  }
}
