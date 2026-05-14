"use client";

import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useIngestStream } from "@/hooks/use-ingest-stream";
import { useIngestStore, type IngestRunState } from "@/stores/ingest-store";
import { useAgentWorkbenchStore } from "@/stores/agent-workbench-store";
import {
  uploadIntentToWorkflow,
  type UploadIntentWorkflowCopy,
} from "@/components/upload/upload-intents";

const MAX_TERMINAL_TOAST_WORKFLOW_IDS = 200;
const terminalToastWorkflowIds = new Set<string>();

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
  const tWorkflowCopy = useTranslations("sidebar.upload.intent.workflowPrompts");
  const requestWorkflow = useAgentWorkbenchStore((s) => s.requestWorkflow);
  const markFollowUpLaunched = useIngestStore((s) => s.markFollowUpLaunched);
  const markFollowUpBatchLaunched = useIngestStore(
    (s) => s.markFollowUpBatchLaunched,
  );

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
      if (!rememberTerminalToastWorkflowId(run.workflowId)) continue;
      notifyTerminalRun(run, {
        completed: t("completed"),
        failed: t("failed"),
      });
      if (
        run.status === "completed" &&
        run.noteId &&
        run.followUpIntent &&
        run.followUpIntent !== "none" &&
        !run.followUpLaunched
      ) {
        const workflow =
          run.followUpIntent === "comparison" && run.followUpBatchId
            ? workflowForCompletedComparison(
                run,
                Object.values(runsById),
                tWorkflowCopy,
              )
            : uploadIntentToWorkflow({
                intent: run.followUpIntent,
                noteId: run.noteId,
                fileName: run.fileName,
                copy: tWorkflowCopy,
              });
        if (workflow) {
          requestWorkflow(workflow);
          if (run.followUpIntent === "comparison" && run.followUpBatchId) {
            markFollowUpBatchLaunched(run.followUpBatchId);
          } else {
            markFollowUpLaunched(run.workflowId);
          }
          toast.success(t("followUpReady"));
        }
      }
    }
  }, [
    markFollowUpBatchLaunched,
    markFollowUpLaunched,
    requestWorkflow,
    runsById,
    t,
    tWorkflowCopy,
  ]);

  return (
    <>
      {runningIds.map((wfid) => (
        <IngestRunSubscriber key={wfid} wfid={wfid} />
      ))}
    </>
  );
}

function workflowForCompletedComparison(
  run: IngestRunState,
  runs: IngestRunState[],
  copy: UploadIntentWorkflowCopy,
) {
  if (!run.followUpBatchId || !run.followUpBatchSize) return null;
  const batchRuns = runs.filter(
    (candidate) => candidate.followUpBatchId === run.followUpBatchId,
  );
  if (batchRuns.some((candidate) => candidate.followUpLaunched)) return null;
  const completedNoteIds = batchRuns.flatMap((candidate) =>
    candidate.status === "completed" && candidate.noteId ? [candidate.noteId] : [],
  );
  if (completedNoteIds.length < run.followUpBatchSize) return null;
  return uploadIntentToWorkflow({
    intent: "comparison",
    noteId: completedNoteIds[0]!,
    sourceNoteIds: completedNoteIds,
    fileName: `${completedNoteIds.length} uploaded sources`,
    copy,
  });
}

function rememberTerminalToastWorkflowId(workflowId: string): boolean {
  if (terminalToastWorkflowIds.has(workflowId)) return false;
  terminalToastWorkflowIds.add(workflowId);
  if (terminalToastWorkflowIds.size > MAX_TERMINAL_TOAST_WORKFLOW_IDS) {
    const oldest = terminalToastWorkflowIds.values().next().value;
    if (oldest) terminalToastWorkflowIds.delete(oldest);
  }
  return true;
}

function notifyTerminalRun(
  run: IngestRunState,
  opts: {
    completed: string;
    failed: string;
  },
) {
  if (run.status === "completed") {
    toast.success(opts.completed);
    return;
  }

  if (run.status === "failed") {
    toast.error(opts.failed);
  }
}
