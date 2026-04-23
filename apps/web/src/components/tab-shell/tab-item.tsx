"use client";
import { FileText, Pin, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Tab } from "@/stores/tabs-store";

export interface TabItemProps {
  tab: Tab;
  active: boolean;
  onClick: () => void;
  onClose: () => void;
}

export function TabItem({ tab, active, onClick, onClose }: TabItemProps) {
  const t = useTranslations("appShell.tabs.item");
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
        active ? "bg-background" : "bg-muted/40 hover:bg-muted/70"
      }`}
    >
      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span
        className={`flex-1 truncate ${tab.preview ? "italic" : ""}`}
        title={tab.title}
      >
        {tab.title}
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
          className="shrink-0 rounded opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
