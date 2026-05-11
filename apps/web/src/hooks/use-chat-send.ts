"use client";

// SSE consumer for streaming agent responses. The route POSTs JSON and
// streams `text/event-stream` back, so EventSource (GET-only) is not an
// option — we use fetch + a ReadableStream reader and parse frames with
// `eventsource-parser` (handles CRLF, comment heartbeats, partial frames).
//
// Lifecycle:
//   1. caller invokes `send` -> any prior in-flight fetch is aborted so
//      two assistant turns can never interleave into the same `live`.
//   2. `live` is a transient preview built from incremental SSE events.
//   3. on `done` (or stream end / error) we invalidate the messages query
//      and clear `live` — the persisted rows then drive the conversation,
//      avoiding a double-render of preview + persisted row.

import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { createParser } from "eventsource-parser";

import type { ChatMessage } from "@/lib/api-client";

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

export interface StreamingAgentMessage {
  // null until the SSE `agent_placeholder` arrives — once set, the row
  // exists in DB so any failure leaves a recoverable record.
  id: string | null;
  body: string;
  thought: { summary: string; tokens?: number } | null;
  status: { phrase?: string } | null;
  citations: unknown[];
  save_suggestion: unknown | null;
  agent_files: unknown[];
  agent_actions: unknown[];
  project_objects: unknown[];
  project_object_generations: unknown[];
  // Populated when the route emits `event: error` mid-stream. `done` still
  // arrives separately and triggers the live → null reset; this field lives
  // on the in-flight preview only and is not persisted (the agent row is
  // finalized server-side with status='failed').
  error: { message: string; code?: string } | null;
}

const initialLive: StreamingAgentMessage = {
  id: null,
  body: "",
  thought: null,
  status: null,
  citations: [],
  save_suggestion: null,
  agent_files: [],
  agent_actions: [],
  project_objects: [],
  project_object_generations: [],
  error: null,
};

export interface SendInput {
  content: string;
  scope?: unknown;
  mode?: string;
  threadId?: string;
}

function pendingUserMessage(input: SendInput): ChatMessage {
  return {
    id: `pending-user-${Date.now()}`,
    role: "user",
    status: "complete",
    run_id: null,
    run_status: null,
    content: { body: input.content },
    mode: input.mode ?? "auto",
    provider: null,
    created_at: new Date().toISOString(),
  };
}

