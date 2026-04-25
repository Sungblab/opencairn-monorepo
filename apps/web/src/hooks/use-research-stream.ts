"use client";
import { useEffect, useRef } from "react";
import type { ResearchStreamEvent } from "@opencairn/shared";

// Subscribes to /api/research/runs/:id/stream for the lifetime of the hook.
// `onEvent` is called from the EventSource message handler — keep it light;
// the API ticks at ~2s and a heavy handler will lag the UI. Returning a
// closure (rather than state) keeps re-renders out of the wire path.
//
// Re-creates the EventSource on runId change. SSR-safe: short-circuits when
// `EventSource` is undefined (no-op on server pre-hydration).
export function useResearchStream(
  runId: string | null,
  onEvent: (ev: ResearchStreamEvent) => void,
): void {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (!runId) return;
    if (typeof EventSource === "undefined") return;
    const es = new EventSource(`/api/research/runs/${runId}/stream`);
    es.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data) as ResearchStreamEvent;
        handlerRef.current(parsed);
      } catch {
        // Server is supposed to emit valid JSON. Swallow rather than crash
        // the UI — the polling tick will resync state on the next event.
      }
    };
    return () => {
      es.close();
    };
  }, [runId]);
}
