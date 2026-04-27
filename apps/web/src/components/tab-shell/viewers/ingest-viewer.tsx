"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { Tab } from "@/stores/tabs-store";
import { useIngestStream } from "@/hooks/use-ingest-stream";
import { useIngestCompletionRedirect } from "@/hooks/use-ingest-completion-redirect";
import { IngestProgressView } from "@/components/ingest/ingest-progress-view";

/**
 * Tab mode "ingest" — full-tab view of an in-progress ingest run. The tab
 * pins to a workflowId via `tab.targetId`. Mounting this viewer opens the
 * SSE stream so the tab can run independently of the dock subscriber (e.g.
 * if the dock card is dismissed but the tab remains open).
 */
export function IngestViewer({ tab }: { tab: Tab }) {
  const wfid = tab.targetId;
  const [dense, setDense] = useState(false);
  const t = useTranslations("ingest.tab");
  useIngestStream(wfid);
  useIngestCompletionRedirect(wfid);
  if (!wfid) return null;

  return (
    <div className="ingest-tab-viewer flex h-full flex-col">
      <div className="ingest-tab-toolbar">
        <button type="button" onClick={() => setDense((d) => !d)}>
          {dense ? t("denseToggleOff") : t("denseToggle")}
        </button>
      </div>
      <IngestProgressView wfid={wfid} mode="tab" />
    </div>
  );
}
