"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, FileText, Folder, Search, Sparkles } from "lucide-react";
import type { TabKind } from "@/stores/tabs-store";

import type {
  ExternalSearchPolicy,
  MemoryPolicy,
  SourcePolicy,
} from "./context-manifest";

interface Props {
  activeKind: TabKind | undefined;
  sourcePolicy: SourcePolicy;
  memoryPolicy: MemoryPolicy;
  externalSearch: ExternalSearchPolicy;
  onSourcePolicyChange(next: SourcePolicy): void;
  onMemoryPolicyChange(next: MemoryPolicy): void;
  onExternalSearchChange(next: ExternalSearchPolicy): void;
}

const SOURCE_POLICIES: SourcePolicy[] = [
  "auto_project",
  "current_only",
  "pinned_only",
  "workspace",
];

export function ContextTray({
  activeKind,
  sourcePolicy,
  memoryPolicy,
  externalSearch,
  onSourcePolicyChange,
  onMemoryPolicyChange,
  onExternalSearchChange,
}: Props) {
  const t = useTranslations("agentPanel.contextTray");
  const [open, setOpen] = useState(false);
  const SummaryIcon =
    sourcePolicy === "workspace" ? Search : activeKind === "project" ? Folder : FileText;

  return (
    <div className="border-t border-border bg-background px-3 py-2">
      <div className="flex items-center gap-2 rounded-[var(--radius-control)] border border-border bg-muted/30 px-2.5 py-2 text-xs">
        <SummaryIcon aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-foreground">
            {t(summaryKey({ activeKind, sourcePolicy, memoryPolicy }))}
          </div>
          <div className="truncate text-muted-foreground">
            {externalSearch === "allowed" ? t("externalAllowed") : t("externalOff")}
          </div>
        </div>
        <button
          type="button"
          aria-label={t("change_aria")}
          className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-control)] border border-border bg-background px-2 text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
          onClick={() => setOpen((value) => !value)}
        >
          <Sparkles aria-hidden className="h-3.5 w-3.5" />
          <ChevronDown aria-hidden className="h-3.5 w-3.5" />
        </button>
      </div>
      {open ? (
        <div
          role="menu"
          className="mt-1 rounded-[var(--radius-card)] border border-border bg-background p-1 text-sm shadow-sm"
        >
          {SOURCE_POLICIES.map((policy) => (
            <button
              key={policy}
              type="button"
              role="menuitem"
              className="app-hover block w-full rounded-[var(--radius-control)] px-2 py-1.5 text-left"
              onClick={() => {
                onSourcePolicyChange(policy);
                setOpen(false);
              }}
            >
              {t(`policy.${policy}`)}
            </button>
          ))}
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            role="menuitem"
            className="app-hover block w-full rounded-[var(--radius-control)] px-2 py-1.5 text-left"
            onClick={() => {
              onMemoryPolicyChange(memoryPolicy === "auto" ? "off" : "auto");
              setOpen(false);
            }}
          >
            {memoryPolicy === "auto" ? t("memory.off") : t("memory.auto")}
          </button>
          <button
            type="button"
            role="menuitem"
            className="app-hover block w-full rounded-[var(--radius-control)] px-2 py-1.5 text-left"
            onClick={() => {
              onExternalSearchChange(
                externalSearch === "allowed" ? "off" : "allowed",
              );
              setOpen(false);
            }}
          >
            {externalSearch === "allowed" ? t("external.off") : t("external.allowed")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function summaryKey({
  activeKind,
  sourcePolicy,
  memoryPolicy,
}: {
  activeKind: TabKind | undefined;
  sourcePolicy: SourcePolicy;
  memoryPolicy: MemoryPolicy;
}): string {
  if (sourcePolicy === "current_only") return "summary.currentOnly";
  if (sourcePolicy === "pinned_only") return "summary.pinnedOnly";
  if (sourcePolicy === "workspace") {
    return memoryPolicy === "auto"
      ? "summary.workspaceMemory"
      : "summary.workspaceOnly";
  }
  if (
    activeKind === "note" ||
    activeKind === "agent_file" ||
    activeKind === "code_workspace" ||
    activeKind === "ingest" ||
    activeKind === "research_run"
  ) {
    return memoryPolicy === "auto"
      ? "summary.currentDocumentProjectMemory"
      : "summary.currentDocumentProject";
  }
  return memoryPolicy === "auto" ? "summary.projectMemory" : "summary.projectOnly";
}
