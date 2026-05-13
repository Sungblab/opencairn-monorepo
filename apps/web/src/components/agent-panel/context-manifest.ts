import type { Tab, TabKind } from "@/stores/tabs-store";
import type { ProjectTreeDragPayload } from "@/lib/project-tree-dnd";
import type { AgentWorkflowSubmission } from "@/stores/agent-workbench-store";

export type SourcePolicy =
  | "auto_project"
  | "current_only"
  | "pinned_only"
  | "workspace";
export type MemoryPolicy = "auto" | "off";
export type ExternalSearchPolicy = "off" | "allowed";
export type ActionApprovalMode = "require" | "auto_safe";

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
  actionApprovalMode: ActionApprovalMode;
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
  invocationContext?: AgentInvocationContext;
  workflowIntent?: AgentWorkflowSubmission;
};

export type AgentInvocationContext =
  | { kind: "note"; noteId: string; title?: string; selectionText?: string }
  | { kind: "source"; sourceId: string; title?: string; selectionText?: string }
  | { kind: "agent_file"; fileId: string; title?: string }
  | { kind: "canvas"; canvasId: string; title?: string }
  | { kind: "project"; projectId: string; title?: string };

export type AgentInvocationContextLabel = {
  labelKey:
    | "context.currentNote"
    | "context.selection"
    | "context.currentPdf"
    | "context.projectWide"
    | "context.file";
  title?: string;
  selectionCount?: number;
};

const MAX_SELECTION_CONTEXT_CHARS = 1200;

function boundedSelectionText(selectionText?: string): string | undefined {
  const trimmed = selectionText?.trim();
  if (!trimmed) return undefined;
  return Array.from(trimmed).slice(0, MAX_SELECTION_CONTEXT_CHARS).join("");
}

export function getAgentInvocationContext(
  activeTab: Tab | undefined,
  opts: { selectionText?: string } = {},
): AgentInvocationContext | null {
  if (!activeTab?.targetId) return null;
  const selectionText = boundedSelectionText(opts.selectionText);
  if (activeTab.kind === "project") {
    return {
      kind: "project",
      projectId: activeTab.targetId,
      title: activeTab.title,
    };
  }
  if (activeTab.kind === "agent_file") {
    return {
      kind: "agent_file",
      fileId: activeTab.targetId,
      title: activeTab.title,
    };
  }
  if (activeTab.kind === "note" && activeTab.mode === "canvas") {
    return {
      kind: "canvas",
      canvasId: activeTab.targetId,
      title: activeTab.title,
    };
  }
  if (activeTab.kind === "note" && activeTab.mode === "source") {
    return {
      kind: "source",
      sourceId: activeTab.targetId,
      title: activeTab.title,
      ...(selectionText ? { selectionText } : {}),
    };
  }
  if (activeTab.kind === "note") {
    return {
      kind: "note",
      noteId: activeTab.targetId,
      title: activeTab.title,
      ...(selectionText ? { selectionText } : {}),
    };
  }
  return null;
}

export function getAgentInvocationContextLabel(
  context: AgentInvocationContext | null,
): AgentInvocationContextLabel | null {
  if (!context) return null;
  const selectionText =
    "selectionText" in context ? context.selectionText : undefined;
  if (selectionText) {
    return {
      labelKey: "context.selection",
      title: context.title,
      selectionCount: Array.from(selectionText).length,
    };
  }
  if (context.kind === "note") {
    return { labelKey: "context.currentNote", title: context.title };
  }
  if (context.kind === "source") {
    return { labelKey: "context.currentPdf", title: context.title };
  }
  if (context.kind === "project") {
    return { labelKey: "context.projectWide", title: context.title };
  }
  return { labelKey: "context.file", title: context.title };
}

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
  actionApprovalMode?: ActionApprovalMode;
  command?: string;
  resolveNoteProjectId?: (noteId: string) => Promise<string | null>;
  fallbackProjectId?: string | null;
  attachedReferences?: ProjectTreeDragPayload[];
  workflowIntent?: AgentWorkflowSubmission;
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
    actionApprovalMode: opts.actionApprovalMode ?? "require",
    ...(opts.command ? { command: opts.command } : {}),
    ...(attachedArtifacts.length > 0 ? { attachedArtifacts } : {}),
  };

  const dedupedChips = new Map<string, AgentContextChip>();
  for (const chip of chips) {
    dedupedChips.set(`${chip.type}:${chip.id}`, chip);
  }

  return {
    manifest,
    chips: [...dedupedChips.values()],
    strict: "strict",
    ...(opts.workflowIntent ? { workflowIntent: opts.workflowIntent } : {}),
  };
}

export function defaultSourcePolicy(activeKind: TabKind | undefined): SourcePolicy {
  if (activeKind === "dashboard" || activeKind === "ws_settings") return "workspace";
  return "auto_project";
}
