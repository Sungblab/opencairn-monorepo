"use client";

// Plan 11B Phase A — DocEditor SSE consumer hook.
//
// Wraps `runDocEditorCommand` into a small state machine the slash-menu
// pipeline can drive: idle → running → ready (or error). On every new
// `run` we abort the previous in-flight fetch so two slash invocations
// can never interleave their results into the same diff sheet.
//
// State stays minimal on purpose — InlineDiffSheet renders directly from
// the `ready.payload` hunks; transient `delta` text events are ignored
// until Phase B layers in a streaming preview.

import { useCallback, useRef, useState } from "react";
import type {
  DocEditorCommand,
  DocEditorRequest,
  DocEditorDiffPayload,
} from "@opencairn/shared";
import { runDocEditorCommand } from "@/lib/api-client-doc-editor";

export type DocEditorCost = {
  tokens_in: number;
  tokens_out: number;
  cost_krw: number;
};

export type DocEditorState =
  | { status: "idle" }
  | { status: "running" }
  | {
      status: "ready";
      payload: DocEditorDiffPayload;
      cost: DocEditorCost;
    }
  | { status: "error"; code: string; message: string };

export function useDocEditorCommand() {
  const [state, setState] = useState<DocEditorState>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(
    async (
      noteId: string,
      command: DocEditorCommand,
      body: DocEditorRequest,
    ) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setState({ status: "running" });

      let payload: DocEditorDiffPayload | null = null;
      let cost: DocEditorCost = { tokens_in: 0, tokens_out: 0, cost_krw: 0 };
      try {
        for await (const ev of runDocEditorCommand(
          noteId,
          command,
          body,
          ac.signal,
        )) {
          // A newer `run` superseded us — drop everything; the new run owns
          // state from here.
          if (abortRef.current !== ac) return;
          if (ev.type === "doc_editor_result") payload = ev.payload;
          else if (ev.type === "cost") {
            cost = {
              tokens_in: ev.tokens_in,
              tokens_out: ev.tokens_out,
              cost_krw: ev.cost_krw,
            };
          } else if (ev.type === "error") {
            setState({ status: "error", code: ev.code, message: ev.message });
            return;
          }
          // `delta` and `done` are intentionally not surfaced — `done` just
          // closes the stream, and Phase A doesn't render token-by-token
          // previews.
        }
        if (abortRef.current !== ac) return;
        if (payload) {
          setState({ status: "ready", payload, cost });
        } else {
          setState({
            status: "error",
            code: "internal",
            message: "no_result",
          });
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setState({
          status: "error",
          code: "internal",
          message: err instanceof Error ? err.message : "unknown",
        });
      }
    },
    [],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState({ status: "idle" });
  }, []);

  return { state, run, reset };
}
