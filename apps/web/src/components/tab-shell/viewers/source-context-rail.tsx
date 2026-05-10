"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  CheckSquare,
  FileSearch,
  ListChecks,
  Quote,
  Sparkles,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { NoteUpdateActionReviewList } from "@/components/agent-panel/note-update-action-review";
import { WorkbenchActivityStack } from "@/components/agent-panel/workbench-activity-stack";
import {
  WorkbenchActivityButton,
  WorkbenchCommandButton,
  WorkbenchContextButton,
} from "@/components/agent-panel/workbench-trigger-button";

type SourceRailTab = "analysis" | "activity";

interface SourceContextRailProps {
  noteId: string;
  projectId: string | null;
  viewerElementId: string;
}

export function SourceContextRail({
  noteId,
  projectId,
  viewerElementId,
}: SourceContextRailProps) {
  const t = useTranslations("appShell.viewers.source.rail");
  const [active, setActive] = useState<SourceRailTab | null>("analysis");
  const [selectedText, setSelectedText] = useState("");

  const openTab = (tab: SourceRailTab) => {
    setActive(active === tab ? null : tab);
  };

  useEffect(() => {
    function updateSelection() {
      const root = document.getElementById(viewerElementId);
      const selection = window.getSelection();
      const anchor = selection?.anchorNode ?? null;
      const text = selection?.toString().trim() ?? "";
      if (!root || !anchor || !root.contains(anchor) || text.length === 0) {
        setSelectedText("");
        return;
      }
      setSelectedText(text.slice(0, 180));
    }
    document.addEventListener("selectionchange", updateSelection);
    updateSelection();
    return () => {
      document.removeEventListener("selectionchange", updateSelection);
    };
  }, [viewerElementId]);

  return (
    <aside
      aria-label={t("title")}
      data-testid="source-context-rail"
      data-note-id={noteId}
      className="flex shrink-0 flex-col border-t border-border bg-background text-foreground xl:flex-row xl:border-l xl:border-t-0"
    >
      <div className="flex min-h-11 items-center gap-1 border-b border-border px-2 py-1 xl:min-h-0 xl:w-12 xl:flex-col xl:border-b-0 xl:border-r xl:px-1 xl:py-2">
        <RailButton
          active={active === "analysis"}
          label={t("analysis")}
          onClick={() => openTab("analysis")}
        >
          <FileSearch aria-hidden className="h-4 w-4" />
        </RailButton>
        <RailButton
          active={active === "activity"}
          label={t("activity")}
          onClick={() => openTab("activity")}
        >
          <Activity aria-hidden className="h-4 w-4" />
        </RailButton>
      </div>

      {active ? (
        <section
          data-testid="source-context-rail-panel"
          className="flex min-h-0 w-full flex-col border-t border-border xl:w-80 xl:border-t-0"
        >
          <header className="flex min-h-10 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
            <h2 className="text-sm font-semibold">{t(active)}</h2>
            <button
              type="button"
              aria-label={t("close")}
              className="app-hover inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)]"
              onClick={() => setActive(null)}
            >
              <X aria-hidden className="h-4 w-4" />
            </button>
          </header>
          <div
            data-testid="source-context-rail-scroll"
            className="min-h-0 flex-1 overflow-y-auto"
          >
            {active === "analysis" ? (
              <SourceRailAnalysis selectedText={selectedText} />
            ) : null}
            {active === "activity" ? (
              <SourceRailActivity projectId={projectId} />
            ) : null}
          </div>
        </section>
      ) : null}
    </aside>
  );
}

function RailButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] border transition-colors ${
        active
          ? "border-foreground bg-foreground text-background"
          : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function SourceRailAnalysis({ selectedText }: { selectedText: string }) {
  const t = useTranslations("appShell.viewers.source.rail");
  const selectedCount = selectedText.length;

  return (
    <div className="space-y-3 p-3">
      <p className="text-xs leading-5 text-muted-foreground">
        {t("analysisDescription")}
      </p>
      <div className="rounded-[var(--radius-card)] border border-border bg-muted/25 p-2">
        <div className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">
          {t("selectionTitle")}
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          {selectedCount > 0
            ? t("selectionActive", { count: selectedCount })
            : t("selectionEmpty")}
        </p>
        {selectedCount > 0 ? (
          <p className="mt-2 line-clamp-3 text-xs leading-5 text-foreground">
            {selectedText}
          </p>
        ) : null}
      </div>
      <div className="grid gap-2">
        <WorkbenchContextButton
          commandId="current_document_only"
          data-testid="source-rail-current-pdf-button"
          className="app-hover inline-flex min-h-9 items-center gap-2 rounded-[var(--radius-control)] border border-border px-2.5 text-sm"
        >
          <FileSearch aria-hidden className="h-4 w-4" />
          {t("useThisPdf")}
        </WorkbenchContextButton>
        <WorkbenchCommandButton
          commandId="summarize"
          data-testid="source-rail-summarize-button"
          className="app-hover inline-flex min-h-9 items-center gap-2 rounded-[var(--radius-control)] border border-border px-2.5 text-sm"
        >
          <Sparkles aria-hidden className="h-4 w-4" />
          {t("summarize")}
        </WorkbenchCommandButton>
        <WorkbenchCommandButton
          commandId="decompose"
          data-testid="source-rail-decompose-button"
          className="app-hover inline-flex min-h-9 items-center gap-2 rounded-[var(--radius-control)] border border-border px-2.5 text-sm"
        >
          <ListChecks aria-hidden className="h-4 w-4" />
          {t("decompose")}
        </WorkbenchCommandButton>
        <WorkbenchCommandButton
          commandId="extract_citations"
          data-testid="source-rail-citations-button"
          className="app-hover inline-flex min-h-9 items-center gap-2 rounded-[var(--radius-control)] border border-border px-2.5 text-sm"
        >
          <Quote aria-hidden className="h-4 w-4" />
          {t("citations")}
        </WorkbenchCommandButton>
        <WorkbenchActivityButton
          data-testid="source-rail-review-button"
          className="app-hover inline-flex min-h-9 items-center gap-2 rounded-[var(--radius-control)] border border-border px-2.5 text-sm"
        >
          <CheckSquare aria-hidden className="h-4 w-4" />
          {t("review")}
        </WorkbenchActivityButton>
      </div>
    </div>
  );
}

function SourceRailActivity({ projectId }: { projectId: string | null }) {
  const t = useTranslations("appShell.viewers.source.rail");

  return (
    <div className="min-h-0">
      <p className="border-b border-border p-3 text-xs leading-5 text-muted-foreground">
        {t("activityDescription")}
      </p>
      <NoteUpdateActionReviewList projectId={projectId} />
      <WorkbenchActivityStack />
    </div>
  );
}
