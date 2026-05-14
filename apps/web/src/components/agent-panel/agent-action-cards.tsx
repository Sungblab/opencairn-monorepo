"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ExternalLink, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { AgentAction } from "@opencairn/shared";

import { agentActionsApi } from "@/lib/api-client";
import { newTab } from "@/lib/tab-factory";
import { useTabsStore } from "@/stores/tabs-store";
import { useTabNavigate } from "@/hooks/use-tab-navigate";

const CHAT_PROJECT_ACTIONS = new Set([
  "note.create",
  "note.create_from_markdown",
  "note.rename",
  "note.move",
  "note.delete",
  "note.restore",
  "file.create",
  "file.update",
  "file.delete",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAgentAction(value: unknown): value is AgentAction {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.kind === "string" &&
    typeof value.status === "string" &&
    isRecord(value.input)
  );
}

export function asAgentActionCards(...values: unknown[]): AgentAction[] {
  const seen = new Set<string>();
  const actions: AgentAction[] = [];

  function visit(value: unknown) {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (isRecord(value) && "action" in value) {
      visit(value.action);
      return;
    }
    if (!isAgentAction(value)) return;
    if (!CHAT_PROJECT_ACTIONS.has(value.kind)) return;
    if (seen.has(value.id)) return;
    seen.add(value.id);
    actions.push(value);
  }

  values.forEach(visit);
  return actions;
}

export function AgentActionCards({ actions }: { actions: AgentAction[] }) {
  const normalized = useMemo(() => asAgentActionCards(actions), [actions]);
  const [overrides, setOverrides] = useState<Record<string, AgentAction>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const actionIds = useMemo(
    () => normalized.map((action) => action.id).join(","),
    [normalized],
  );

  useEffect(() => {
    if (!actionIds) return;
    let cancelled = false;
    void (async () => {
      const results = await Promise.allSettled(
        normalized.map((action) => agentActionsApi.get(action.id)),
      );
      if (cancelled) return;
      const fresh: Record<string, AgentAction> = {};
      for (const result of results) {
        if (result.status === "fulfilled") {
          fresh[result.value.action.id] = result.value.action;
        }
      }
      if (Object.keys(fresh).length > 0) {
        setOverrides((current) => ({ ...current, ...fresh }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [actionIds, normalized]);

  if (normalized.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {normalized.map((action) => (
        <AgentActionCard
          key={action.id}
          action={overrides[action.id] ?? action}
          busy={busyId === action.id}
          onUpdated={(updated) =>
            setOverrides((current) => ({ ...current, [updated.id]: updated }))
          }
          onBusyChange={(busy) => setBusyId(busy ? action.id : null)}
        />
      ))}
    </div>
  );
}

function AgentActionCard({
  action,
  busy,
  onUpdated,
  onBusyChange,
}: {
  action: AgentAction;
  busy: boolean;
  onUpdated(action: AgentAction): void;
  onBusyChange(busy: boolean): void;
}) {
  const t = useTranslations("agentPanel.actionCard");
  const navigate = useTabNavigate();
  const title = actionTitle(action);
  const openTarget = openableResult(action);
  const openLabel =
    openTarget?.kind === "agent_file" ? t("openFile") : t("openNote");

  async function apply() {
    onBusyChange(true);
    try {
      const { action: updated } = await agentActionsApi.apply(action.id);
      onUpdated(updated);
      openCreatedTarget(updated, navigate);
    } finally {
      onBusyChange(false);
    }
  }

  async function reject() {
    onBusyChange(true);
    try {
      const { action: updated } = await agentActionsApi.transitionStatus(
        action.id,
        { status: "cancelled" },
      );
      onUpdated(updated);
    } finally {
      onBusyChange(false);
    }
  }

  return (
    <article className="rounded-[var(--radius-card)] border border-border bg-background/90 px-3 py-2 text-sm shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-foreground">
            {t(statusKey(action))}
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">
            {title}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          {busy ? (
            <span className="grid h-7 w-7 place-items-center rounded-[var(--radius-control)] border border-border text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            </span>
          ) : null}
          {action.status === "approval_required" ? (
            <>
              <button
                type="button"
                aria-label={t("reject")}
                disabled={busy}
                onClick={reject}
                className="rounded-[var(--radius-control)] border border-border p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button
                type="button"
                aria-label={t("apply")}
                disabled={busy}
                onClick={apply}
                className="rounded-[var(--radius-control)] border border-foreground bg-foreground p-1.5 text-background disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" aria-hidden />
              </button>
            </>
          ) : null}
          {openTarget ? (
            <button
              type="button"
              aria-label={openLabel}
              disabled={busy}
              onClick={() => openTargetTab(openTarget, navigate)}
              className="rounded-[var(--radius-control)] border border-border p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
      </div>
      {action.status === "failed" && action.errorCode ? (
        <div className="mt-2 text-xs text-destructive">{action.errorCode}</div>
      ) : null}
      {openTarget?.kind === "agent_file" && openTarget.fileKind === "image" ? (
        <img
          src={`/api/agent-files/${encodeURIComponent(openTarget.id)}/file`}
          alt={openTarget.title}
          className="mt-2 max-h-44 w-full rounded-[var(--radius-control)] border border-border object-contain"
        />
      ) : null}
    </article>
  );
}

function statusKey(action: AgentAction): string {
  if (
    action.kind === "note.create" ||
    action.kind === "note.create_from_markdown"
  ) {
    if (action.status === "completed") return "noteCreateCompleted";
    if (action.status === "approval_required") return "noteCreateApproval";
    if (action.status === "running" || action.status === "queued") {
      return "noteCreateRunning";
    }
  }
  if (action.status === "cancelled") return "cancelled";
  if (action.status === "failed") return "failed";
  if (action.status === "completed") return "completed";
  if (action.status === "approval_required") return "approval";
  return "running";
}

function actionTitle(action: AgentAction): string {
  if (typeof action.input.title === "string") return action.input.title;
  if (typeof action.input.noteId === "string") return action.input.noteId;
  return action.kind;
}

type OpenTarget =
  | { kind: "note"; id: string; title: string }
  | { kind: "agent_file"; id: string; title: string; fileKind?: string };

function openableResult(action: AgentAction): OpenTarget | null {
  if (action.status !== "completed") return null;
  if (
    action.kind === "note.create" ||
    action.kind === "note.create_from_markdown"
  ) {
    const note = isRecord(action.result) ? action.result.note : null;
    if (
      isRecord(note) &&
      typeof note.id === "string" &&
      typeof note.title === "string"
    ) {
      return { kind: "note", id: note.id, title: note.title };
    }
  }
  if (action.kind === "file.create" || action.kind === "file.update") {
    const file = isRecord(action.result) ? action.result.file : null;
    if (
      isRecord(file) &&
      typeof file.id === "string" &&
      typeof file.title === "string"
    ) {
      return {
        kind: "agent_file",
        id: file.id,
        title: file.title,
        ...(typeof file.kind === "string" ? { fileKind: file.kind } : {}),
      };
    }
  }
  return null;
}

function openCreatedTarget(
  action: AgentAction,
  navigate: ReturnType<typeof useTabNavigate>,
) {
  const target = openableResult(action);
  if (target) openTargetTab(target, navigate);
}

function openTargetTab(
  target: OpenTarget,
  navigate: ReturnType<typeof useTabNavigate>,
) {
  const tabs = useTabsStore.getState();
  const existing = tabs.findTabByTarget(target.kind, target.id);
  const route = {
    kind: target.kind,
    targetId: target.id,
    mode:
      target.kind === "note" ? ("plate" as const) : ("agent-file" as const),
  };
  if (existing) {
    tabs.promoteFromPreview(existing.id);
    tabs.setActive(existing.id);
    navigate(route);
    return;
  }
  tabs.addTab(
    newTab({
      kind: target.kind,
      targetId: target.id,
      title: target.title,
      mode: target.kind === "note" ? "plate" : "agent-file",
      preview: false,
    }),
  );
  navigate(route);
}
