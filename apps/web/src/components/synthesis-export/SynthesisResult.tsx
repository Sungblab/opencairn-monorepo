"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
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

export function SynthesisResult({ runId, state, onResynthesize }: Props) {
  const t = useTranslations("synthesisExport");

  if (state.status !== "done" || !state.format) {
    return null;
  }

  const href = `/api/synthesis-export/runs/${runId}/document?format=${state.format}`;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-neutral-600 dark:text-neutral-300">
        {t("result.summary", {
          count: state.sourceCount,
          tokens: state.tokensUsed,
        })}
      </p>

      <a
        href={href}
        download
        className="inline-flex items-center gap-1 rounded bg-neutral-900 px-3 py-2 text-sm text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
      >
        {t(downloadKey(state.format))}
      </a>

      <ResynthesizeBox
        onSubmit={onResynthesize}
        placeholder={t("panel.placeholder")}
        submitLabel={t("panel.resynthesize")}
      />
    </div>
  );
}
