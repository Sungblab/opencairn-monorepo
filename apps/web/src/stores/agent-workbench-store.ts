import { create } from "zustand";
import type { AgentCommandId } from "@/components/agent-panel/agent-commands";
import type {
  DocumentGenerationPresetId,
  ToolDiscoveryItem,
} from "@/components/agent-panel/tool-discovery-catalog";
import type { StudyArtifactType } from "@opencairn/shared";

export type AgentWorkbenchIntent = {
  id: string;
  kind: "runCommand" | "applyContext";
  commandId: AgentCommandId;
};

export type DocumentGenerationPresetIntent = {
  id: string;
  presetId: DocumentGenerationPresetId;
};

export type AgentWorkflowKind =
  | "literature_search"
  | "study_artifact"
  | "document_generation"
  | "teach_to_learn"
  | "agent_prompt";

export type AgentWorkflowIntent = {
  id: string;
  kind: AgentWorkflowKind;
  toolId: string;
  i18nKey: string;
  prompt: string;
  artifactType?: StudyArtifactType;
  presetId?: DocumentGenerationPresetId;
  route?: Extract<ToolDiscoveryItem["action"], { type: "route" }>["route"];
};

export type AgentWorkflowSubmission = {
  kind: AgentWorkflowKind;
  toolId: string;
  prompt: string;
  payload?: Record<string, unknown>;
};

interface AgentWorkbenchState {
  pendingIntent: AgentWorkbenchIntent | null;
  pendingDocumentGenerationPreset: DocumentGenerationPresetIntent | null;
  pendingWorkflow: AgentWorkflowIntent | null;
  requestCommand(commandId: AgentCommandId): void;
  requestContext(commandId: AgentCommandId): void;
  consumeIntent(intentId: string): void;
  requestDocumentGenerationPreset(presetId: DocumentGenerationPresetId): void;
  consumeDocumentGenerationPreset(intentId: string): void;
  requestWorkflow(input: Omit<AgentWorkflowIntent, "id">): void;
  closeWorkflow(intentId: string): void;
}

let nextIntentId = 0;
let nextPresetIntentId = 0;
let nextWorkflowIntentId = 0;

export const useAgentWorkbenchStore = create<AgentWorkbenchState>()((set) => ({
  pendingIntent: null,
  pendingDocumentGenerationPreset: null,
  pendingWorkflow: null,
  requestCommand: (commandId) =>
    set({
      pendingIntent: {
        id: `intent-${++nextIntentId}`,
        kind: "runCommand",
        commandId,
      },
    }),
  requestContext: (commandId) =>
    set({
      pendingIntent: {
        id: `intent-${++nextIntentId}`,
        kind: "applyContext",
        commandId,
      },
    }),
  consumeIntent: (intentId) =>
    set((state) =>
      state.pendingIntent?.id === intentId ? { pendingIntent: null } : {},
    ),
  requestDocumentGenerationPreset: (presetId) =>
    set({
      pendingDocumentGenerationPreset: {
        id: `document-preset-${++nextPresetIntentId}`,
        presetId,
      },
    }),
  consumeDocumentGenerationPreset: (intentId) =>
    set((state) =>
      state.pendingDocumentGenerationPreset?.id === intentId
        ? { pendingDocumentGenerationPreset: null }
        : {},
    ),
  requestWorkflow: (input) =>
    set({
      pendingWorkflow: {
        ...input,
        id: `workflow-${++nextWorkflowIntentId}`,
      },
    }),
  closeWorkflow: (intentId) =>
    set((state) =>
      state.pendingWorkflow?.id === intentId ? { pendingWorkflow: null } : {},
    ),
}));
