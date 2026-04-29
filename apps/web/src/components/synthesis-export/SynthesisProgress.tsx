"use client";

import { useTranslations } from "next-intl";
import type { SynthesisStreamState } from "../../hooks/use-synthesis-stream";

interface Props {
  state: SynthesisStreamState;
}

const RUNNING_STATUSES = new Set([
  "queued",
  "running",
  "fetching",
  "synthesizing",
  "compiling",
]);

function statusKey(status: SynthesisStreamState["status"]): string {
  switch (status) {
    case "fetching":
      return "status.fetching";
    case "synthesizing":
      return "status.synthesizing";
    case "compiling":
      return "status.compiling";
    case "done":
      return "status.completed";
    case "error":
      return "status.failed";
    default:
      return "status.pending";
  }
}

export function SynthesisProgress({ state }: Props) {
  const t = useTranslations("synthesisExport");
  const isRunning = RUNNING_STATUSES.has(state.status);
  const key = statusKey(state.status);

  return (
    <div className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
      {isRunning && (
        <span
          aria-hidden="true"
          className="inline-block h-2 w-2 animate-pulse rounded-full bg-neutral-400"
        />
      )}
      <span>
        {t(key)}
        {state.status === "fetching" && ` · ${state.sourceCount}`}
      </span>
    </div>
  );
}
