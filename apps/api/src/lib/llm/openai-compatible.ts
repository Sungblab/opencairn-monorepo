import {
  LLMNotConfiguredError,
  type LLMProvider,
  type StreamChunk,
  type Usage,
} from "./provider";

export function normalizeOpenAICompatibleBaseUrl(raw: string): string {
  const base = raw.replace(/\/+$/, "");
  return base.endsWith("/v1") ? base : `${base}/v1`;
}

function headers(apiKey?: string): HeadersInit {
  return {
    "content-type": "application/json",
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
  };
}

export function getOpenAICompatibleProvider(): LLMProvider {
  const baseRaw = process.env.OPENAI_COMPAT_BASE_URL;
  const chatModel = process.env.OPENAI_COMPAT_CHAT_MODEL;
  if (!baseRaw || !chatModel) {
    throw new LLMNotConfiguredError(
      "OPENAI_COMPAT_BASE_URL and OPENAI_COMPAT_CHAT_MODEL are required",
    );
  }
  const baseUrl = normalizeOpenAICompatibleBaseUrl(baseRaw);
  const apiKey = process.env.OPENAI_COMPAT_API_KEY;
  const embedModel = process.env.OPENAI_COMPAT_EMBED_MODEL;

  return {
    async embed(text: string): Promise<number[]> {
      if (!embedModel) {
        throw new Error(
          "OPENAI_COMPAT_EMBED_MODEL is required for compatible embeddings",
        );
      }
      const res = await fetch(`${baseUrl}/embeddings`, {
        method: "POST",
        headers: headers(apiKey),
        body: JSON.stringify({ model: embedModel, input: text }),
      });
      if (!res.ok) {
        throw new Error(
          "OpenAI-compatible embedding failed. Please check your configuration or try again later.",
        );
      }
      const data = (await res.json()) as {
        data?: Array<{ embedding?: number[] }>;
      };
      const values = data.data?.[0]?.embedding;
      if (!values) {
        throw new Error("OpenAI-compatible endpoint returned no embedding");
      }
      return values;
    },

    async *streamGenerate(opts): AsyncGenerator<StreamChunk> {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: headers(apiKey),
        signal: opts.signal,
        body: JSON.stringify({
          model: chatModel,
          messages: opts.messages,
          stream: true,
          stream_options: { include_usage: true },
          ...(opts.maxOutputTokens ? { max_tokens: opts.maxOutputTokens } : {}),
          ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        }),
      });
      if (!res.ok) {
        throw new Error(
          "OpenAI-compatible chat failed. Please check your configuration or try again later.",
        );
      }
      if (!res.body) {
        throw new Error("OpenAI-compatible stream returned no body");
      }

      let usage: Usage | null = null;
      for await (const chunk of parseOpenAICompatibleSse(
        res.body,
        chatModel,
        opts.signal,
      )) {
        if ("usage" in chunk) usage = chunk.usage;
        yield chunk;
      }
      if (!opts.signal?.aborted && !usage) {
        yield { usage: { tokensIn: 0, tokensOut: 0, model: chatModel } };
      }
    },
  };
}

async function* parseOpenAICompatibleSse(
  body: ReadableStream<Uint8Array>,
  model: string,
  signal?: AbortSignal,
): AsyncGenerator<StreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const dataLines = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"));
        for (const line of dataLines) {
          const raw = line.slice("data:".length).trim();
          if (!raw || raw === "[DONE]") continue;
          let parsed: {
            choices?: Array<{ delta?: { content?: string } }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          try {
            parsed = JSON.parse(raw) as typeof parsed;
          } catch {
            continue;
          }
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) yield { delta };
          if (parsed.usage) {
            yield {
              usage: {
                tokensIn: parsed.usage.prompt_tokens ?? 0,
                tokensOut: parsed.usage.completion_tokens ?? 0,
                model,
              },
            };
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