export function useChatSend(threadId: string | null) {
  const qc = useQueryClient();
  const t = useTranslations("chat.errors");
  const [live, setLive] = useState<StreamingAgentMessage | null>(null);
  const [pendingUser, setPendingUser] = useState<ChatMessage | null>(null);
  const controller = useRef<AbortController | null>(null);
  const resumedRun = useRef<string | null>(null);

  const consumeStream = useCallback(
    async (res: Response, ac: AbortController, targetThreadId: string) => {
      const parser = createParser({
        onEvent: (ev) => {
          if (!ev.event) return;
          let payload: unknown = null;
          try {
            payload = ev.data ? JSON.parse(ev.data) : null;
          } catch {
            // Malformed frame — skip rather than tear down the whole stream.
            return;
          }
          setLive((prev) => {
            if (!prev) return prev;
            switch (ev.event) {
              case "agent_placeholder":
                return isObj(payload) && typeof payload.id === "string"
                  ? { ...prev, id: payload.id }
                  : prev;
              case "status":
                return isObj(payload)
                  ? { ...prev, status: payload as { phrase?: string } }
                  : prev;
              case "thought":
                return isObj(payload)
                  ? {
                      ...prev,
                      thought: payload as { summary: string; tokens?: number },
                    }
                  : prev;
              case "text":
                return isObj(payload) && typeof payload.delta === "string"
                  ? { ...prev, body: prev.body + payload.delta }
                  : prev;
              case "citation":
                return { ...prev, citations: [...prev.citations, payload] };
              case "save_suggestion":
                return isObj(payload)
                  ? { ...prev, save_suggestion: payload }
                  : prev;
              case "agent_action_created":
                void qc.invalidateQueries({ queryKey: ["agent-actions"] });
                return isObj(payload)
                  ? {
                      ...prev,
                      agent_actions: [
                        ...prev.agent_actions,
                        payload.action ?? payload,
                      ],
                    }
                  : prev;
              case "agent_file_created":
                return isObj(payload)
                  ? {
                      ...prev,
                      agent_files: [
                        ...prev.agent_files,
                        payload.file ?? payload,
                      ],
                    }
                  : prev;
              case "project_object_created":
                return isObj(payload)
                  ? {
                      ...prev,
                      project_objects: [
                        ...prev.project_objects,
                        payload.object ?? payload,
                      ],
                    }
                  : prev;
              case "project_object_generation_requested":
              case "project_object_generation_status":
              case "project_object_generation_completed":
              case "project_object_generation_failed":
                return isObj(payload)
                  ? {
                      ...prev,
                      project_object_generations: [
                        ...prev.project_object_generations,
                        payload,
                      ],
                    }
                  : prev;
              case "error": {
                toast.error(t("streamFailed"));
                const err =
                  isObj(payload) && typeof payload.message === "string"
                    ? {
                        message: payload.message,
                        ...(typeof payload.code === "string"
                          ? { code: payload.code }
                          : {}),
                      }
                    : { message: "stream_failed" };
                return { ...prev, error: err };
              }
              case "done":
                return isObj(payload) && typeof payload.id === "string"
                  ? { ...prev, id: payload.id }
                  : prev;
              default:
                return prev;
            }
          });
        },
      });

      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          parser.feed(decoder.decode(value, { stream: true }));
        }
      } catch {
        // SSE read errors leave live state intact for the next send/resume.
      } finally {
        if (controller.current === ac) {
          await qc.invalidateQueries({
            queryKey: ["chat-messages", targetThreadId],
          });
          setLive(null);
          setPendingUser(null);
          controller.current = null;
          resumedRun.current = null;
        }
      }
    },
    [qc, t],
  );

  const resumeRun = useCallback(
    async (runId: string, messageId: string) => {
      if (!threadId || controller.current || resumedRun.current === runId)
        return;
      resumedRun.current = runId;
      const ac = new AbortController();
      controller.current = ac;
      setPendingUser(null);
      setLive({ ...initialLive, id: messageId });
      const stream = await fetch(`/api/chat-runs/${runId}/events?after=0`, {
        credentials: "include",
        headers: { accept: "text/event-stream" },
        signal: ac.signal,
      });
      if (!stream.ok || !stream.body) {
        setLive(null);
        setPendingUser(null);
        controller.current = null;
        resumedRun.current = null;
        return;
      }
      await consumeStream(stream, ac, threadId);
    },
    [threadId, consumeStream],
  );

  const send = useCallback(
    async (input: SendInput) => {
      const targetThreadId = input.threadId ?? threadId;
      if (!targetThreadId) return;
      // Aborting any in-flight stream guarantees the next send starts from
      // a clean live state (no interleaving of two assistant turns).
      controller.current?.abort();
      const ac = new AbortController();
      controller.current = ac;

      setPendingUser(pendingUserMessage(input));
      setLive({ ...initialLive });

      let res: Response;
      try {
        res = await fetch(`/api/threads/${targetThreadId}/messages`, {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            accept: "text/event-stream",
          },
          body: JSON.stringify({
            content: input.content,
            scope: input.scope,
            mode: input.mode ?? "auto",
          }),
          signal: ac.signal,
        });
      } catch (err) {
        // AbortError fires here when a newer send superseded us before the
        // fetch resolved. Leave `live` as the newer send already set it,
        // and bail without invalidating (the newer send owns invalidation).
        if ((err as Error).name === "AbortError") return;
        setLive(null);
        setPendingUser(null);
        return;
      }

      if (!res.ok || !res.body) {
        setLive(null);
        setPendingUser(null);
        return;
      }

      await consumeStream(res, ac, targetThreadId);
    },
    [threadId, consumeStream],
  );

  return { send, live, pendingUser, resumeRun };
}
