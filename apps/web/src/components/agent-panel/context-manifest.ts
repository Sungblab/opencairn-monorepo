import type { Tab, TabKind } from "@/stores/tabs-store";
import type { ProjectTreeDragPayload } from "@/lib/project-tree-dnd";

export type SourcePolicy =
  | "auto_project"
  | "current_only"
  | "pinned_only"
  | "workspace";
export type MemoryPolicy = "auto" | "off";
export type ExternalSearchPolicy = "off" | "allowed";

export type ContextManifest = {
  workspaceId: string | null;
  projectId?: string;
  activeArtifact?: {
    type: "note" | "project" | "research" | "ingest" | "file" | "code";
    id: string;
  };
  sourcePolicy: SourcePolicy;
  memoryPolicy: MemoryPolicy;
  externalSearch: ExternalSearchPolicy;
  command?: string;
  attachedArtifacts?: Array<{
    type: ProjectTreeDragPayload["kind"];
    id: string;
    treeNodeId: string;
    label: string;
  }>;
};

export type AgentContextChip = {
  type: "page" | "project" | "workspace";
  id: string;
  label?: string;
  manual?: boolean;
};

export type AgentContextPayload = {
  manifest: ContextManifest;
  chips: AgentContextChip[];
  strict: "strict" | "loose";
};

export function activeArtifactFromTab(
  activeTab: Tab | undefined,
): ContextManifest["activeArtifact"] {
  if (!activeTab?.targetId) return undefined;
  switch (activeTab.kind) {
    case "note":
      return { type: "note", id: activeTab.targetId };
    case "project":
      return { type: "project", id: activeTab.targetId };
    case "research_run":
      return { type: "research", id: activeTab.targetId };
    case "ingest":
      return { type: "ingest", id: activeTab.targetId };
    case "agent_file":
      return { type: "file", id: activeTab.targetId };
    case "code_workspace":
      return { type: "code", id: activeTab.targetId };
    default:
      return undefined;
  }
}

export async function resolveActiveProjectId(opts: {
  activeTab: Tab | undefined;
  resolveNoteProjectId?: (noteId: string) => Promise<string | null>;
  fallbackProjectId?: string | null;
}): Promise<string | null> {
  const { activeTab } = opts;
  if (!activeTab?.targetId) return opts.fallbackProjectId ?? null;
  if (activeTab.kind === "project") return activeTab.targetId;
  if (activeTab.kind === "note") {
    return (
      (await opts.resolveNoteProjectId?.(activeTab.targetId)) ??
      opts.fallbackProjectId ??
      null
    );
  }
  return opts.fallbackProjectId ?? null;
}

export async function buildAgentContextPayload(opts: {
  activeTab: Tab | undefined;
  workspaceId: string | null;
  sourcePolicy: SourcePolicy;
  memoryPolicy: MemoryPolicy;
  externalSearch: ExternalSearchPolicy;
  command?: string;
  resolveNoteProjectId?: (noteId: string) => Promise<string | null>;
  fallbackProjectId?: string | null;
  attachedReferences?: ProjectTreeDragPayload[];
}): Promise<AgentContextPayload> {
  const projectId = await resolveActiveProjectId(opts);
  const activeArtifact = activeArtifactFromTab(opts.activeTab);
  const chips: AgentContextPayload["chips"] = [];

  if (
    (opts.sourcePolicy === "auto_project" ||
      opts.sourcePolicy === "current_only") &&
    opts.activeTab?.kind === "note" &&
    opts.activeTab.targetId
  ) {
    chips.push({ type: "page", id: opts.activeTab.targetId });
  }

  if (
    opts.sourcePolicy === "auto_project" &&
    projectId
  ) {
    chips.push({ type: "project", id: projectId });
  }

  if (
    opts.sourcePolicy === "current_only" &&
    opts.activeTab?.kind === "project" &&
    projectId
  ) {
    chips.push({ type: "project", id: projectId });
  }

  if (opts.sourcePolicy === "workspace" && opts.workspaceId) {
    chips.push({ type: "workspace", id: opts.workspaceId });
  }

  for (const ref of opts.attachedReferences ?? []) {
    if (ref.kind === "note") {
      chips.push({
        type: "page",
        id: ref.targetId,
        label: ref.label,
        manual: true,
      });
    }
  }

  const attachedArtifacts = (opts.attachedReferences ?? [])
    .filter((ref) => ref.kind !== "note" && ref.kind !== "folder")
    .map((ref) => ({
      type: ref.kind,
      id: ref.targetId,
      treeNodeId: ref.id,
      label: ref.label,
    }));

  const manifest: ContextManifest = {
    workspaceId: opts.workspaceId,
    ...(projectId ? { projectId } : {}),
    ...(activeArtifact ? { activeArtifact } : {}),
    sourcePolicy: opts.sourcePolicy,
    memoryPolicy: opts.memoryPolicy,
    externalSearch: opts.externalSearch,
    ...(opts.command ? { command: opts.command } : {}),
    ...(attachedArtifacts.length > 0 ? { attachedArtifacts } : {}),
  };

  const dedupedChips = new Map<string, AgentContextChip>();
  for (const chip of chips) {
    dedupedChips.set(`${chip.type}:${chip.id}`, chip);
  }

  return { manifest, chips: [...dedupedChips.values()], strict: "strict" };
}

export function defaultSourcePolicy(activeKind: TabKind | undefined): SourcePolicy {
  if (activeKind === "dashboard" || activeKind === "ws_settings") return "workspace";
  return "auto_project";
}
