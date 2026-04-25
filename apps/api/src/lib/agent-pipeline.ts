// Stub agent pipeline used by POST /api/threads/:id/messages while the real
// runtime + multi-LLM wiring (Plan 11A / Plan 12 follow-up) is still being
// designed. The shape of `runAgent` (an async generator yielding typed
// chunks) and the create/finalize helpers around it are picked so the
// real pipeline can be slotted in without changing the SSE route.
//
// See docs/superpowers/plans/2026-04-23-app-shell-phase-4-agent-panel.md
// (Task 3 / §13.2) for the long-term plan.

import { db, chatMessages, eq } from "@opencairn/db";

export type AgentChunkType =
  | "status"
  | "thought"
  | "text"
  | "citation"
  | "save_suggestion"
  | "done";

export interface AgentChunk {
  type: AgentChunkType;
  payload: unknown;
}

export type ChatMode = "auto" | "fast" | "balanced" | "accurate" | "research";

// Async generator so the SSE route can `for await` chunks and forward each
// one to the client without buffering the whole response. The real
// implementation will replace the body of this function with a call into
// the agent-runtime; the chunk shape stays.
export async function* runAgent(opts: {
  threadId: string;
  userMessage: { content: string; scope?: unknown };
  mode: ChatMode;
}): AsyncGenerator<AgentChunk> {
  yield { type: "status", payload: { phrase: "관련 문서 훑는 중..." } };
  yield {
    type: "thought",
    payload: { summary: "사용자의 질문 분석 중", tokens: 120 },
  };

  // Stub body — real pipeline (packages/llm + agent-runtime) wired in a
  // follow-up. Plan §13.2 of the spec tracks this.
  const body = `(stub agent response to: ${opts.userMessage.content})`;
  for (const ch of body) {
    yield { type: "text", payload: { delta: ch } };
    // Tiny delay so streaming is observable in dev tooling without making
    // tests slow. ~4ms per char × ~50 chars = ~200ms; fine for vitest.
    await new Promise((r) => setTimeout(r, 4));
  }
  yield { type: "done", payload: {} };
}

// Insert an empty agent row with status='streaming' before SSE begins so a
// mid-stream crash leaves a recoverable row instead of silently losing the
// turn. The single final UPDATE in a `finally` keeps write amplification
// bounded — we don't touch the row per chunk.
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
    })
    .returning({ id: chatMessages.id });
  return row;
}

// Single UPDATE at the end of the stream — content holds the joined buffer
// plus any sidecar metadata (status phrase, thoughts, citations, save
// suggestion). Status flips to 'complete' on a clean stream, 'failed' if
// the pipeline threw mid-flight.
export async function finalizeAgentMessage(
  messageId: string,
  content: object,
  status: "complete" | "failed",
) {
  const [row] = await db
    .update(chatMessages)
    .set({ content, status })
    .where(eq(chatMessages.id, messageId))
    .returning();
  return row;
}
