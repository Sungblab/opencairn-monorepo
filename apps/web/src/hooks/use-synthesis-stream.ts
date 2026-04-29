"use client";
import { useEffect, useReducer } from "react";
import type { SynthesisStreamEvent } from "@opencairn/shared";

export type SynthesisStatus =
  | "queued"
  | "running"
  | "fetching"
  | "synthesizing"
  | "compiling"
  | "done"
  | "error";

export interface SynthesisStreamState {
  status: SynthesisStatus;
  sourceCount: number;
  tokensUsed: number;
  docUrl: string | null;
  format: string | null;
  errorCode: string | null;
}

const INITIAL_STATE: SynthesisStreamState = {
  status: "queued",
  sourceCount: 0,
  tokensUsed: 0,
  docUrl: null,
  format: null,
  errorCode: null,
};

type Action =
  | { type: "EVENT"; event: SynthesisStreamEvent }
  | { type: "NETWORK_ERROR" };

function reducer(
  state: SynthesisStreamState,
  action: Action,
): SynthesisStreamState {
  if (action.type === "NETWORK_ERROR") {
    return {
      ...state,
      status: "error",
      errorCode: state.errorCode ?? "stream_error",
    };
  }

  const ev = action.event;
  switch (ev.kind) {
    case "queued":
      return { ...state, status: "running" };
    case "fetching_sources":
      return { ...state, status: "fetching", sourceCount: ev.count };
    case "synthesizing":
      return { ...state, status: "synthesizing" };
    case "compiling":
      return { ...state, status: "compiling", format: ev.format };
    case "done":
      return {
        ...state,
        status: "done",
        docUrl: ev.docUrl,
        format: ev.format,
        sourceCount: ev.sourceCount,
        tokensUsed: ev.tokensUsed,
      };
    case "error":
      return { ...state, status: "error", errorCode: ev.code };
    default:
      return state;
  }
}

// Subscribes to /api/synthesis-export/runs/:id/stream and returns a state
// object representing the current run progress. The EventSource is closed on
// terminal events (done | error) to free the connection. Re-initialises to
// the "queued" baseline whenever runId changes. SSR-safe: short-circuits when
// `EventSource` is undefined.
export function useSynthesisStream(
  runId: string | null,
): SynthesisStreamState {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  useEffect(() => {
    if (!runId) return;
    if (typeof EventSource === "undefined") return;

    const es = new EventSource(
      `/api/synthesis-export/runs/${encodeURIComponent(runId)}/stream`,
    );

    es.onmessage = (msg) => {
      let parsed: SynthesisStreamEvent;
      try {
        parsed = JSON.parse(msg.data) as SynthesisStreamEvent;
      } catch {
        return;
      }

      dispatch({ type: "EVENT", event: parsed });

      if (parsed.kind === "done" || parsed.kind === "error") {
        es.close();
      }
    };

    es.onerror = () => {
      dispatch({ type: "NETWORK_ERROR" });
      es.close();
    };

    return () => {
      es.close();
    };
  }, [runId]);

  return state;
}
