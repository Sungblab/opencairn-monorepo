"use client";

import { createContext, useContext } from "react";
import type { Tab, TabKind, TabMode } from "@/stores/tabs-store";

type ShellTabTitleKey =
  | "dashboard"
  | "graph"
  | "note"
  | "project"
  | "research_hub"
  | "research_run"
  | "import"
  | "help"
  | "report"
  | "ws_settings";

export interface ShellLabels {
  placeholders: {
    sidebar: string;
    agentPanel: string;
    openSidebar: string;
    openAgentPanel: string;
  };
  tabs: {
    bar: {
      newTab: string;
      newTabTitle: string;
      overflowTrigger: string;
    };
    item: {
      close: string;
      pinned: string;
      unsaved: string;
    };
    titles: Record<ShellTabTitleKey, string>;
  };
}

const ShellLabelsContext = createContext<ShellLabels | null>(null);
const tabTitlePrefix = "appShell.tabTitles.";

export function ShellLabelsProvider({
  labels,
  children,
}: {
  labels: ShellLabels;
  children: React.ReactNode;
}) {
  return (
    <ShellLabelsContext.Provider value={labels}>
      {children}
    </ShellLabelsContext.Provider>
  );
}

export function useShellLabels() {
  const labels = useContext(ShellLabelsContext);
  if (!labels) {
    throw new Error("useShellLabels must be used within ShellLabelsProvider");
  }
  return labels;
}

export function shellTabTitleKey(
  kind: TabKind,
  targetId: string | null,
  mode?: TabMode,
): { key: string | undefined; params: Record<string, string> | undefined } {
  switch (kind) {
    case "note":
      return { key: undefined, params: undefined };
    case "project":
      return {
        key:
          mode === "graph"
            ? "appShell.tabTitles.graph"
            : "appShell.tabTitles.project",
        params: undefined,
      };
    case "research_run":
      return {
        key: "appShell.tabTitles.research_run",
        params: { id: targetId ?? "" },
      };
    case "dashboard":
    case "research_hub":
    case "import":
    case "help":
    case "report":
    case "ws_settings":
      return { key: `appShell.tabTitles.${kind}`, params: undefined };
    case "ingest":
    case "lit_search":
    case "agent_file":
    case "code_workspace":
      return { key: undefined, params: undefined };
    default:
      kind satisfies never;
      return { key: undefined, params: undefined };
  }
}

export function resolveShellDefaultTabTitle(
  labels: ShellLabels,
  kind: TabKind,
  targetId: string | null,
  mode?: TabMode,
): string {
  switch (kind) {
    case "dashboard":
    case "note":
    case "research_hub":
    case "import":
    case "help":
    case "report":
    case "ws_settings":
      return labels.tabs.titles[kind];
    case "research_run":
      return interpolateLabel(labels.tabs.titles.research_run, {
        id: targetId ?? "",
      });
    case "project":
      return mode === "graph"
        ? labels.tabs.titles.graph
        : labels.tabs.titles.project;
    case "ingest":
    case "lit_search":
    case "agent_file":
    case "code_workspace":
      return "";
  }
}

export function resolveShellTabTitle(labels: ShellLabels, tab: Tab): string {
  if (!tab.titleKey) return tab.title;
  if (!tab.titleKey.startsWith(tabTitlePrefix)) return tab.title;

  const titleKey = tab.titleKey.slice(tabTitlePrefix.length);
  if (!isShellTabTitleKey(titleKey)) return tab.title;

  return interpolateLabel(labels.tabs.titles[titleKey], tab.titleParams);
}

function isShellTabTitleKey(key: string): key is ShellTabTitleKey {
  return key in shellTabTitleKeys;
}

function interpolateLabel(
  template: string,
  params: Record<string, string> | undefined,
) {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_match, key: string) =>
    params[key] ?? "",
  );
}

const shellTabTitleKeys: Record<ShellTabTitleKey, true> = {
  dashboard: true,
  graph: true,
  note: true,
  project: true,
  research_hub: true,
  research_run: true,
  import: true,
  help: true,
  report: true,
  ws_settings: true,
};
