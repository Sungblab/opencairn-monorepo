import {
  LLMNotConfiguredError,
  type GroundedSearchResult,
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
    async groundSearch(query, opts): Promise<GroundedSearchResult | null> {
      const res = await fetch(`${baseUrl}/responses`, {
        method: "POST",
        headers: headers(apiKey),
        signal: opts?.signal,
        body: JSON.stringify({
          model: chatModel,
          input: query,
          tools: [{ type: "web_search" }],
          tool_choice: "auto",
          ...(opts?.maxOutputTokens
            ? { max_output_tokens: opts.maxOutputTokens }
            : {}),
        }),
      });

      if (!res.ok) {
        // Most OpenAI-compatible local servers only implement Chat
        // Completions. Treat missing Responses/web_search support as
        // unavailable grounding so runChat can surface grounding_required.
        if (res.status === 400 || res.status === 404 || res.status === 501) {
          return null;
        }
        throw new Error(
          "OpenAI-compatible web search failed. Please check your configuration or try again later.",
        );
      }

      const data = (await res.json()) as OpenAIResponsesSearchResult;
      const answer = extractResponsesOutputText(data);
      const sources = extractResponsesUrlCitations(data);
      if (!answer || sources.length === 0) return null;

      const usage = data.usage
        ? {
            tokensIn: data.usage.input_tokens ?? 0,
            tokensOut: data.usage.output_tokens ?? 0,
            model: chatModel,
          }
        : undefined;

      return {
        answer,
        sources,
        ...(usage ? { usage } : {}),
      };
    },

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

type OpenAIResponsesSearchResult = {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
      annotations?: Array<{
        type?: string;
        url?: string;
        title?: string;
      }>;
    }>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
};

function extractResponsesOutputText(data: OpenAIResponsesSearchResult): string {
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text;
  }
  return (
    data.output
      ?.flatMap((item) => item.content ?? [])
      .map((content) => content.text)
      .filter((text): text is string => Boolean(text?.trim()))
      .join("\n")
      .trim() ?? ""
  );
}

function extractResponsesUrlCitations(data: OpenAIResponsesSearchResult) {
  const seen = new Set<string>();
  return (
    data.output
      ?.flatMap((item) => item.content ?? [])
      .flatMap((content) => content.annotations ?? [])
      .flatMap((annotation) => {
        if (annotation.type !== "url_citation" || !annotation.url) return [];
        if (seen.has(annotation.url)) return [];
        seen.add(annotation.url);
        return [
          {
            title: annotation.title || annotation.url,
            url: annotation.url,
          },
        ];
      }) ?? []
  );
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
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const dataLines = frame
          .split(/\r?\n/)
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
