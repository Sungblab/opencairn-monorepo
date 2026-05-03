import type { Citation } from "@opencairn/db";
import { retrieve, type RagMode, type RetrievalScope, type RetrievalChip } from "./chat-retrieval";
import {
  evidenceBundleToPrompt,
  packEvidence,
} from "./context-packer";
import { candidateFromRetrievalHit } from "./retrieval-candidates";
import { buildRuntimeContext } from "./chat-runtime-context";
import {
  selectChatRuntimePolicy,
  type ChatMode,
} from "./chat-runtime-policy";
import { extractSaveSuggestion } from "./save-suggestion-fence";
import { envInt } from "./env";
import {
  getGeminiProvider,
  type ChatMsg,
  type LLMProvider,
  type Usage,
} from "./llm/gemini";

export type ChatChunk =
  | { type: "status"; payload: { phrase: string } }
  | { type: "thought"; payload: { summary: string } }
  | { type: "text"; payload: { delta: string } }
  | { type: "citation"; payload: Citation }
  | {
      type: "save_suggestion";
      payload: { title: string; body_markdown: string };
    }
  | { type: "usage"; payload: Usage }
  | {
      type: "error";
      payload: { message: string; code?: string; messageKey?: string };
    }
  | { type: "done"; payload: Record<string, never> };

const SYSTEM_PROMPT = [
  "You are OpenCairn, a knowledge assistant grounded in the user's workspace.",
  "When you cite the workspace, use [^N] markers matching the order of the provided context items.",
  "Never invent citations. If the context does not contain the answer, say so plainly.",
  "Reply in the same language as the user's question (Korean if Korean, English if English).",
  "",
  "If the user's question contains a self-contained insight worth saving as a separate note,",
  "you MAY append exactly one fenced block at the very end of your reply, in this exact form:",
  "",
  "```save-suggestion",
  `{"title": "<≤80 char title>", "body_markdown": "<markdown body>"}`,
  "```",
  "",
  "Skip the block when in doubt. The body must be valid JSON on a single physical block.",
].join("\n");

export async function* runChat(opts: {
  workspaceId: string;
  scope: RetrievalScope;
  ragMode: RagMode;
  chips: RetrievalChip[];
  history: ChatMsg[];
  userMessage: string;
  signal?: AbortSignal;
  provider?: LLMProvider;
  mode?: ChatMode;
  now?: Date;
  locale?: string;
  timezone?: string;
}): AsyncGenerator<ChatChunk> {
  const provider = opts.provider ?? getGeminiProvider();
  const policy = selectChatRuntimePolicy({
    mode: opts.mode ?? "auto",
    userMessage: opts.userMessage,
  });
  const runtimeContext = buildRuntimeContext({
    now: opts.now,
    locale: opts.locale,
    timezone: opts.timezone,
  });

  // try/finally guarantees `done` always fires on natural completion AND
  // when the body throws. The `error` chunk in the catch is the signal
  // for "render failure" before close. Note: when the caller invokes
  // gen.return() to early-close, the finally still runs but the yielded
  // chunks are discarded — standard generator semantics.
  try {
    yield { type: "status", payload: { phrase: "관련 문서 훑는 중..." } };

    const hits =
      opts.ragMode === "off"
        ? []
        : await retrieve({
            workspaceId: opts.workspaceId,
            query: opts.userMessage,
            ragMode: opts.ragMode,
            scope: opts.scope,
            chips: opts.chips,
            signal: opts.signal,
          });

    // retrieve() does not check the signal itself; if the user already
    // aborted by the time the embedding+search fanout returns, skip the
    // LLM call so we don't burn tokens.
    if (opts.signal?.aborted) {
      throw new DOMException("aborted", "AbortError");
    }

    // Emit citations up-front. The renderer reconciles [^N] markers in the
    // generated text against this ordered list.
    const candidates = hits.map((hit, index) =>
      candidateFromRetrievalHit(hit, index),
    );
    const evidenceBundle = packEvidence({
      candidates,
      maxTokens: envInt("CHAT_CONTEXT_MAX_TOKENS", 6000),
    });

    const citations: Citation[] = evidenceBundle.items.map((item) => ({
      source_type: "note",
      source_id: item.noteId,
      snippet: item.snippet,
    }));
    for (const c of citations) yield { type: "citation", payload: c };

    if (policy.externalGroundingRequired && citations.length === 0) {
      yield {
        type: "error",
        payload: {
          code: "grounding_required",
          messageKey: "chat.errors.groundingRequired",
          message: groundingRequiredMessage(opts.locale),
        },
      };
      return;
    }

    // Build the prompt. RAG context block lives in the system message so it
    // doesn't burn through the user-history truncation budget below.
    const ragBlock = evidenceBundleToPrompt(evidenceBundle);
    const system: ChatMsg = {
      role: "system",
      content: [SYSTEM_PROMPT, runtimeContext, ragBlock].filter(Boolean).join("\n\n"),
    };

    const history = truncateHistory(opts.history);
    const messages: ChatMsg[] = [
      system,
      ...history,
      { role: "user", content: opts.userMessage },
    ];

    yield {
      type: "thought",
      payload: { summary: "사용자의 질문 분석 중" },
    };

    const buffer: string[] = [];
    let usage: Usage | null = null;
    for await (const chunk of provider.streamGenerate({
      messages,
      signal: opts.signal,
      maxOutputTokens: envInt("CHAT_MAX_OUTPUT_TOKENS", 2048),
      thinkingLevel: policy.thinkingLevel,
    })) {
      if ("delta" in chunk) {
        buffer.push(chunk.delta);
        yield { type: "text", payload: { delta: chunk.delta } };
      } else if ("usage" in chunk) {
        usage = chunk.usage;
      }
    }

    // Save-suggestion fence is parsed once at the end (system prompt asks
    // for at most one). The fence text was already yielded as part of the
    // text deltas; the renderer strips unrecognized fences itself.
    const full = buffer.join("");
    const suggestion = extractSaveSuggestion(full);
    if (suggestion) {
      yield { type: "save_suggestion", payload: suggestion };
    }

    if (usage) yield { type: "usage", payload: usage };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code =
      err instanceof Error && "code" in err
        ? String((err as { code: unknown }).code)
        : undefined;
    yield {
      type: "error",
      payload: { message, ...(code ? { code } : {}) },
    };
  } finally {
    yield { type: "done", payload: {} };
  }
}

// Drop oldest user/assistant turns until the rough character budget for
// history fits under CHAT_MAX_INPUT_TOKENS. Crude but bounded — billing
// uses the provider-reported usage, not this estimate.
function truncateHistory(history: ChatMsg[]): ChatMsg[] {
  const maxTurns = envInt("CHAT_MAX_HISTORY_TURNS", 12);
  const maxTokens = envInt("CHAT_MAX_INPUT_TOKENS", 32000);
  let kept = history.slice(-maxTurns);

  const estimate = (msgs: ChatMsg[]) =>
    Math.ceil(msgs.reduce((n, m) => n + m.content.length, 0) / 3.5);

  while (kept.length > 0 && estimate(kept) > maxTokens) {
    kept = kept.slice(1);
  }
  return kept;
}

function groundingRequiredMessage(locale?: string): string {
  if (locale === "en") {
    return "This question needs current verified sources, but no grounding source is connected. No answer was generated.";
  }
  return "최신 정보가 필요한 질문이라 확인 가능한 근거가 필요합니다. 현재 연결된 검색 근거가 없어 답변을 생성하지 않았습니다.";
}
