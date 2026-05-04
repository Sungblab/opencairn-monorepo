"use client";
import { FileText, Pin, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Tab } from "@/stores/tabs-store";
import { useResolvedTabTitle } from "@/lib/resolve-tab-title";

export interface TabItemProps {
  tab: Tab;
  active: boolean;
  onClick: () => void;
  onClose: () => void;
}

export function TabItem({ tab, active, onClick, onClose }: TabItemProps) {
  const t = useTranslations("appShell.tabs.item");
  const resolvedTitle = useResolvedTabTitle(tab);
  return (
    <div
      role="tab"
      aria-selected={active}
      data-testid={`tab-${tab.id}`}
      onClick={onClick}
      onMouseDown={(e) => {
        if (e.button === 1 && !tab.pinned) {
          e.preventDefault();
          onClose();
        }
      }}
      className={`group flex h-full min-w-[120px] max-w-[220px] shrink-0 cursor-pointer items-center gap-1.5 border-r border-border px-2 text-xs transition-colors ${
        active
          ? // Active tab "lifts" out of the bar (bg-background matches the
            // editor surface) and gets a 1.5px bottom underline. `-mb-[1.5px]`
            // collapses the parent bar's `border-b` so the underline visually
            // replaces it instead of stacking; the inline border-bottom uses
            // the foreground token so the underline reads against any palette.
            "bg-background -mb-[1.5px]"
          : "app-hover bg-transparent"
      }`}
      style={
        active
          ? { borderBottom: "1.5px solid var(--theme-fg)" }
          : undefined
      }
    >
      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span
        className={`flex-1 truncate ${tab.preview ? "italic" : ""}`}
        title={resolvedTitle}
      >
        {resolvedTitle}
      </span>
      {tab.dirty ? (
        <span
          aria-label={t("unsaved")}
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-foreground"
        />
      ) : null}
      {tab.pinned ? (
        <Pin
          aria-label={t("pinned")}
          className="h-3 w-3 shrink-0 text-muted-foreground"
        />
      ) : (
        <button
          type="button"
          aria-label={t("close")}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded opacity-0 transition-colors hover:bg-muted hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
