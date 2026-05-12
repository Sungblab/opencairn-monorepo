// Phase 4 agent panel pipeline. Resolves the chat thread's workspace, then
// drives chat-llm.runChat with workspace-scoped RAG defaults and forwards
// every chunk type to the SSE route. The chunk shape (`{type, payload}`)
// matches what apps/web's agent panel reader expects.
//
// Multi-turn history (audit S2-026): prior chat_messages rows are loaded
// in chronological order and forwarded to runChat so the LLM can resolve
// pronouns / callbacks across turns. The route persists the new user row
// and a streaming agent placeholder BEFORE invoking runAgent, so callers
// pass `excludeMessageIds` to skip those two from the loaded history.
// The agent panel still defaults to ragMode='strict' + workspace scope
// because Phase 4 has no per-thread chip/ragMode column yet.

import { db, chatMessages, chatThreads, and, desc, eq, notInArray, sql } from "@opencairn/db";
import { runChat, type ChatChunk } from "./chat-llm";
import { stripAgentDirectiveFences } from "@opencairn/shared";
import type { ChatMode } from "./chat-runtime-policy";
import type { RagMode, RetrievalChip, RetrievalScope } from "./chat-retrieval";
import type { ChatMsg, LLMProvider } from "./llm/provider";
import { envInt } from "./env";
import { tokensToKrw } from "./cost";

export type AgentChunkType =
  | "status"
  | "thought"
  | "text"
  | "citation"
  | "save_suggestion"
  | "agent_action"
  | "agent_file"
  | "verification"
  | "usage"
  | "error"
  | "done";

export interface AgentChunk {
  type: AgentChunkType;
  payload: unknown;
}

export type { ChatMode };

type RawAgentScope = {
  strict?: unknown;
  chips?: unknown;
};

export function resolveAgentRetrievalOptions(opts: {
  workspaceId: string;
  rawScope?: unknown;
  ragMode?: RagMode;
}): {
  scope: RetrievalScope;
  chips: RetrievalChip[];
  ragMode: RagMode;
} {
  const raw = isRecord(opts.rawScope) ? (opts.rawScope as RawAgentScope) : {};
  const chips = Array.isArray(raw.chips)
    ? raw.chips.flatMap((chip) => normalizeRetrievalChip(chip, opts.workspaceId))
    : [];
  return {
    scope: { type: "workspace", workspaceId: opts.workspaceId },
    chips,
    ragMode: opts.ragMode ?? (raw.strict === "loose" ? "expand" : "strict"),
  };
}

