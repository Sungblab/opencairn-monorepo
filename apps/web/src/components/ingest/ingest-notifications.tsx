"use client";

import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import { urls } from "@/lib/urls";
import { useIngestStream } from "@/hooks/use-ingest-stream";
import { useIngestStore, type IngestRunState } from "@/stores/ingest-store";

function IngestRunSubscriber({ wfid }: { wfid: string }) {
  useIngestStream(wfid);
  return null;
}

export function IngestNotifications() {
  const runsById = useIngestStore((s) => s.runs);
  const notified = useRef(
    new Set(
      Object.values(runsById)
        .filter((run) => run.status !== "running")
        .map((run) => run.workflowId),
    ),
  );
  const t = useTranslations("ingest.notifications");
  const router = useRouter();
  const locale = useLocale();
  const params = useParams<{ wsSlug?: string }>() ?? {};
  const wsSlug = params.wsSlug;

  const runningIds = useMemo(
    () =>
      Object.values(runsById)
        .filter((run) => run.status === "running")
        .map((run) => run.workflowId),
    [runsById],
  );

  useEffect(() => {
    for (const run of Object.values(runsById)) {
      if (run.status === "running") continue;
      if (notified.current.has(run.workflowId)) continue;
      notified.current.add(run.workflowId);
      notifyTerminalRun(run, {
        completed: t("completed"),
        failed: t("failed"),
        openNote: t("openNote"),
        openNoteUrl:
          run.noteId && wsSlug
            ? urls.workspace.note(locale, wsSlug, run.noteId)
            : null,
        push: router.push,
      });
    }
  }, [runsById, t, router.push, locale, wsSlug]);

  return (
    <>
      {runningIds.map((wfid) => (
        <IngestRunSubscriber key={wfid} wfid={wfid} />
      ))}
    </>
  );
}

function notifyTerminalRun(
  run: IngestRunState,
  opts: {
    completed: string;
    failed: string;
    openNote: string;
    openNoteUrl: string | null;
    push: (href: string) => void;
  },
) {
  if (run.status === "completed") {
    if (opts.openNoteUrl) {
      toast.success(opts.completed, {
        action: {
          label: opts.openNote,
          onClick: () => opts.push(opts.openNoteUrl!),
        },
      });
      return;
    }
    toast.success(opts.completed);
    return;
  }

  if (run.status === "failed") {
    toast.error(opts.failed);
  }
}
