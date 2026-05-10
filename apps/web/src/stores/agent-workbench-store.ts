import { create } from "zustand";
import type { AgentCommandId } from "@/components/agent-panel/agent-commands";

export type AgentWorkbenchIntent = {
  id: string;
  kind: "runCommand" | "applyContext";
  commandId: AgentCommandId;
};

interface AgentWorkbenchState {
  pendingIntent: AgentWorkbenchIntent | null;
  requestCommand(commandId: AgentCommandId): void;
  requestContext(commandId: AgentCommandId): void;
  consumeIntent(intentId: string): void;
}

let nextIntentId = 0;

export const useAgentWorkbenchStore = create<AgentWorkbenchState>()((set) => ({
  pendingIntent: null,
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
}));
