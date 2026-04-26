"use client";

// SSE consumer for the natural-language → ViewSpec endpoint at
// `/api/visualize`. The endpoint emits a fixed event vocabulary:
//   - `tool_use`    : agent invoked a tool (search_concepts, get_neighbors, ...)
//   - `tool_result` : tool returned (with `ok: boolean`)
//   - `view_spec`   : the final spec; payload `{ viewSpec: ViewSpec }`
//   - `error`       : `{ error: string, messageKey?: string }`
//   - `done`        : terminator (always last)
//
// We can't use EventSource (POST + JSON body), so this mirrors the pattern
// in `use-chat-send.ts`: fetch + manual frame parsing via
// `parseSseChunks`. State is intentionally split into four buckets so the
// dialog can render progress as it streams without re-running the request.
//
// `cancel()` aborts an in-flight fetch via AbortController so the dialog's
// X / "닫기" never leaves a zombie stream consuming concurrency budget on the
// worker. Each `submit()` call resets the four state slots first so a retry
// after an error starts from a clean slate.

import { useCallback, useRef, useState } from "react";
import type { ViewSpec, ViewType } from "@opencairn/shared";
import { parseSseChunks, type SseEvent } from "./sse-parser";

export interface ProgressEvent {
  event: "tool_use" | "tool_result";
  payload: Record<string, unknown>;
}

export interface SubmitArgs {
  projectId: string;
  prompt: string;
  viewType?: ViewType;
}

export interface UseVisualizeMutation {
  submit: (args: SubmitArgs) => Promise<void>;
  cancel: () => void;
  progress: ProgressEvent[];
  viewSpec: ViewSpec | null;
  error: string | null;
  submitting: boolean;
}

export function useVisualizeMutation(): UseVisualizeMutation {
  const [progress, setProgress] = useState<ProgressEvent[]>([]);
  const [viewSpec, setViewSpec] = useState<ViewSpec | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const submit = useCallback(async (args: SubmitArgs) => {
    // Reset on every submit so retries don't see stale progress / errors.
    setProgress([]);
    setViewSpec(null);
    setError(null);
    setSubmitting(true);

    // Replace any previous controller so back-to-back submits don't leak.
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const resp = await fetch("/api/visualize", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify(args),
        signal: ac.signal,
      });

      if (!resp.ok) {
        // 429 = the per-user concurrency lock; everything else is an opaque
        // failure for the dialog. Both keys are translated by graph.errors.
        const code = resp.status === 429 ? "concurrent-visualize" : "visualizeFailed";
        setError(code);
        return;
      }
      if (!resp.body) {
        setError("visualizeFailed");
        return;
      }

      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = "";

      // We exit either when the stream ends (`done` flag from reader) or when
      // an `error` event arrives — `done` is purely a terminator from the
      // server side and doesn't add anything to UI state.
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const { events, remainder } = parseSseChunks(buf);
        buf = remainder;
        for (const ev of events) handleEvent(ev);
      }
    } catch (e) {
      // AbortError is expected when the user clicks cancel — silently
      // dismiss it so the dialog can close without flashing an error.
      if ((e as Error).name === "AbortError") return;
      setError("visualizeFailed");
    } finally {
      setSubmitting(false);
    }

    function handleEvent(ev: SseEvent) {
      if (ev.event === "tool_use" || ev.event === "tool_result") {
        setProgress((prev) => [
          ...prev,
          {
            event: ev.event as ProgressEvent["event"],
            payload: (ev.data as Record<string, unknown>) ?? {},
          },
        ]);
        return;
      }
      if (ev.event === "view_spec") {
        const data = ev.data as { viewSpec?: ViewSpec } | null;
        if (data?.viewSpec) setViewSpec(data.viewSpec);
        return;
      }
      if (ev.event === "error") {
        const data = ev.data as { error?: string } | null;
        setError(data?.error ?? "visualizeFailed");
        return;
      }
      // Other events (e.g. `done`) are intentionally ignored — the loop
      // exits when the reader signals `done` regardless.
    }
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { submit, cancel, progress, viewSpec, error, submitting };
}
