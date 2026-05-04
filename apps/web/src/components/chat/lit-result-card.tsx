"use client";
import { ArrowRight, FileText } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTabsStore } from "@/stores/tabs-store";
import {
  useLitSearchStore,
  type LitPaperPayload,
} from "@/stores/lit-search-store";

// Compact chat-bubble card rendered when the agent calls literature_search.
// Shows the top 5 hits + an "Open full results" button that materialises a
// tab with mode='lit-search' (Task 10 wires the viewer + extends TabKind).

export type LitResultCardData = LitPaperPayload;

interface LitResultCardProps {
  papers: LitResultCardData[];
  query: string;
  workspaceId: string;
  projectId?: string;
}

export function LitResultCard({
  papers,
  query,
  workspaceId,
  projectId,
}: LitResultCardProps) {
  const t = useTranslations("literature");
  const addTab = useTabsStore((s) => s.addTab);
  const setLitPayload = useLitSearchStore((s) => s.set);

  function handleOpenInEditor() {
    const tabId = crypto.randomUUID();
    setLitPayload(tabId, {
      query,
      workspaceId,
      projectId: projectId ?? null,
      papers,
    });
    addTab({
      id: tabId,
      // `lit_search` is added to TabKind in Task 10. The TS error is
      // expected and noted in the plan — the viewer wiring lands next.
      kind: "lit_search" as never,
      targetId: null,
      // `lit-search` is added to TabMode in Task 10.
      mode: "lit-search" as never,
      title: t("tab.title"),
      titleKey: "literature.tab.title",
      pinned: false,
      preview: false,
      dirty: false,
      splitWith: null,
      splitSide: null,
      scrollY: 0,
    });
  }

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2 text-sm">
      {papers.slice(0, 5).map((paper) => (
        <div key={paper.id} className="space-y-0.5">
          <div className="flex items-start gap-2">
            <FileText
              aria-hidden="true"
              className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
            />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-foreground truncate">
                {paper.title}
              </p>
              <p className="text-muted-foreground text-xs truncate">
                {paper.authors.slice(0, 3).join(", ")}
                {paper.authors.length > 3 && " et al."}
                {paper.year
                  ? ` · ${t("result.year", { year: paper.year })}`
                  : ""}
                {paper.citationCount != null
                  ? ` · ${t("result.citations", { count: paper.citationCount })}`
                  : ""}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {paper.openAccessPdfUrl ? (
                <span className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 px-1.5 py-0.5 rounded font-medium">
                  {t("badge.openAccess")}
                </span>
              ) : (
                <span className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 px-1.5 py-0.5 rounded font-medium">
                  {t("badge.paywalled")}
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
      {papers.length > 5 && (
        <p className="text-xs text-muted-foreground pl-6">
          {t("search.moreCount", { count: papers.length - 5 })}
        </p>
      )}
      <div className="pt-1 border-t border-border">
        <button
          type="button"
          onClick={handleOpenInEditor}
          className="app-btn-ghost rounded-[var(--radius-control)] px-2 py-1 text-xs font-medium text-foreground"
        >
          <span>{t("search.openInEditor")}</span>
          <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
