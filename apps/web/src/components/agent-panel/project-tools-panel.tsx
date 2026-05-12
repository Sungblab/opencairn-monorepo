"use client";

import { useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { LiteratureSearchModal } from "@/components/literature/literature-search-modal";
import { useIngestUpload } from "@/hooks/use-ingest-upload";
import { urls } from "@/lib/urls";
import { useAgentWorkbenchStore } from "@/stores/agent-workbench-store";
import type { AgentCommand, AgentCommandId } from "./agent-commands";
import { getAgentCommand } from "./agent-commands";
import {
  getToolDiscoveryGroups,
  type ToolDiscoveryItem,
} from "./tool-discovery-catalog";
import {
  getToolDiscoveryTileClassName,
  ToolDiscoveryTileContent,
} from "./tool-discovery-tile";

interface Props {
  projectId: string | null;
  workspaceId: string | null;
  wsSlug?: string;
  onRun(command: AgentCommand): void;
  onOpenActivity(): void;
}

const ACCEPT_ATTR = [
  "application/pdf",
  ".pdf",
  ".doc",
  ".docx",
  ".ppt",
  ".pptx",
  ".xls",
  ".xlsx",
  ".hwp",
  ".hwpx",
  "text/plain",
  "text/markdown",
  ".txt",
  ".md",
  "image/*",
  "audio/*",
  "video/*",
].join(",");

export function ProjectToolsPanel({
  projectId,
  workspaceId,
  wsSlug,
  onRun,
  onOpenActivity,
}: Props) {
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations("project.tools");
  const panelT = useTranslations("agentPanel.projectTools");
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadBatchInFlightRef = useRef(false);
  const [literatureOpen, setLiteratureOpen] = useState(false);
  const [uploadingLocal, setUploadingLocal] = useState(false);
  const { upload, isUploading } = useIngestUpload();
  const uploading = isUploading || uploadingLocal;
  const requestDocumentGenerationPreset = useAgentWorkbenchStore(
    (s) => s.requestDocumentGenerationPreset,
  );
  const toolGroups = useMemo(() => getToolDiscoveryGroups("agent_tools"), []);
  const disabled = !projectId;

  function runCommand(commandId: AgentCommandId) {
    const command = getAgentCommand(commandId);
    if (command) onRun(command);
  }

  function uploadFiles(files: FileList | null) {
    if (!projectId || !files) return;
    const selected = Array.from(files);
    if (selected.length === 0 || uploadBatchInFlightRef.current) return;
    uploadBatchInFlightRef.current = true;
    setUploadingLocal(true);
    void Promise.allSettled(selected.map((file) => upload(file, projectId))).finally(
      () => {
        uploadBatchInFlightRef.current = false;
        setUploadingLocal(false);
      },
    );
    onOpenActivity();
  }

  const routeDisabled = disabled || !wsSlug;

  function openRoute(route: "project_graph" | "project_agents" | "project_learn") {
    if (!projectId || !wsSlug) return;
    if (route === "project_graph") {
      router.push(urls.workspace.projectGraph(locale, wsSlug, projectId));
      return;
    }
    if (route === "project_agents") {
      router.push(urls.workspace.projectAgents(locale, wsSlug, projectId));
      return;
    }
    router.push(urls.workspace.projectLearn(locale, wsSlug, projectId));
  }

  function executeItem(item: ToolDiscoveryItem) {
    switch (item.action.type) {
      case "route":
        openRoute(item.action.route);
        return;
      case "upload":
        inputRef.current?.click();
        return;
      case "literature_search":
        setLiteratureOpen(true);
        return;
      case "workbench_command":
        runCommand(item.action.commandId);
        return;
      case "open_activity":
      case "open_review":
        onOpenActivity();
        return;
      case "document_generation_preset":
        requestDocumentGenerationPreset(item.action.presetId);
        onOpenActivity();
        return;
    }
  }

  function isItemDisabled(item: ToolDiscoveryItem): boolean {
    if (item.action.type === "route") return routeDisabled;
    if (item.action.type === "upload") return disabled || uploading;
    return disabled;
  }

  return (
    <div className="app-scrollbar-thin min-h-0 flex-1 overflow-y-auto bg-background p-2">
      <h3 className="sr-only">{panelT("title")}</h3>
      {!projectId ? (
        <p className="rounded-[var(--radius-control)] border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {panelT("noProject")}
        </p>
      ) : null}
      <div className="space-y-3">
        {toolGroups.map((group) => (
          <section key={group.category} className="space-y-1.5">
            <h4 className="px-1 text-[0.68rem] font-semibold uppercase tracking-normal text-muted-foreground">
              {t(`categories.${group.category}.title`)}
            </h4>
            <div className="grid grid-cols-2 gap-2">
              {group.items.map((item) => {
                const title =
                  item.action.type === "upload" && uploading
                    ? panelT("importing")
                    : t(`items.${item.i18nKey}.title`);
                return (
                  <ToolTile
                    key={item.id}
                    icon={item.icon}
                    title={title}
                    description={t(`items.${item.i18nKey}.description`)}
                    disabled={isItemDisabled(item)}
                    emphasis={item.emphasis}
                    onClick={() => executeItem(item)}
                  />
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={ACCEPT_ATTR}
        multiple
        onChange={(event) => {
          uploadFiles(event.currentTarget.files);
          event.currentTarget.value = "";
        }}
      />
      <LiteratureSearchModal
        open={literatureOpen}
        onOpenChange={setLiteratureOpen}
        workspaceId={workspaceId}
        defaultProjectId={projectId}
      />
    </div>
  );
}

function ToolTile({
  icon,
  title,
  description,
  disabled,
  emphasis = false,
  onClick,
}: {
  icon: ToolDiscoveryItem["icon"];
  title: string;
  description: string;
  disabled?: boolean;
  emphasis?: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={getToolDiscoveryTileClassName({ emphasis, size: "panel" })}
    >
      <ToolDiscoveryTileContent
        icon={icon}
        title={title}
        description={description}
        emphasis={emphasis}
      />
    </button>
  );
}
