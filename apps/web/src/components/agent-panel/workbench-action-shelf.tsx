"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  FileText,
  ListChecks,
  NotebookPen,
  Search,
  Sparkles,
} from "lucide-react";
import type { TabKind } from "@/stores/tabs-store";

import {
  AGENT_COMMANDS,
  type AgentCommand,
  type AgentCommandId,
} from "./agent-commands";

interface Props {
  activeKind: TabKind | undefined;
  disabled?: boolean;
  onRun(command: AgentCommand): void;
}

const DOCUMENT_ACTIONS: AgentCommandId[] = [
  "summarize",
  "research",
  "extract_citations",
  "make_note",
];
const PROJECT_ACTIONS: AgentCommandId[] = [
  "summarize",
  "research",
  "generate_report",
  "paper_search",
];
const FALLBACK_ACTIONS: AgentCommandId[] = [
  "summarize",
  "research",
  "generate_report",
];

const ICONS: Partial<Record<AgentCommandId, typeof Sparkles>> = {
  summarize: Sparkles,
  decompose: ListChecks,
  extract_citations: FileText,
  make_note: NotebookPen,
  research: Search,
  paper_search: Search,
  generate_report: FileText,
};

export function WorkbenchActionShelf({ activeKind, disabled, onRun }: Props) {
  const t = useTranslations("agentPanel.actionShelf");
  const commandT = useTranslations("agentPanel.composer.slash.command");
  const commands = useMemo(() => commandsForKind(activeKind), [activeKind]);

  return (
    <section
      aria-label={t("title")}
      className="border-b border-border bg-background px-2 py-1"
    >
      <h3 className="sr-only">{t("title")}</h3>
      <div className="app-scrollbar-thin flex gap-1 overflow-x-auto pb-0.5">
        {commands.map((command) => {
          const Icon = ICONS[command.id] ?? Sparkles;
          return (
            <button
              key={command.id}
              type="button"
              aria-label={`${command.aliases[0]} ${commandT(command.id)}`}
              disabled={disabled}
              className="app-hover flex h-8 min-w-0 shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] border border-border bg-background px-2 text-left text-xs disabled:opacity-50"
              onClick={() => onRun(command)}
            >
              <Icon aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="max-w-24 truncate">{commandT(command.id)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function commandsForKind(activeKind: TabKind | undefined): AgentCommand[] {
  const ids =
    activeKind === "note" ||
    activeKind === "agent_file" ||
    activeKind === "ingest" ||
    activeKind === "research_run"
      ? DOCUMENT_ACTIONS
      : activeKind === "project"
        ? PROJECT_ACTIONS
        : FALLBACK_ACTIONS;
  return ids
    .map((id) => AGENT_COMMANDS.find((command) => command.id === id))
    .filter((command): command is AgentCommand => Boolean(command));
}
