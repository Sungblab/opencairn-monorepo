"use client";

import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  Activity,
  BookText,
  Bot,
  CheckSquare,
  DownloadCloud,
  FileText,
  FlaskConical,
  GraduationCap,
  Network,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { LiteratureSearchModal } from "@/components/literature/literature-search-modal";
import { useIngestUpload } from "@/hooks/use-ingest-upload";
import { urls } from "@/lib/urls";
import type { AgentCommand } from "./agent-commands";
import { getAgentCommand } from "./agent-commands";

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
  const [literatureOpen, setLiteratureOpen] = useState(false);
  const { upload, isUploading } = useIngestUpload();
  const disabled = !projectId;

  function runCommand(commandId: "research" | "paper_search") {
    const command = getAgentCommand(commandId);
    if (command) onRun(command);
  }

  function uploadFiles(files: FileList | null) {
    if (!projectId || !files) return;
    for (const file of Array.from(files)) {
      void upload(file, projectId).catch(() => {});
    }
    onOpenActivity();
  }

  function openProjectRoute(buildHref: (projectId: string) => string) {
    if (!projectId) return;
    router.push(buildHref(projectId));
  }

  const routeDisabled = disabled || !wsSlug;

  return (
    <div className="app-scrollbar-thin min-h-0 flex-1 overflow-y-auto bg-background p-2">
      <h3 className="sr-only">{panelT("title")}</h3>
      {!projectId ? (
        <p className="rounded-[var(--radius-control)] border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {panelT("noProject")}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <ToolTile
          icon={FlaskConical}
          title={t("research.title")}
          description={t("research.description")}
          disabled={disabled}
          onClick={() => runCommand("research")}
        />
        <ToolTile
          icon={DownloadCloud}
          title={isUploading ? panelT("importing") : t("import.title")}
          description={t("import.description")}
          disabled={disabled || isUploading}
          onClick={() => inputRef.current?.click()}
        />
        <ToolTile
          icon={BookText}
          title={t("literature.title")}
          description={t("literature.description")}
          disabled={disabled}
          onClick={() => setLiteratureOpen(true)}
        />
        <ToolTile
          icon={Network}
          title={t("graph.title")}
          description={t("graph.description")}
          disabled={routeDisabled}
          onClick={() =>
            openProjectRoute((id) =>
              urls.workspace.projectGraph(locale, wsSlug ?? "", id),
            )
          }
        />
        <ToolTile
          icon={Bot}
          title={t("agents.title")}
          description={t("agents.description")}
          disabled={routeDisabled}
          onClick={() =>
            openProjectRoute((id) =>
              urls.workspace.projectAgents(locale, wsSlug ?? "", id),
            )
          }
        />
        <ToolTile
          icon={Activity}
          title={t("runs.title")}
          description={t("runs.description")}
          disabled={disabled}
          onClick={onOpenActivity}
        />
        <ToolTile
          icon={GraduationCap}
          title={t("learn.title")}
          description={t("learn.description")}
          disabled={routeDisabled}
          onClick={() =>
            openProjectRoute((id) =>
              urls.workspace.projectLearn(locale, wsSlug ?? "", id),
            )
          }
        />
        <ToolTile
          icon={FileText}
          title={t("generateDocument.title")}
          description={t("generateDocument.description")}
          disabled={disabled}
          onClick={onOpenActivity}
        />
        <ToolTile
          icon={CheckSquare}
          title={t("reviewInbox.title")}
          description={t("reviewInbox.description")}
          disabled={disabled}
          onClick={onOpenActivity}
        />
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
  icon: Icon,
  title,
  description,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  disabled?: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="group flex min-h-28 flex-col gap-2 rounded-[var(--radius-control)] border border-border bg-background px-3 py-3 text-left text-foreground transition-colors hover:border-foreground hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
    >
      <Icon
        aria-hidden
        className="h-4 w-4 text-muted-foreground group-hover:text-foreground"
      />
      <span className="text-sm font-medium leading-5">{title}</span>
      <span className="line-clamp-2 text-xs leading-5 text-muted-foreground">
        {description}
      </span>
    </button>
  );
}
