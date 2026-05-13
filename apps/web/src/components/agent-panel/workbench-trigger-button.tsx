"use client";

import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { AgentCommandId } from "./agent-commands";
import {
  studioToolsApi,
  type StudioToolProfileId,
} from "@/lib/api-client";
import { useAgentWorkbenchStore } from "@/stores/agent-workbench-store";
import { usePanelStore } from "@/stores/panel-store";

type BaseProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  children: ReactNode;
};

type StudioPreflightConfig = {
  projectId: string | null;
  profile: StudioToolProfileId;
  sourceTokenEstimate?: number;
  cachedTokenEstimate?: number;
};

export function WorkbenchCommandButton({
  commandId,
  preflight,
  onClick,
  children,
  ...props
}: BaseProps & { commandId: AgentCommandId; preflight?: StudioPreflightConfig }) {
  const t = useTranslations("project.tools.preflight");
  const requestCommand = useAgentWorkbenchStore((s) => s.requestCommand);
  const openAgentPanelTab = usePanelStore((s) => s.openAgentPanelTab);
  const [pendingConfirmation, setPendingConfirmation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const launch = () => {
    requestCommand(commandId);
    openAgentPanelTab("chat");
  };

  const runPreflightThenLaunch = async () => {
    if (!preflight?.projectId) {
      launch();
      return;
    }
    setBusy(true);
    setNotice(t("loading"));
    try {
      const { preflight: result } = await studioToolsApi.preflight(
        preflight.projectId,
        {
          tool: preflight.profile,
          sourceTokenEstimate: preflight.sourceTokenEstimate ?? 0,
          cachedTokenEstimate: preflight.cachedTokenEstimate,
        },
      );
      if (!result.canStart) {
        setPendingConfirmation(false);
        setNotice(
          t("blocked", {
            credits: result.cost.billableCredits,
            available: result.balance.availableCredits,
          }),
        );
        return;
      }
      if (result.requiresConfirmation) {
        setPendingConfirmation(true);
        setNotice(t("confirm", { credits: result.cost.billableCredits }));
        return;
      }
      setPendingConfirmation(false);
      setNotice(null);
      launch();
    } catch {
      setPendingConfirmation(false);
      setNotice(t("error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        {...props}
        type="button"
        disabled={props.disabled || busy}
        onClick={(event) => {
          onClick?.(event);
          if (event.defaultPrevented) return;
          if (pendingConfirmation) {
            setPendingConfirmation(false);
            setNotice(null);
            launch();
            return;
          }
          void runPreflightThenLaunch();
        }}
      >
        {pendingConfirmation ? t("confirmStart") : children}
      </button>
      {notice ? (
        <span className="text-[11px] leading-4 text-muted-foreground">
          {notice}
        </span>
      ) : null}
    </span>
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
