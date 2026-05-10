"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { AgentCommandId } from "./agent-commands";
import { useAgentWorkbenchStore } from "@/stores/agent-workbench-store";
import { usePanelStore } from "@/stores/panel-store";

type BaseProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  children: ReactNode;
};

export function WorkbenchCommandButton({
  commandId,
  onClick,
  children,
  ...props
}: BaseProps & { commandId: AgentCommandId }) {
  const requestCommand = useAgentWorkbenchStore((s) => s.requestCommand);
  const openAgentPanelTab = usePanelStore((s) => s.openAgentPanelTab);

  return (
    <button
      {...props}
      type="button"
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        requestCommand(commandId);
        openAgentPanelTab("chat");
      }}
    >
      {children}
    </button>
  );
}

export function WorkbenchContextButton({
  commandId,
  onClick,
  children,
  ...props
}: BaseProps & { commandId: AgentCommandId }) {
  const requestContext = useAgentWorkbenchStore((s) => s.requestContext);
  const openAgentPanelTab = usePanelStore((s) => s.openAgentPanelTab);

  return (
    <button
      {...props}
      type="button"
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        requestContext(commandId);
        openAgentPanelTab("chat");
      }}
    >
      {children}
    </button>
  );
}

export function WorkbenchActivityButton({
  onClick,
  children,
  ...props
}: BaseProps) {
  const openAgentPanelTab = usePanelStore((s) => s.openAgentPanelTab);

  return (
    <button
      {...props}
      type="button"
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        openAgentPanelTab("activity");
      }}
    >
      {children}
    </button>
  );
}
