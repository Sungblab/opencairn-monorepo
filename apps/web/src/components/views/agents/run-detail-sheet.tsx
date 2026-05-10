"use client";

import { RotateCw, Square } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { Plan8AgentName, Plan8AgentRun } from "@/lib/api-client";

const TERMINAL_RUN_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "expired",
]);

function isRunTerminal(status: string): boolean {
  return TERMINAL_RUN_STATUSES.has(status);
}

export interface RunDetailSheetProps {
  run: Plan8AgentRun | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  formatDate: (value: string) => string;
  onRetry: (agentName: Plan8AgentName) => void;
  retryDisabled: boolean;
}

export function RunDetailSheet({
  run,
  open,
  onOpenChange,
  formatDate,
  onRetry,
  retryDisabled,
}: RunDetailSheetProps) {
  const t = useTranslations("agents");
  if (!run) return null;
  const terminal = isRunTerminal(run.status);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>
            {t("detail.title", { agent: t(`launch.${run.agentName}.name`) })}
          </SheetTitle>
          <SheetDescription>
            {terminal ? t("detail.pollingTerminal") : t("detail.pollingLive")}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-5 overflow-auto px-4">
          <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-muted-foreground">{t("detail.runId")}</dt>
            <dd className="break-all font-mono text-xs">{run.runId}</dd>
            <dt className="text-muted-foreground">{t("detail.workflowId")}</dt>
            <dd className="break-all font-mono text-xs">{run.workflowId}</dd>
            <dt className="text-muted-foreground">{t("tables.status")}</dt>
            <dd>
              {t.has(`status.${run.status}`)
                ? t(`status.${run.status}`)
                : run.status}
            </dd>
            <dt className="text-muted-foreground">{t("tables.started")}</dt>
            <dd>{formatDate(run.startedAt)}</dd>
            <dt className="text-muted-foreground">{t("detail.ended")}</dt>
            <dd>
              {run.endedAt ? formatDate(run.endedAt) : t("detail.notEnded")}
            </dd>
            <dt className="text-muted-foreground">{t("detail.cost")}</dt>
            <dd>{t("detail.costValue", { value: run.totalCostKrw })}</dd>
          </dl>

          {run.errorMessage ? (
            <div className="rounded border border-destructive/40 p-3 text-sm text-destructive">
              {run.errorMessage}
            </div>
          ) : null}

          <section>
            <h3 className="mb-2 text-sm font-semibold">
              {t("detail.outputs")}
            </h3>
            <div className="grid gap-2">
              <a
                className="app-btn-secondary h-8 rounded px-3 text-xs"
                href="#plan8-suggestions"
              >
                {t("detail.links.suggestions")}
              </a>
              <a
                className="app-btn-secondary h-8 rounded px-3 text-xs"
                href="#plan8-stale-alerts"
              >
                {t("detail.links.staleAlerts")}
              </a>
              <a
                className="app-btn-secondary h-8 rounded px-3 text-xs"
                href="#plan8-audio-files"
              >
                {t("detail.links.audioFiles")}
              </a>
            </div>
          </section>
        </div>

        <SheetFooter>
          <button
            type="button"
            className="app-btn-primary h-9 rounded px-3 text-sm"
            disabled={retryDisabled}
            onClick={() => onRetry(run.agentName)}
          >
            <RotateCw aria-hidden className="h-4 w-4" />
            {t("detail.retry")}
          </button>
          <button
            type="button"
            className="inline-flex h-9 items-center justify-center gap-2 rounded border border-border px-3 text-sm text-muted-foreground"
            disabled
          >
            <Square aria-hidden className="h-4 w-4" />
            {t("detail.cancel")}
          </button>
          <p className="text-xs text-muted-foreground">
            {t("detail.cancelUnavailable")}
          </p>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
