"use client";

// Shown in place of the conversation when no thread is active. Two short
// hints reassure the user the agent is workspace-grounded (so they don't
// expect generic chat-bot behavior) and point at the scope chips below as
// the way to widen or narrow that grounding before they even ask anything.
// The CTA mirrors the header "+" button so first-time users have an obvious
// in-content entry point — the icon-only header button isn't discoverable.

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";

interface Props {
  onStart(): void;
  busy?: boolean;
}

export function AgentPanelEmptyState({ onStart, busy }: Props) {
  const t = useTranslations("agentPanel.empty_state");
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm text-muted-foreground">{t("intro")}</p>
      <p className="text-xs text-muted-foreground">{t("hint")}</p>
      <button
        type="button"
        onClick={onStart}
        disabled={busy}
        className="inline-flex items-center gap-1 rounded border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
      >
        <Plus className="h-3.5 w-3.5" />
        <span>{t("start_cta")}</span>
      </button>
    </div>
  );
}
