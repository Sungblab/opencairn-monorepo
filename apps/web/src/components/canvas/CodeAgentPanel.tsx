"use client";

// Plan 7 Canvas Phase 2 — Code Agent prompt + apply panel.
//
// The panel is dumb on purpose: SSE state lives in the parent
// (`canvas-viewer.tsx`) via `useCodeAgentStream`. Here we just render the
// right strip given the latest stream state, and POST `/api/code/run` when
// the user submits a prompt. Apply / Discard surface back through the
// `onApply` parent callback — the parent owns whether the editor source
// gets replaced or thrown away.

import { useState } from "react";
import { useTranslations } from "next-intl";
import type {
  CanvasLanguage,
  CodeAgentTurn,
} from "@opencairn/shared";
import { codeApi } from "@/lib/api-client-code";

const MAX_TURNS = 4;

export type CodeAgentRunResult = {
  status: "queued" | "running" | "awaiting_feedback" | "done" | "error";
  turns: CodeAgentTurn[];
  doneStatus?: string;
  errorCode?: string;
};

type Props = {
  noteId: string;
  language: CanvasLanguage;
  runResult: CodeAgentRunResult | null;
  onApply: (source: string) => void;
  onStart?: (runId: string) => void;
};

export function CodeAgentPanel({
  noteId,
  language,
  runResult,
  onApply,
  onStart,
}: Props) {
  const t = useTranslations("canvas");
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const status = runResult?.status;
  const isRunning = status === "running" || status === "queued";
  const isAwaiting = status === "awaiting_feedback";
  const lastTurn = runResult?.turns?.[runResult.turns.length - 1];

  async function handleSubmit() {
    if (!prompt.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await codeApi.startRun({
        noteId,
        prompt: prompt.trim(),
        language,
      });
      onStart?.(res.runId);
      setPrompt("");
    } finally {
      setSubmitting(false);
    }
  }

  function handleApply() {
    if (lastTurn) onApply(lastTurn.source);
  }

  function handleDiscard() {
    // Parent owns the runId; discarding here is just a UI no-op that
    // signals "don't apply". The next prompt submit creates a new run.
    onApply("");
  }

  return (
    <div
      className="rounded-xl border bg-background p-3 space-y-2"
      data-testid="code-agent-panel"
    >
      <div className="text-sm font-medium">{t("agent.title")}</div>

      {isRunning ? (
        <div className="text-xs text-muted-foreground" data-testid="agent-running">
          {t("agent.running")}
        </div>
      ) : isAwaiting && lastTurn ? (
        <div className="space-y-2">
          <pre
            className="text-xs whitespace-pre-wrap font-mono max-h-40 overflow-auto rounded border bg-muted p-2"
            data-testid="agent-preview"
          >
            {lastTurn.source}
          </pre>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleApply}
              className="px-3 py-1 rounded bg-primary text-primary-foreground text-sm"
              data-testid="agent-apply"
            >
              {t("agent.apply")}
            </button>
            <button
              type="button"
              onClick={handleDiscard}
              className="px-3 py-1 rounded border text-sm"
              data-testid="agent-discard"
            >
              {t("agent.discard")}
            </button>
            <span
              className="ml-auto text-xs text-muted-foreground"
              data-testid="agent-turns"
            >
              {t("agent.turnsCount", {
                current: runResult!.turns.length,
                max: MAX_TURNS,
              })}
            </span>
          </div>
        </div>
      ) : status === "done" ? (
        <div className="text-xs text-muted-foreground" data-testid="agent-done">
          {runResult?.doneStatus === "max_turns"
            ? t("agent.maxTurnsReached")
            : runResult?.doneStatus === "abandoned"
              ? t("agent.abandoned")
              : runResult?.doneStatus === "cancelled"
                ? t("agent.cancelled")
                : t("viewer.save.saved")}
        </div>
      ) : (
        <>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t("agent.placeholder")}
            className="w-full rounded border p-2 text-sm min-h-20"
            data-testid="agent-prompt"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!prompt.trim() || submitting}
              className="px-3 py-1 rounded bg-primary text-primary-foreground text-sm disabled:opacity-50"
              data-testid="agent-run"
            >
              {t("agent.run")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
