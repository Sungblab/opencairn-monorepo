import type { AgentWorkbenchIntent } from "@/stores/agent-workbench-store";
import { getAgentCommand, type AgentCommand } from "./agent-commands";

export function handleAgentWorkbenchIntent({
  intent,
  onRun,
  onContext,
  consume,
}: {
  intent: AgentWorkbenchIntent | null;
  onRun(command: AgentCommand): void;
  onContext?(command: AgentCommand): void;
  consume(intentId: string): void;
}) {
  if (!intent) return;

  const command = getAgentCommand(intent.commandId);
  if (command) {
    if (intent.kind === "applyContext") {
      onContext?.(command);
    } else {
      onRun(command);
    }
  }

  consume(intent.id);
}