export async function* runAgent(opts: {
  threadId: string;
  userId?: string;
  userMessage: { content: string; scope?: unknown };
  mode: ChatMode;
  // Forwarded into runChat so client aborts cancel the underlying Gemini
  // fetch immediately instead of waiting for the next yield boundary.
  signal?: AbortSignal;
  // chat_messages.id values to skip when reconstructing history. Threads.ts
  // passes the just-inserted user row + streaming agent placeholder so the
  // current turn doesn't leak into prior history.
  excludeMessageIds?: string[];
  // Test seam — production callers omit this and runChat falls through to
  // getGeminiProvider(). Tests inject a capturing provider to assert the
  // assembled messages[] without hitting the real Gemini endpoint.
  provider?: LLMProvider;
  // Optional override; defaults to 'strict'. Tests pass 'off' to skip the
  // retrieval embed call (same intent as the real-llm test pattern).
  ragMode?: RagMode;
}): AsyncGenerator<AgentChunk> {
  const [thread] = await db
    .select({ workspaceId: chatThreads.workspaceId })
    .from(chatThreads)
    .where(eq(chatThreads.id, opts.threadId));
  if (!thread) {
    throw new Error(`thread not found: ${opts.threadId}`);
  }
  const workspaceId = thread.workspaceId;

  const history = await loadHistory(opts.threadId, opts.excludeMessageIds ?? []);
  const retrieval = resolveAgentRetrievalOptions({
    workspaceId,
    rawScope: opts.userMessage.scope,
    ragMode: opts.ragMode,
  });

  for await (const chunk of runChat({
    workspaceId,
    userId: opts.userId,
    scope: retrieval.scope,
    ragMode: retrieval.ragMode,
    chips: retrieval.chips,
    history,
    userMessage: opts.userMessage.content,
    signal: opts.signal,
    provider: opts.provider,
    mode: opts.mode,
  })) {
    yield mapChunk(chunk);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeRetrievalChip(
  raw: unknown,
  workspaceId: string,
): RetrievalChip[] {
  if (!isRecord(raw) || typeof raw.id !== "string") return [];
  if (raw.type === "page" || raw.type === "project") {
    return [{ type: raw.type, id: raw.id }];
  }
  if (raw.type === "workspace" && raw.id === workspaceId) {
    return [{ type: "workspace", id: raw.id }];
  }
  return [];
}

// Loads the most recent N completed chat_messages and shapes them into the
// ChatMsg[] runChat expects.
//
// Filters (all SQL-side so LIMIT applies to *viable* rows — without the
// `body` filter, malformed rows in the top-N slice would silently shorten
// the history that reaches the LLM):
//   - status='complete' — skips the streaming agent placeholder the route
//     just inserted, plus any orphaned streaming rows from crashed turns,
//     plus failed rows (partial/garbage bodies from mid-stream provider
//     crashes).
//   - content->>'body' IS NOT NULL AND length > 0 — `->>` returns NULL when
//     the key is absent or the value isn't a string, so this drops legacy
//     rows / future structured payloads / empty replies in one predicate.
//   - id NOT IN excludeIds — caller-supplied current-turn IDs.
//
// Limit binding: env CHAT_MAX_HISTORY_TURNS (default 12) is the same knob
// chat-llm.truncateHistory() reads at runChat time, so the DB cap and the
// in-memory cap stay aligned. Using a separate env name would silently
// override truncateHistory for the agent-panel path only.
async function loadHistory(
  threadId: string,
  excludeIds: string[],
): Promise<ChatMsg[]> {
  const limit = envInt("CHAT_MAX_HISTORY_TURNS", 12);
  if (limit === 0) return [];

  const bodyPresent = sql`length(${chatMessages.content}->>'body') > 0`;
  const filter = excludeIds.length > 0
    ? and(
        eq(chatMessages.threadId, threadId),
        eq(chatMessages.status, "complete"),
        bodyPresent,
        notInArray(chatMessages.id, excludeIds),
      )
    : and(
        eq(chatMessages.threadId, threadId),
        eq(chatMessages.status, "complete"),
        bodyPresent,
      );

  // Pull the newest N then reverse to chronological so the LLM reads the
  // turns in the order they happened. Sorting in SQL is safer than sorting
  // in JS by timestamp because Drizzle returns the timestamp field as Date
  // and tie-breaks across same-millisecond inserts are still index-stable.
  const rows = await db
    .select({
      id: chatMessages.id,
      role: chatMessages.role,
      content: chatMessages.content,
      createdAt: chatMessages.createdAt,
    })
    .from(chatMessages)
    .where(filter)
    .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
    .limit(limit);

  return rows
    .slice()
    .reverse()
    .map((r) => ({
      role: r.role === "user" ? ("user" as const) : ("assistant" as const),
      content: extractBody(r.content),
    }));
}

// Defensive extraction — the SQL filter already guarantees content has a
// non-empty string body, but typeof narrowing for TypeScript still needs
// the runtime check. Returns "" only on impossible-in-prod shapes.
function extractBody(content: unknown): string {
  if (
    content !== null &&
    typeof content === "object" &&
    !Array.isArray(content) &&
    "body" in content
  ) {
    const body = (content as { body: unknown }).body;
    return typeof body === "string" ? body : "";
  }
  return "";
}


function mapChunk(c: ChatChunk): AgentChunk {
  return { type: c.type, payload: c.payload };
}

// Insert an empty agent row with status='streaming' before SSE begins so a
// mid-stream crash leaves a recoverable row instead of silently losing the
// turn. provider='gemini' is set up-front — the only provider currently
// wired in for chat. When packages/llm grows another provider, this becomes
// a runtime decision based on the same env routing chat-llm uses.
export async function createStreamingAgentMessage(
  threadId: string,
  mode: ChatMode,
) {
  const [row] = await db
    .insert(chatMessages)
    .values({
      threadId,
      role: "agent",
      status: "streaming",
      content: { body: "" },
      mode,
      provider: "gemini",
    })
    .returning({ id: chatMessages.id });
  return row;
}

// Single UPDATE at the end of the stream — content holds the joined buffer
// plus any sidecar metadata (status phrase, thoughts, citations, save
// suggestion). When the route accumulated a `usage` chunk, we lift it out
// of `content` into the `token_usage` column and append a placeholder cost
// (KRW). Status flips to 'complete' on a clean stream, 'failed' if the
// pipeline threw or surfaced an `error` chunk.
export async function finalizeAgentMessage(
  messageId: string,
  content: object,
  status: "complete" | "failed",
) {
  const c = content as Record<string, unknown> & {
    usage?: { tokensIn: number; tokensOut: number; model: string };
  };
  const tokenUsage = c.usage
    ? {
        tokensIn: c.usage.tokensIn,
        tokensOut: c.usage.tokensOut,
        model: c.usage.model,
        costKrw: Number(tokensToKrw(c.usage.tokensIn, c.usage.tokensOut)),
      }
    : null;
  // Strip `usage` from persisted content — it lives in the dedicated column.
  const { usage: _drop, ...persistedContent } = c;
  if (typeof persistedContent.body === "string") {
    persistedContent.body = stripAgentDirectiveFences(persistedContent.body);
  }

  const [row] = await db
    .update(chatMessages)
    .set({
      content: persistedContent,
      status,
      ...(tokenUsage ? { tokenUsage } : {}),
    })
    .where(eq(chatMessages.id, messageId))
    .returning();
  return row;
}
