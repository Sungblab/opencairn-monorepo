"use client";

import { useState, type ReactNode } from "react";
import {
  Activity,
  Bot,
  CheckSquare,
  FileText,
  MessageSquare,
  Quote,
  Sparkles,
  Volume2,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { CommentsPanel } from "@/components/comments/CommentsPanel";
import { NoteUpdateActionReviewList } from "@/components/agent-panel/note-update-action-review";
import { WorkbenchActivityStack } from "@/components/agent-panel/workbench-activity-stack";
import {
  WorkbenchActivityButton,
  WorkbenchCommandButton,
  WorkbenchContextButton,
} from "@/components/agent-panel/workbench-trigger-button";

export type NoteRailTab = "comments" | "ai" | "activity";

interface Props {
  noteId: string;
  workspaceId: string;
  projectId: string;
  canComment: boolean;
  readOnly: boolean;
  activeTab?: NoteRailTab | null;
  onActiveTabChange?(tab: NoteRailTab | null): void;
  scrollTargetCommentId?: string | null;
  onScrolledToTarget?: () => void;
}

export function NoteContextRail({
  noteId,
  workspaceId,
  projectId,
  canComment,
  readOnly,
  activeTab,
  onActiveTabChange,
  scrollTargetCommentId,
  onScrolledToTarget,
}: Props) {
  const t = useTranslations("editor.noteRail");
  const [internalActive, setInternalActive] = useState<NoteRailTab | null>(null);
  const controlled = activeTab !== undefined;
  const active = controlled ? activeTab : internalActive;
  const setActive = (tab: NoteRailTab | null) => {
    if (controlled) {
      onActiveTabChange?.(tab);
      return;
    }
    setInternalActive(tab);
  };

  const openTab = (tab: NoteRailTab) => {
    setActive(active === tab ? null : tab);
  };

  return (
    <aside
      aria-label={t("title")}
      data-testid="note-context-rail"
      className="flex shrink-0 flex-col border-t border-border bg-background xl:flex-row xl:border-l xl:border-t-0"
    >
      <div className="flex min-h-11 items-center gap-1 border-b border-border bg-muted/20 px-2 py-1 xl:min-h-0 xl:w-12 xl:flex-col xl:border-b-0 xl:border-r xl:px-1 xl:py-2">
        <RailButton
          active={active === "comments"}
          label={t("comments")}
          testId="note-rail-comments-button"
          onClick={() => openTab("comments")}
        >
          <MessageSquare aria-hidden className="h-4 w-4" />
        </RailButton>
        <RailButton
          active={active === "ai"}
          label={t("aiWork")}
          testId="note-rail-ai-button"
          onClick={() => openTab("ai")}
        >
          <Bot aria-hidden className="h-4 w-4" />
        </RailButton>
        <RailButton
          active={active === "activity"}
          label={t("activity")}
          testId="note-rail-activity-button"
          onClick={() => openTab("activity")}
        >
          <Activity aria-hidden className="h-4 w-4" />
        </RailButton>
      </div>

      {active ? (
        <section
          data-testid="note-context-rail-panel"
          className="min-h-0 w-full border-t border-border bg-background xl:w-80 xl:border-t-0"
        >
          <header className="flex min-h-10 items-center justify-between gap-2 border-b border-border px-3">
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
          {active === "comments" ? (
            <CommentsPanel
              noteId={noteId}
              workspaceId={workspaceId}
              canComment={canComment}
              scrollTargetCommentId={scrollTargetCommentId}
              onScrolledToTarget={onScrolledToTarget}
            />
          ) : null}
          {active === "ai" ? <NoteRailAiWork readOnly={readOnly} /> : null}
          {active === "activity" ? (
            <NoteRailActivity projectId={projectId} />
          ) : null}
        </section>
      ) : null}
    </aside>
  );
}

function RailButton({
  active,
  label,
  testId,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  testId: string;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      data-testid={testId}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] border transition-colors ${
        active
          ? "border-border bg-background text-foreground shadow-sm"
          : "border-transparent text-muted-foreground hover:border-border hover:bg-background hover:text-foreground"
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function NoteRailAiWork({ readOnly }: { readOnly: boolean }) {
  const t = useTranslations("editor.noteRail");

  return (
    <div className="space-y-3 p-3">
      <p className="text-xs leading-5 text-muted-foreground">
        {t("aiDescription")}
      </p>
      {!readOnly ? (
        <div className="grid gap-2">
          <WorkbenchCommandButton
            commandId="make_note"
            data-testid="note-rail-make-note-button"
            className="app-hover inline-flex min-h-9 items-center gap-2 rounded-[var(--radius-control)] border border-border px-2.5 text-sm"
          >
            <FileText aria-hidden className="h-4 w-4" />
            {t("makeNote")}
          </WorkbenchCommandButton>
          <WorkbenchCommandButton
            commandId="extract_citations"
            data-testid="note-rail-citations-button"
            className="app-hover inline-flex min-h-9 items-center gap-2 rounded-[var(--radius-control)] border border-border px-2.5 text-sm"
          >
            <Quote aria-hidden className="h-4 w-4" />
            {t("extractCitations")}
          </WorkbenchCommandButton>
          <WorkbenchContextButton
            commandId="current_document_only"
            data-testid="note-rail-ask-ai-button"
            className="app-hover inline-flex min-h-9 items-center gap-2 rounded-[var(--radius-control)] border border-border px-2.5 text-sm"
          >
            <Sparkles aria-hidden className="h-4 w-4" />
            {t("askAi")}
          </WorkbenchContextButton>
          <WorkbenchCommandButton
            commandId="narrate_note"
            data-testid="note-rail-narrate-button"
            className="app-hover inline-flex min-h-9 items-center gap-2 rounded-[var(--radius-control)] border border-border px-2.5 text-sm"
          >
            <Volume2 aria-hidden className="h-4 w-4" />
            {t("narrate")}
          </WorkbenchCommandButton>
          <WorkbenchActivityButton
            data-testid="note-rail-review-button"
            className="app-hover inline-flex min-h-9 items-center gap-2 rounded-[var(--radius-control)] border border-border px-2.5 text-sm"
          >
            <CheckSquare aria-hidden className="h-4 w-4" />
            {t("review")}
          </WorkbenchActivityButton>
        </div>
      ) : null}
    </div>
  );
}

function NoteRailActivity({ projectId }: { projectId: string }) {
  const t = useTranslations("editor.noteRail");

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
