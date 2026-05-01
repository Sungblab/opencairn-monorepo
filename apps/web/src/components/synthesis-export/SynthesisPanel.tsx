"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  synthesisFormatValues,
  synthesisTemplateValues,
} from "@opencairn/shared";
import { FormatSelector } from "./FormatSelector";
import { SourcePicker, type PickedSource } from "./SourcePicker";
import { TokenBudgetBar } from "./TokenBudgetBar";
import { SynthesisProgress } from "./SynthesisProgress";
import { SynthesisResult } from "./SynthesisResult";
import { useSynthesisStream } from "../../hooks/use-synthesis-stream";

type Format = (typeof synthesisFormatValues)[number];
type Template = (typeof synthesisTemplateValues)[number];

const TOKEN_BUDGET = 180_000;

export interface SynthesisPanelProps {
  workspaceId: string;
  projectId: string | null;
}

export function SynthesisPanel({ workspaceId, projectId }: SynthesisPanelProps) {
  const t = useTranslations("synthesisExport");

  const [format, setFormat] = useState<Format>("latex");
  const [template, setTemplate] = useState<Template>("ieee");
  const [sources, setSources] = useState<PickedSource[]>([]);
  const [autoSearch, setAutoSearch] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const state = useSynthesisStream(runId);

  const tokenEstimate = sources.length * 5_000;

  const isDisabled =
    submitting ||
    prompt.trim() === "" ||
    (sources.length === 0 && !autoSearch);

  async function start(promptText: string) {
    setSubmitting(true);
    try {
      const explicitSourceIds = sources
        .filter((s) => s.kind === "s3_object")
        .map((s) => s.id);
      const noteIds = sources
        .filter((s) => s.kind === "note")
        .map((s) => s.id);

      const res = await fetch("/api/synthesis-export/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          projectId,
          format,
          template,
          userPrompt: promptText,
          explicitSourceIds,
          noteIds,
          autoSearch,
        }),
      });

      if (!res.ok) {
        console.error("SynthesisPanel: run failed", res.status);
        return;
      }

      const body = (await res.json()) as { runId: string };
      setRunId(body.runId);
    } finally {
      setSubmitting(false);
    }
  }

  async function resynthesize(p: string) {
    if (!runId) return;
    const res = await fetch(
      `/api/synthesis-export/runs/${runId}/resynthesize`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userPrompt: p }),
      },
    );

    if (!res.ok) {
      console.error("SynthesisPanel: resynthesize failed", res.status);
      return;
    }

    const body = (await res.json()) as { runId: string };
    setRunId(body.runId);
  }

  function handleRemoveSource(id: string) {
    setSources((prev) => prev.filter((s) => s.id !== id));
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
        {t("panel.title")}
      </h1>

      <FormatSelector
        format={format}
        template={template}
        onFormatChange={setFormat}
        onTemplateChange={setTemplate}
      />

      <SourcePicker
        workspaceId={workspaceId}
        sources={sources}
        autoSearch={autoSearch}
        onAddSource={(source) =>
          setSources((prev) =>
            prev.some((item) => item.id === source.id)
              ? prev
              : [...prev, source],
          )
        }
        onRemoveSource={handleRemoveSource}
        onAutoSearchChange={setAutoSearch}
      />

      <TokenBudgetBar used={tokenEstimate} budget={TOKEN_BUDGET} />

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={t("panel.placeholder")}
        rows={4}
        className="w-full rounded border border-neutral-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
      />

      <button
        type="button"
        disabled={isDisabled}
        onClick={() => start(prompt.trim())}
        className="self-start rounded bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
      >
        {t("panel.start")}
      </button>

      {runId && <SynthesisProgress state={state} />}

      {runId && state.status === "done" && (
        <SynthesisResult
          runId={runId}
          state={state}
          onResynthesize={resynthesize}
        />
      )}
    </div>
  );
}
