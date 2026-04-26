"use client";

// Plan 7 Canvas Phase 2 — React hook for the CodeAgent SSE stream.
//
// Mirrors the contract of /api/code/runs/:runId/stream documented in
// `apps/api/src/routes/code.ts`. The server emits a small set of `kind`-tagged
// events (`queued`, `turn_complete`, `awaiting_feedback`, `done`, `error`)
// plus placeholder `thought`/`token` events that we reserve for future
// streaming UX. We render terminal status into local state and let the
// browser's EventSource handle the transport-level reconnect.

import { useEffect, useState } from "react";
import type { CodeAgentEvent, CodeAgentTurn } from "@opencairn/shared";

export type CodeAgentStreamStatus =
  | "queued"
  | "running"
  | "awaiting_feedback"
  | "done"
  | "error";

export type CodeAgentDoneStatus =
  | "completed"
  | "max_turns"
  | "cancelled"
  | "abandoned";

export interface CodeAgentStreamState {
  status: CodeAgentStreamStatus;
  turns: CodeAgentTurn[];
  doneStatus: CodeAgentDoneStatus | null;
  errorCode: string | null;
}

export function useCodeAgentStream(runId: string | null): CodeAgentStreamState {
  const [status, setStatus] = useState<CodeAgentStreamStatus>("queued");
  const [turns, setTurns] = useState<CodeAgentTurn[]>([]);
  const [doneStatus, setDoneStatus] = useState<CodeAgentDoneStatus | null>(
    null,
  );
  const [errorCode, setErrorCode] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) return;
    // Reset state whenever the runId changes — the parent might be reusing
    // the hook across runs and we don't want stale turns leaking through.
    setStatus("queued");
    setTurns([]);
    setDoneStatus(null);
    setErrorCode(null);

    const es = new EventSource(
      `/api/code/runs/${encodeURIComponent(runId)}/stream`,
    );

    es.onmessage = (ev) => {
      let data: CodeAgentEvent;
      try {
        data = JSON.parse(ev.data) as CodeAgentEvent;
      } catch {
        // Malformed event — ignore. The server is the source of truth, and
        // a single bad frame shouldn't tear down the whole stream.
        return;
      }
      switch (data.kind) {
        case "queued":
          setStatus("running");
          break;
        case "turn_complete":
          setTurns((prev) => [...prev, data.turn]);
          break;
        case "awaiting_feedback":
          setStatus("awaiting_feedback");
          break;
        case "done":
          setStatus("done");
          setDoneStatus(data.status);
          es.close();
          break;
        case "error":
          setStatus("error");
          setErrorCode(data.code);
          es.close();
          break;
        // `thought` and `token` are placeholders for future streaming UX.
        // Intentionally ignored today so we don't churn state on every
        // token — see Plan 7 Phase 2 spec § Code Agent SSE.
        case "thought":
        case "token":
          break;
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects on transient transport errors. Treat
      // this fallback as a soft fail — explicit `kind:"error"` payloads
      // are already handled in onmessage above.
      setStatus("error");
      es.close();
    };

    return () => es.close();
  }, [runId]);

  return { status, turns, doneStatus, errorCode };
}
