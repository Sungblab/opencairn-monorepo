"use client";

import { useTranslations } from "next-intl";
import { BookText } from "lucide-react";
import { useCurrentProjectContext } from "@/components/sidebar/use-current-project";
import { useAgentWorkbenchStore } from "@/stores/agent-workbench-store";
import { usePanelStore } from "@/stores/panel-store";

export interface LiteratureSearchButtonProps {
  wsSlug: string;
}

export function LiteratureSearchButton({
  wsSlug,
}: LiteratureSearchButtonProps) {
  const t = useTranslations("sidebar.nav");
  const { projectId } = useCurrentProjectContext();
  const requestWorkflow = useAgentWorkbenchStore((s) => s.requestWorkflow);
  const openAgentPanelTab = usePanelStore((s) => s.openAgentPanelTab);
  const label = t("literature");

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={!projectId || !wsSlug}
      onClick={() => {
        requestWorkflow({
          kind: "literature_search",
          toolId: "literature",
          i18nKey: "literature",
          prompt:
            "현재 프로젝트 주제에 맞는 논문을 찾아서 후보를 정리하고, 가져올 만한 자료를 추천해줘.",
        });
        openAgentPanelTab("chat");
      }}
      data-testid="sidebar-literature-button"
      className="flex min-h-8 w-full items-center gap-2 rounded-[var(--radius-control)] border border-border bg-background px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:border-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
    >
      <BookText aria-hidden className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}
