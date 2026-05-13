"use client";

import { useTabsStore, type Tab } from "@/stores/tabs-store";
import { useTabActions } from "@/hooks/use-tab-actions";
import { useShellLabels } from "@/components/shell/shell-labels";
import { useResolvedTabTitle } from "@/lib/resolve-tab-title";
import type { TabListProps } from "./tab-list-types";

function FallbackTabItem({ tab, active }: { tab: Tab; active: boolean }) {
  const { tabs: labels } = useShellLabels();
  const title = useResolvedTabTitle(tab);
  const tabActions = useTabActions();
  const splitRole = useTabsStore((s) =>
    s.split?.primaryTabId === tab.id
      ? "primary"
      : s.split?.secondaryTabId === tab.id
        ? "secondary"
        : null,
  );

  return (
    <div
      role="tab"
      aria-selected={active}
      data-testid={`tab-${tab.id}`}
      onClick={() => tabActions.activateTab(tab)}
      onMouseDown={(e) => {
        if (e.button === 1 && !tab.pinned) {
          e.preventDefault();
          tabActions.closeTab(tab.id);
        }
      }}
      className={`group flex h-full min-w-[120px] max-w-[220px] shrink-0 cursor-pointer items-center gap-1.5 border-r border-border px-2 text-xs transition-colors ${
        active ? "bg-background -mb-[1.5px]" : "app-hover bg-transparent"
      }`}
      style={
        active
          ? { borderBottom: "1.5px solid var(--theme-fg)" }
          : undefined
      }
    >
      <span
        className={`flex-1 truncate ${tab.preview ? "italic" : ""}`}
        title={title}
      >
        {title}
      </span>
      {tab.dirty ? (
        <span
          aria-label={labels.item.unsaved}
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-foreground"
        />
      ) : null}
      {splitRole ? (
        <span
          aria-label={
            splitRole === "primary"
              ? labels.item.splitPrimary
              : labels.item.splitSecondary
          }
          className={`h-4 w-1 shrink-0 rounded-full ${
            splitRole === "primary" ? "bg-primary" : "bg-accent-foreground/70"
          }`}
        />
      ) : null}
      {tab.pinned ? null : (
        <button
          type="button"
          aria-label={labels.item.close}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            tabActions.closeTab(tab.id);
          }}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded opacity-0 transition-colors hover:bg-muted hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
        >
          <span
            aria-hidden
            className="relative block h-3 w-3 before:absolute before:left-1/2 before:top-0 before:h-3 before:w-px before:-translate-x-1/2 before:rotate-45 before:bg-current after:absolute after:left-1/2 after:top-0 after:h-3 after:w-px after:-translate-x-1/2 after:-rotate-45 after:bg-current"
          />
        </button>
      )}
    </div>
  );
}

export function StaticTabListFallback({ tabs, activeId }: TabListProps) {
  return (
    <>
      {tabs.map((tab) => (
        <FallbackTabItem
          key={tab.id}
          tab={tab}
          active={tab.id === activeId}
        />
      ))}
    </>
  );
}
