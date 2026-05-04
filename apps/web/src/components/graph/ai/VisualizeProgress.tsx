"use client";

// Streaming-progress feed for the VisualizeDialog. Each entry is one
// SSE frame (tool_use or tool_result) — we reduce that into a one-line
// summary using the friendly label from `graph.ai.progress.<tool>`,
// falling back to the raw tool name if the locale doesn't have a key
// yet (a fresh tool can land before i18n catches up — Task 27 gap).

import { useTranslations } from "next-intl";
import { AlertTriangle, CheckCircle2, ChevronRight } from "lucide-react";
import type { ProgressEvent } from "./useVisualizeMutation";

export function VisualizeProgress({ events }: { events: ProgressEvent[] }) {
  const t = useTranslations("graph.ai.progress");
  if (events.length === 0) return null;
  return (
    <ul
      className="mt-3 space-y-1 text-sm text-muted-foreground"
      aria-live="polite"
    >
      {events.map((ev, i) => {
        const name = (ev.payload as { name?: string }).name ?? "";
        const ok = (ev.payload as { ok?: boolean }).ok;
        const label = name && t.has(name) ? t(name) : name || ev.event;
        const Icon =
          ev.event === "tool_use"
            ? ChevronRight
            : ok === false
              ? AlertTriangle
              : CheckCircle2;
        return (
          <li key={i}>
            <Icon aria-hidden="true" className="mr-2 inline h-3.5 w-3.5" />
            {label}
          </li>
        );
      })}
    </ul>
  );
}
