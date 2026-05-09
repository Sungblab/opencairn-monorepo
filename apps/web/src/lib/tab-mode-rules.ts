import type { Tab } from "@/stores/tabs-store";

export function isValidTabMode(tab: Tab): boolean {
  switch (tab.kind) {
    case "note":
      return ["plate", "reading", "source", "data", "canvas"].includes(
        tab.mode,
      );
    case "project":
      return tab.mode === "plate" || tab.mode === "graph";
    case "ingest":
      return tab.mode === "ingest";
    case "lit_search":
      return tab.mode === "lit-search";
    case "agent_file":
      return tab.mode === "agent-file";
    case "code_workspace":
      return tab.mode === "code-workspace";
    case "dashboard":
    case "research_hub":
    case "research_run":
    case "import":
    case "ws_settings":
      return tab.mode === "plate";
  }
}
