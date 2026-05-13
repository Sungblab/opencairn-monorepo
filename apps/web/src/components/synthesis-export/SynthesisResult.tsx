"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { FilePlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { AgentFileSummary } from "@opencairn/shared";
import { openOriginalFileTab } from "@/components/ingest/open-original-file-tab";
import type { SynthesisStreamState } from "../../hooks/use-synthesis-stream";

interface ResynthesizeBoxProps {
  onSubmit: (prompt: string) => void;
  placeholder: string;
  submitLabel: string;
}

function ResynthesizeBox({
  onSubmit,
  placeholder,
  submitLabel,
}: ResynthesizeBoxProps) {
  const [text, setText] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = text.trim();
        if (trimmed) {
          onSubmit(trimmed);
          setText("");
        }
      }}
      className="flex flex-col gap-2"
    >
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400 dark:border-neutral-700 dark:bg-neutral-900"
      />
      <button
        type="submit"
        className="self-end rounded bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
      >
        {submitLabel}
      </button>
    </form>
  );
}

interface Props {
  runId: string;
  state: SynthesisStreamState;
  onResynthesize: (prompt: string) => void;
}

function downloadKey(format: string): string {
  if (format === "latex") return "download.tex";
  return `download.${format}`;
}

interface PublishResponse {
  file: AgentFileSummary;
}

export function SynthesisResult({ runId, state, onResynthesize }: Props) {
  const t = useTranslations("synthesisExport");
  const [publishing, setPublishing] = useState(false);

  if (state.status !== "done" || !state.format) {
    return null;
  }

  const encodedRunId = encodeURIComponent(runId);
  const encodedFormat = encodeURIComponent(state.format);
  const href = `/api/synthesis-export/runs/${encodedRunId}/document?format=${encodedFormat}`;

  async function publishToProject() {
    if (!state.format || publishing) return;
    setPublishing(true);
    try {
      const res = await fetch(
        `/api/synthesis-export/runs/${encodedRunId}/project-object`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ format: state.format }),
        },
      );
      if (!res.ok) {
        toast.error(t("result.addFailed"));
        return;
      }

      const body = (await res.json()) as PublishResponse;
      const file = body.file;
      openOriginalFileTab(file.id, file.title);
      toast.success(t("result.added"));
    } catch {
      toast.error(t("result.addFailed"));
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-neutral-600 dark:text-neutral-300">
        {t("result.summary", {
          count: state.sourceCount,
          tokens: state.tokensUsed,
        })}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <a
          href={href}
          download
          className="inline-flex items-center gap-1 rounded bg-neutral-900 px-3 py-2 text-sm text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          {t(downloadKey(state.format))}
        </a>
        <button
          type="button"
          disabled={publishing}
          onClick={publishToProject}
          className="inline-flex items-center gap-1 rounded border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
        >
          {publishing ? (
            <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          ) : (
            <FilePlus aria-hidden className="h-4 w-4" />
          )}
          {publishing ? t("result.adding") : t("result.addToProject")}
        </button>
      </div>

      <ResynthesizeBox
        onSubmit={onResynthesize}
        placeholder={t("panel.placeholder")}
        submitLabel={t("panel.resynthesize")}
      />
    </div>
  );
}
