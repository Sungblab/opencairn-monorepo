"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";

type UpdatedEvent = {
  type: "job.updated";
  status: string;
  total: number;
  completed: number;
  failed: number;
};
type FinishedEvent = { type: "job.finished"; status: string };
type JobEvent = UpdatedEvent | FinishedEvent;

interface JobState {
  status: string;
  total: number;
  completed: number;
  failed: number;
}

export function JobProgress({
  wsSlug,
  jobId,
}: {
  wsSlug: string;
  jobId: string;
}) {
  const t = useTranslations("import");
  const [state, setState] = useState<JobState>({
    status: "queued",
    total: 0,
    completed: 0,
    failed: 0,
  });

  useEffect(() => {
    // EventSource sends cookies by default on same-origin — no extra config
    // needed for the auth gate on /api/import/jobs/:id/events.
    const es = new EventSource(`/api/import/jobs/${jobId}/events`);
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data) as JobEvent;
        if (ev.type === "job.updated") {
          setState({
            status: ev.status,
            total: ev.total,
            completed: ev.completed,
            failed: ev.failed,
          });
        } else if (ev.type === "job.finished") {
          setState((s) => ({ ...s, status: ev.status }));
          es.close();
        }
      } catch {
        // Drop malformed event rather than crashing the page — the SSE
        // server contract is stable enough that a parse error here means
        // we're on a mismatched build, not a recoverable state.
      }
    };
    es.onerror = () => {
      // Connection churn isn't fatal — EventSource auto-reconnects. The
      // 15-minute server cap plus auto-reconnect keeps the dashboard live
      // across a dev restart without the user reloading.
    };
    return () => es.close();
  }, [jobId]);

  const pct =
    state.total > 0
      ? Math.min(100, Math.round((state.completed / state.total) * 100))
      : 0;

  const done = state.status === "completed" || state.status === "failed";

  return (
    <div className="mt-6 space-y-4">
      <div className="h-2 w-full overflow-hidden rounded bg-muted">
        <div
          className="h-full bg-primary transition-all duration-300"
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>

      <p className="text-sm">
        {t("progress.summary", {
          completed: state.completed,
          total: state.total,
          failed: state.failed,
        })}
      </p>

      {state.status === "completed" && (
        <p className="text-sm font-medium text-emerald-600">
          {t("progress.completed")}
        </p>
      )}
      {state.status === "failed" && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {t("progress.failed")}
        </p>
      )}

      {done && (
        <Link
          href={`/app/w/${wsSlug}`}
          className="inline-flex rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
        >
          {t("actions.openResult")}
        </Link>
      )}
    </div>
  );
}
