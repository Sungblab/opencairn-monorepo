"use client";
import Link from "next/link";
import { X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useIngestStore } from "@/stores/ingest-store";
import { useIngestStream } from "@/hooks/use-ingest-stream";
import { urls } from "@/lib/urls";
import { IngestProgressView } from "./ingest-progress-view";
import { openIngestTab } from "./open-ingest-tab";

const DOCK_MAX = 12;

/**
 * Each running run mounts its own subscriber. Splitting into a child
 * component lets us call useIngestStream once per workflow without breaking
 * the rules of hooks (the loop body would otherwise call hooks in a loop).
 */
function IngestRunSubscriber({ wfid }: { wfid: string }) {
  useIngestStream(wfid);
  return null;
}

export function IngestDock() {
  const runs = useIngestStore((s) => s.runs);
  const dismiss = useIngestStore((s) => s.dismissDockCard);
  const locale = useLocale();
  const params = useParams<{ wsSlug?: string }>() ?? {};
  const wsSlug = params.wsSlug;
  const t = useTranslations("ingest.dock");

  const cards = Object.values(runs).sort(
    (a, b) => b.startedAt - a.startedAt,
  );
  if (cards.length === 0) return null;

  const visible = cards.slice(0, DOCK_MAX);
  const overflow = cards.length - visible.length;

  return (
    <div
      className="ingest-dock-container"
      data-testid="ingest-dock"
    >
      {visible
        .filter((r) => r.status === "running")
        .map((r) => (
          <IngestRunSubscriber key={r.workflowId} wfid={r.workflowId} />
        ))}

      {visible.map((r) => (
        <div
          key={r.workflowId}
          className={`ingest-dock-card status-${r.status}`}
          data-testid="ingest-dock-card-wrapper"
        >
          {r.status === "running" && (
            <button
              type="button"
              onClick={() => openIngestTab(r.workflowId, r.fileName)}
              className="ingest-dock-open"
            >
              <IngestProgressView wfid={r.workflowId} mode="dock" />
            </button>
          )}
          {r.status === "completed" && r.noteId && wsSlug && (
            <Link
              href={urls.workspace.note(locale, wsSlug, r.noteId)}
              className="ingest-dock-link"
            >
              {t("openNote")}
            </Link>
          )}
          {r.status === "failed" && r.error && (
            <div className="ingest-dock-failed">
              <span>{r.error.reason}</span>
              {r.error.retryable && (
                <button type="button">{t("retry")}</button>
              )}
            </div>
          )}
          <button
            type="button"
            aria-label={t("dismiss")}
            onClick={() => dismiss(r.workflowId)}
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
      ))}
      {overflow > 0 && (
        <div className="ingest-dock-overflow">
          {t("moreCount", { n: overflow })}
        </div>
      )}
    </div>
  );
}
