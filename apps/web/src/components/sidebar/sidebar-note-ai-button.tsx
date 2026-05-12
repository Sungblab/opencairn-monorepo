"use client";

import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { MouseEvent } from "react";

import { newTab } from "@/lib/tab-factory";
import { cn } from "@/lib/utils";
import { useAgentWorkbenchStore } from "@/stores/agent-workbench-store";
import { usePanelStore } from "@/stores/panel-store";
import { useTabsStore } from "@/stores/tabs-store";

interface SidebarNoteAiButtonProps {
  href: string;
  noteId: string;
  title: string;
  className?: string;
}

export function noteIdFromNoteHref(href: string): string | null {
  const match = href.match(/\/note\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function activateSidebarNoteTab(noteId: string, title: string) {
  const tabs = useTabsStore.getState();
  const existing = tabs.findTabByTarget("note", noteId);

  if (existing) {
    if (existing.title !== title) {
      tabs.updateTab(existing.id, { title });
    }
    tabs.setActive(existing.id);
    return;
  }

  tabs.addOrReplacePreview(
    newTab({
      kind: "note",
      targetId: noteId,
      title,
      mode: "plate",
    }),
  );
}

export function requestSidebarNoteAgentContext(noteId: string, title: string) {
  activateSidebarNoteTab(noteId, title);
  useAgentWorkbenchStore.getState().requestContext("current_document_only");
  usePanelStore.getState().openAgentPanelTab("chat");
}

export function SidebarNoteAiButton({
  href,
  noteId,
  title,
  className,
}: SidebarNoteAiButtonProps) {
  const router = useRouter();
  const t = useTranslations("sidebar.agent_actions");
  const label = t("ask_ai");

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    requestSidebarNoteAgentContext(noteId, title);
    router.push(href);
  }

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={handleClick}
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-[var(--radius-control)] border border-border/70 bg-background/80 px-1.5 text-[10px] font-semibold leading-none text-muted-foreground shadow-sm transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <Sparkles aria-hidden className="h-3 w-3" />
      <span>{t("ask_ai_short")}</span>
    </button>
  );
}
