import type { Tab } from "@/stores/tabs-store";

export type AgentScopePayload = {
  chips: Array<{
    type: "page" | "project" | "workspace";
    id: string;
  }>;
  strict: "strict" | "loose";
};

export async function buildAgentScopePayload(opts: {
  selectedScopeIds: string[];
  activeTab: Tab | undefined;
  workspaceId: string | null;
  strict: "strict" | "loose";
  resolveNoteProjectId?: (noteId: string) => Promise<string | null>;
}): Promise<AgentScopePayload> {
  const { selectedScopeIds, activeTab, workspaceId, strict } = opts;
  const chips: AgentScopePayload["chips"] = [];

  if (
    selectedScopeIds.includes("page") &&
    activeTab?.kind === "note" &&
    activeTab.targetId
  ) {
    chips.push({ type: "page", id: activeTab.targetId });
  }

  if (selectedScopeIds.includes("project")) {
    if (activeTab?.kind === "project" && activeTab.targetId) {
      chips.push({ type: "project", id: activeTab.targetId });
    } else if (activeTab?.kind === "note" && activeTab.targetId) {
      const projectId =
        (await opts.resolveNoteProjectId?.(activeTab.targetId)) ?? null;
      if (projectId) chips.push({ type: "project", id: projectId });
    }
  }

  if (selectedScopeIds.includes("workspace") && workspaceId) {
    chips.push({ type: "workspace", id: workspaceId });
  }

  return { chips, strict };
}
