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
  DocEditorCommentPayload,
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
      outputMode: "diff";
      payload: DocEditorDiffPayload;
      cost: DocEditorCost;
    }
  | {
      status: "ready";
      outputMode: "comment";
      payload: DocEditorCommentPayload;
      commentIds: string[];
      toolCallCount: number;
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

      let diffPayload: DocEditorDiffPayload | null = null;
      let commentPayload: DocEditorCommentPayload | null = null;
      let commentIds: string[] = [];
      let toolCallCount = 0;
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
          if (ev.type === "doc_editor_result") {
            if (ev.output_mode === "comment") {
              commentPayload = ev.payload as DocEditorCommentPayload;
            } else {
              diffPayload = ev.payload as DocEditorDiffPayload;
            }
          } else if (ev.type === "factcheck_comments_inserted") {
            commentIds = ev.commentIds;
          } else if (ev.type === "tool_progress") {
            toolCallCount = ev.callCount;
            setState({ status: "running" });
          } else if (ev.type === "cost") {
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
        if (commentPayload) {
          setState({
            status: "ready",
            outputMode: "comment",
            payload: commentPayload,
            commentIds,
            toolCallCount,
            cost,
          });
        } else if (diffPayload) {
          setState({
            status: "ready",
            outputMode: "diff",
            payload: diffPayload,
            cost,
          });
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
