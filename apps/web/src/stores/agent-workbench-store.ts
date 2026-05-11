import { create } from "zustand";
import type { AgentCommandId } from "@/components/agent-panel/agent-commands";
import type { DocumentGenerationPresetId } from "@/components/agent-panel/tool-discovery-catalog";

export type AgentWorkbenchIntent = {
  id: string;
  kind: "runCommand" | "applyContext";
  commandId: AgentCommandId;
};

export type DocumentGenerationPresetIntent = {
  id: string;
  presetId: DocumentGenerationPresetId;
};

interface AgentWorkbenchState {
  pendingIntent: AgentWorkbenchIntent | null;
  pendingDocumentGenerationPreset: DocumentGenerationPresetIntent | null;
  requestCommand(commandId: AgentCommandId): void;
  requestContext(commandId: AgentCommandId): void;
  consumeIntent(intentId: string): void;
  requestDocumentGenerationPreset(presetId: DocumentGenerationPresetId): void;
  consumeDocumentGenerationPreset(intentId: string): void;
}

let nextIntentId = 0;
let nextPresetIntentId = 0;

export const useAgentWorkbenchStore = create<AgentWorkbenchState>()((set) => ({
  pendingIntent: null,
  pendingDocumentGenerationPreset: null,
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
}));
