// Phase 4 agent panel pipeline. Resolves the chat thread's workspace, then
// drives chat-llm.runChat with workspace-scoped RAG defaults and forwards
// every chunk type to the SSE route. The chunk shape (`{type, payload}`)
// matches what apps/web's agent panel reader expects, so the SSE contract
// is unchanged from the prior stub.
//
// History reload is out of scope for v1 — the agent panel renders prior
// turns from chat_messages on its own. Multi-turn reasoning over older
// turns is a follow-up (Phase 4 doesn't yet have a per-thread chip/ragMode
// column either; the agent panel UX is "ask anything in the workspace",
// hence ragMode='strict' + scope='workspace').

import { db, chatMessages, chatThreads, eq } from "@opencairn/db";
import { runChat, type ChatChunk } from "./chat-llm";
import { tokensToKrw } from "./cost";

export type AgentChunkType =
  | "status"
  | "thought"
  | "text"
  | "citation"
  | "save_suggestion"
  | "usage"
  | "error"
  | "done";

export interface AgentChunk {
  type: AgentChunkType;
  payload: unknown;
}

export type ChatMode = "auto" | "fast" | "balanced" | "accurate" | "research";

export async function* runAgent(opts: {
  threadId: string;
  userMessage: { content: string; scope?: unknown };
  mode: ChatMode;
  // Forwarded into runChat so client aborts cancel the underlying Gemini
  // fetch immediately instead of waiting for the next yield boundary.
  signal?: AbortSignal;
}): AsyncGenerator<AgentChunk> {
  const [thread] = await db
    .select({ workspaceId: chatThreads.workspaceId })
    .from(chatThreads)
    .where(eq(chatThreads.id, opts.threadId));
  if (!thread) {
    throw new Error(`thread not found: ${opts.threadId}`);
  }
  const workspaceId = thread.workspaceId;

  for await (const chunk of runChat({
    workspaceId,
    scope: { type: "workspace", workspaceId },
    ragMode: "strict",
    chips: [],
    history: [],
    userMessage: opts.userMessage.content,
    signal: opts.signal,
  })) {
    yield mapChunk(chunk);
  }
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
