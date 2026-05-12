"use client";

import { useMemo, useState } from "react";
import { Check, ExternalLink, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { AgentAction } from "@opencairn/shared";

import { agentActionsApi } from "@/lib/api-client";
import { newTab } from "@/lib/tab-factory";
import { useTabsStore } from "@/stores/tabs-store";

const CHAT_NOTE_ACTIONS = new Set([
  "note.create",
  "note.create_from_markdown",
  "note.rename",
  "note.move",
  "note.delete",
  "note.restore",
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
    if (!CHAT_NOTE_ACTIONS.has(value.kind)) return;
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
  const title = actionTitle(action);
  const createdNote = noteResult(action);

  async function apply() {
    onBusyChange(true);
    try {
      const { action: updated } = await agentActionsApi.apply(action.id);
      onUpdated(updated);
      openCreatedNote(updated);
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
          {createdNote ? (
            <button
              type="button"
              aria-label={t("open")}
              disabled={busy}
              onClick={() => openNoteTab(createdNote)}
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
    </article>
  );
}

function statusKey(action: AgentAction): string {
  if (action.kind === "note.create" || action.kind === "note.create_from_markdown") {
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

function noteResult(action: AgentAction): { id: string; title: string } | null {
  if (
    (action.kind !== "note.create" &&
      action.kind !== "note.create_from_markdown") ||
    action.status !== "completed"
  ) {
    return null;
  }
  const note = isRecord(action.result) ? action.result.note : null;
  if (
    isRecord(note) &&
    typeof note.id === "string" &&
    typeof note.title === "string"
  ) {
    return { id: note.id, title: note.title };
  }
  return null;
}

function openCreatedNote(action: AgentAction) {
  const note = noteResult(action);
  if (note) openNoteTab(note);
}

function openNoteTab(note: { id: string; title: string }) {
  const tabs = useTabsStore.getState();
  const existing = tabs.findTabByTarget("note", note.id);
  if (existing) {
    tabs.promoteFromPreview(existing.id);
    tabs.setActive(existing.id);
    return;
  }
  tabs.addTab(
    newTab({
      kind: "note",
      targetId: note.id,
      title: note.title,
      mode: "plate",
      preview: false,
    }),
  );
}
