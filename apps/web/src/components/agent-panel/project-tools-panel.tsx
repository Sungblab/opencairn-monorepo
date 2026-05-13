"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { ChevronRight, Star, UploadCloud } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useIngestUpload } from "@/hooks/use-ingest-upload";
import { integrationsApi } from "@/lib/api-client";
import { urls } from "@/lib/urls";
import {
  useAgentWorkbenchStore,
  type AgentWorkflowIntent,
} from "@/stores/agent-workbench-store";
import {
  getToolDiscoveryGroups,
  type ToolDiscoveryItem,
} from "./tool-discovery-catalog";
import type { AgentCommand } from "./agent-commands";
import { ToolDiscoveryTileContent } from "./tool-discovery-tile";

interface Props {
  projectId: string | null;
  workspaceId: string | null;
  wsSlug?: string;
  onRun?(command: AgentCommand): void;
  onOpenActivity(): void;
  onOpenChat?(): void;
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

const FAVORITE_TOOLS_KEY = "opencairn.agentTools.favoriteIds";
const RECENT_TOOLS_KEY = "opencairn.agentTools.recentIds";

function readStoredToolIds(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

function writeStoredToolIds(key: string, value: string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function ProjectToolsPanel({
  projectId,
  workspaceId,
  wsSlug,
  onOpenActivity,
  onOpenChat = () => {},
}: Props) {
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations("project.tools");
  const panelT = useTranslations("agentPanel.projectTools");
  const uploadT = useTranslations("sidebar.upload");
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadBatchInFlightRef = useRef(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [pendingUploadFiles, setPendingUploadFiles] = useState<File[]>([]);
  const [uploadError, setUploadError] = useState(false);
  const [uploadingLocal, setUploadingLocal] = useState(false);
  const [query, setQuery] = useState("");
  const [favoriteIds, setFavoriteIds] = useState(() =>
    readStoredToolIds(FAVORITE_TOOLS_KEY),
  );
  const [recentIds, setRecentIds] = useState(() =>
    readStoredToolIds(RECENT_TOOLS_KEY),
  );
  const { uploadMany, isUploading } = useIngestUpload();
  const uploading = isUploading || uploadingLocal;
  const requestWorkflow = useAgentWorkbenchStore((s) => s.requestWorkflow);
  const toolGroups = useMemo(() => getToolDiscoveryGroups("agent_tools"), []);
  const favoriteIdSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const recentIdSet = useMemo(() => new Set(recentIds), [recentIds]);
  const visibleToolGroups = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return toolGroups;
    return toolGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          const haystack = [
            item.id,
            item.i18nKey,
            item.category,
            t(`items.${item.i18nKey}.title`),
            t(`items.${item.i18nKey}.description`),
          ]
            .join(" ")
            .toLowerCase();
          return haystack.includes(normalizedQuery);
        }),
      }))
      .filter((group) => group.items.length > 0);
  }, [query, t, toolGroups]);
  const disabled = !projectId;
  const googleIntegrationQuery = useQuery({
    queryKey: ["project-tools-google-integration", workspaceId],
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
    retry: false,
    queryFn: () => integrationsApi.google(workspaceId!),
  });
  const googleConnected = googleIntegrationQuery.isError
    ? false
    : (googleIntegrationQuery.data?.connected ?? null);

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key === FAVORITE_TOOLS_KEY) {
        setFavoriteIds(readStoredToolIds(FAVORITE_TOOLS_KEY));
      } else if (event.key === RECENT_TOOLS_KEY) {
        setRecentIds(readStoredToolIds(RECENT_TOOLS_KEY));
      }
    }
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  function uploadFiles(files: Iterable<File> | ArrayLike<File> | null) {
    if (!projectId || !files) return;
    const selected = Array.from(files);
    if (selected.length === 0 || uploadBatchInFlightRef.current) return;
    uploadBatchInFlightRef.current = true;
    setUploadError(false);
    setUploadingLocal(true);
    void uploadMany(selected, projectId, { concurrency: 3 })
      .then((results) => {
        const failed = results.some((item) => !item.ok);
        setUploadError(failed);
        if (!failed) {
          setPendingUploadFiles([]);
          setUploadDialogOpen(false);
        }
        onOpenActivity();
      })
      .catch(() => {
        setUploadError(true);
      })
      .finally(() => {
        uploadBatchInFlightRef.current = false;
        setUploadingLocal(false);
      });
  }

  const routeDisabled = disabled || !wsSlug;

  function openRoute(
    route: Extract<ToolDiscoveryItem["action"], { type: "route" }>["route"],
  ) {
    if (!projectId || !wsSlug) return;
    if (route === "project_graph") {
      router.push(urls.workspace.projectGraph(locale, wsSlug, projectId));
      return;
    }
    if (route === "project_graph_mindmap") {
      router.push(
        `${urls.workspace.projectGraph(locale, wsSlug, projectId)}?view=mindmap`,
      );
      return;
    }
    if (route === "project_agents") {
      router.push(urls.workspace.projectAgents(locale, wsSlug, projectId));
      return;
    }
    if (route === "workspace_integrations") {
      router.push(
        urls.workspace.settingsSection(
          locale,
          wsSlug,
          "workspace",
          "integrations",
        ),
      );
      return;
    }
    router.push(urls.workspace.projectLearn(locale, wsSlug, projectId));
  }

  function executeItem(item: ToolDiscoveryItem) {
    markRecent(item.id);
    switch (item.action.type) {
      case "route":
        if (routeShouldOpenAsWorkflow(item.action.route)) {
          requestWorkflow(workflowForItem(item));
          onOpenChat();
          return;
        }
        openRoute(item.action.route);
        return;
      case "upload":
        setUploadDialogOpen(true);
        return;
      case "literature_search":
      case "deep_research":
      case "study_artifact_generate":
      case "document_generation_preset":
        requestWorkflow(workflowForItem(item));
        onOpenChat();
        return;
      case "workbench_command":
        requestWorkflow(workflowForItem(item));
        onOpenChat();
        return;
      case "open_activity":
      case "open_review":
        onOpenActivity();
        return;
    }
  }

  function markRecent(itemId: string) {
    setRecentIds((current) => {
      const next = [itemId, ...current.filter((id) => id !== itemId)].slice(
        0,
        8,
      );
      writeStoredToolIds(RECENT_TOOLS_KEY, next);
      return next;
    });
  }

  function toggleFavorite(itemId: string) {
    setFavoriteIds((current) => {
      const next = current.includes(itemId)
        ? current.filter((id) => id !== itemId)
        : [itemId, ...current];
      writeStoredToolIds(FAVORITE_TOOLS_KEY, next);
      return next;
    });
  }

  function isItemDisabled(item: ToolDiscoveryItem): boolean {
    if (item.action.type === "route") {
      return routeShouldOpenAsWorkflow(item.action.route)
        ? disabled
        : routeDisabled;
    }
    if (item.action.type === "upload") return disabled || uploading;
    return disabled;
  }

  function unavailableLabel(item: ToolDiscoveryItem): string | null {
    if (!projectId) return panelT("unavailable.missingProject");
    if (
      item.action.type === "route" &&
      !routeShouldOpenAsWorkflow(item.action.route) &&
      !wsSlug
    ) {
      return panelT("unavailable.missingWorkspace");
    }
    return null;
  }

  function statusLabel(item: ToolDiscoveryItem): string | null {
    if (item.id !== "connected_sources" || !workspaceId) return null;
    if (googleConnected === null) {
      return t("integrationStatus.checking");
    }
    return googleConnected
      ? t("integrationStatus.connected")
      : t("integrationStatus.disconnected");
  }

  return (
    <div className="app-scrollbar-thin min-h-0 flex-1 overflow-y-auto bg-background p-2">
      <h3 className="sr-only">{panelT("title")}</h3>
      {!projectId ? (
        <p className="rounded-[var(--radius-control)] border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {panelT("noProject")}
        </p>
      ) : null}
      <div className="mb-3">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder={panelT("searchPlaceholder")}
          className="h-9 w-full rounded-[var(--radius-control)] border border-border bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-foreground"
        />
      </div>
      <div className="space-y-3">
        {visibleToolGroups.map((group) => (
          <section key={group.category} className="space-y-1.5">
            <h4 className="px-1 text-[0.68rem] font-semibold uppercase tracking-normal text-muted-foreground">
              {t(`categories.${group.category}.title`)}
            </h4>
            <div className="grid gap-1">
              {group.items.map((item) => {
                const title =
                  item.action.type === "upload" && uploading
                    ? panelT("importing")
                    : t(`items.${item.i18nKey}.title`);
                return (
                  <ToolTile
                    key={item.id}
                    itemId={item.id}
                    icon={item.icon}
                    title={title}
                    description={t(`items.${item.i18nKey}.description`)}
                    disabled={isItemDisabled(item)}
                    unavailableLabel={unavailableLabel(item)}
                    statusLabel={statusLabel(item)}
                    emphasis={item.emphasis}
                    favorite={favoriteIdSet.has(item.id)}
                    recent={recentIdSet.has(item.id)}
                    favoriteLabel={panelT("favorite")}
                    unfavoriteLabel={panelT("unfavorite")}
                    favoriteActiveLabel={panelT("favoriteActive")}
                    recentActiveLabel={panelT("recentActive")}
                    onToggleFavorite={() => toggleFavorite(item.id)}
                    onClick={() => executeItem(item)}
                  />
                );
              })}
            </div>
          </section>
        ))}
        {visibleToolGroups.length === 0 ? (
          <p className="rounded-[var(--radius-control)] border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            {panelT("noMatches")}
          </p>
        ) : null}
      </div>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={ACCEPT_ATTR}
        multiple
        onChange={(event) => {
          const selected = event.currentTarget.files
            ? Array.from(event.currentTarget.files)
            : [];
          setPendingUploadFiles(selected);
          event.currentTarget.value = "";
        }}
      />
      <Dialog
        open={uploadDialogOpen}
        onOpenChange={(open) => {
          if (uploading) return;
          setUploadDialogOpen(open);
          if (!open) {
            setPendingUploadFiles([]);
            setUploadError(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{uploadT("title")}</DialogTitle>
            <DialogDescription>{uploadT("description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div
              className="flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border border-dashed border-border bg-muted/20 px-4 text-center text-sm transition hover:border-foreground hover:bg-muted/40"
              role="button"
              tabIndex={0}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  inputRef.current?.click();
                }
              }}
              onDragOver={(event) => {
                event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                setUploadError(false);
                setPendingUploadFiles(Array.from(event.dataTransfer.files));
              }}
            >
              <UploadCloud
                aria-hidden
                className="h-7 w-7 text-muted-foreground"
              />
              <span className="font-medium">
                {pendingUploadFiles.length === 1
                  ? uploadT("selected", { name: pendingUploadFiles[0]!.name })
                  : pendingUploadFiles.length > 1
                    ? uploadT("selected_many", {
                        count: pendingUploadFiles.length,
                      })
                    : uploadT("drop")}
              </span>
              <span className="max-w-sm text-xs leading-5 text-muted-foreground">
                {uploadT("hint")}
              </span>
            </div>
            {uploadError ? (
              <p role="alert" className="text-sm text-destructive">
                {uploadT("error")}
              </p>
            ) : null}
            <button
              type="button"
              disabled={pendingUploadFiles.length === 0 || uploading}
              onClick={() => uploadFiles(pendingUploadFiles)}
              className="inline-flex min-h-10 w-full items-center justify-center rounded bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {uploading ? uploadT("uploading") : uploadT("start")}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function workflowPrompt(toolId: string): string {
  switch (toolId) {
    case "literature":
      return "현재 프로젝트 주제에 맞는 논문을 찾아서 후보를 정리하고, 가져올 만한 자료를 추천해줘.";
    case "research":
      return "현재 프로젝트 자료를 바탕으로 깊이 있는 리서치를 시작해줘. 필요한 외부 자료와 근거를 함께 찾아줘.";
    case "summarize":
      return "현재 프로젝트 자료를 핵심 개념, 근거, 시험/활용 포인트 중심으로 요약해줘.";
    case "pdf_report_fast":
      return "현재 프로젝트 자료를 바탕으로 빠르게 공유할 수 있는 PDF 보고서를 만들어줘.";
    case "pdf_report_latex":
      return "현재 프로젝트 자료를 바탕으로 논문형 LaTeX PDF 보고서를 만들어줘.";
    case "docx_report":
      return "현재 프로젝트 자료를 바탕으로 편집 가능한 DOCX 보고서를 만들어줘.";
    case "pptx_deck":
      return "현재 프로젝트 자료를 발표자료 흐름으로 정리해줘.";
    case "xlsx_table":
      return "현재 프로젝트 자료를 비교 가능한 표와 스프레드시트로 정리해줘.";
    case "source_figure":
      return "현재 프로젝트 자료를 설명하는 핵심 피규어나 구조도를 만들어줘.";
    case "study_artifact_generator":
      return "현재 프로젝트 자료로 학습 자료를 만들어줘. 먼저 적절한 유형과 난이도를 제안해줘.";
    case "flashcards":
      return "현재 프로젝트 자료로 플래시카드를 만들어줘. 핵심 개념, 정의, 예시, 시험 포인트를 포함해줘.";
    case "teach_to_learn":
      return "현재 프로젝트 자료를 바탕으로 나에게 질문하면서 설명하는 Teach to Learn 세션을 시작해줘.";
    case "web_import":
      return "웹 URL을 현재 프로젝트 자료로 가져오고 요약까지 이어갈 수 있게 도와줘.";
    case "youtube_import":
      return "YouTube URL을 현재 프로젝트 자료로 가져오고 핵심 내용을 정리할 수 있게 도와줘.";
    default:
      return "현재 프로젝트 자료를 바탕으로 이 작업을 진행해줘.";
  }
}

function routeShouldOpenAsWorkflow(
  route: Extract<ToolDiscoveryItem["action"], { type: "route" }>["route"],
): boolean {
  return (
    route === "project_learn" ||
    route === "project_learn_flashcards" ||
    route === "project_learn_socratic" ||
    route === "workspace_import_web" ||
    route === "workspace_import_youtube"
  );
}

function workflowForItem(item: ToolDiscoveryItem): Omit<AgentWorkflowIntent, "id"> {
  switch (item.action.type) {
    case "literature_search":
      return {
        kind: "literature_search",
        toolId: item.id,
        i18nKey: item.i18nKey,
        prompt: workflowPrompt(item.id),
      };
    case "study_artifact_generate":
      return {
        kind: "study_artifact",
        toolId: item.id,
        i18nKey: item.i18nKey,
        prompt: workflowPrompt(item.id),
        artifactType: item.action.artifactType,
      };
    case "document_generation_preset":
      return {
        kind: "document_generation",
        toolId: item.id,
        i18nKey: item.i18nKey,
        prompt: workflowPrompt(item.id),
        presetId: item.action.presetId,
      };
    case "deep_research":
      return {
        kind: "agent_prompt",
        toolId: item.id,
        i18nKey: item.i18nKey,
        prompt: workflowPrompt(item.id),
      };
    case "workbench_command":
      return {
        kind: "agent_prompt",
        toolId: item.id,
        i18nKey: item.i18nKey,
        prompt: workflowPrompt(item.id),
      };
    case "route":
      return {
        kind:
          item.action.route === "project_learn_socratic"
            ? "teach_to_learn"
            : "agent_prompt",
        toolId: item.id,
        i18nKey: item.i18nKey,
        prompt: workflowPrompt(item.id),
        route: item.action.route,
      };
    default:
      return {
        kind: "agent_prompt",
        toolId: item.id,
        i18nKey: item.i18nKey,
        prompt: workflowPrompt(item.id),
      };
  }
}

function ToolTile({
  itemId,
  icon,
  title,
  description,
  disabled,
  unavailableLabel,
  statusLabel,
  emphasis = false,
  favorite,
  recent,
  favoriteLabel,
  unfavoriteLabel,
  favoriteActiveLabel,
  recentActiveLabel,
  onToggleFavorite,
  onClick,
}: {
  itemId: string;
  icon: ToolDiscoveryItem["icon"];
  title: string;
  description: string;
  disabled?: boolean;
  unavailableLabel?: string | null;
  statusLabel?: string | null;
  emphasis?: boolean;
  favorite: boolean;
  recent: boolean;
  favoriteLabel: string;
  unfavoriteLabel: string;
  favoriteActiveLabel: string;
  recentActiveLabel: string;
  onToggleFavorite(): void;
  onClick(): void;
}) {
  return (
    <div data-tool-tile={itemId} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className={`group flex min-h-12 w-full items-center gap-2 rounded-[var(--radius-control)] border px-2.5 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${
          emphasis
            ? "border-foreground/20 bg-foreground text-background hover:opacity-90"
            : "border-transparent bg-background text-foreground hover:border-border hover:bg-muted/60"
        }`}
      >
        <ToolDiscoveryTileContent
          icon={icon}
          title={title}
          description={description}
          emphasis={emphasis}
          layout="row"
        />
        <span className="ml-auto flex shrink-0 items-center gap-1 pr-7">
          {unavailableLabel ? (
            <span className="rounded-[var(--radius-control)] bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {unavailableLabel}
            </span>
          ) : null}
          {statusLabel ? (
            <span className="rounded-[var(--radius-control)] border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {statusLabel}
            </span>
          ) : null}
          {favorite ? (
            <span
              className={
                emphasis ? "text-background/70" : "text-muted-foreground"
              }
            >
              {favoriteActiveLabel}
            </span>
          ) : recent ? (
            <span
              className={
                emphasis ? "text-background/70" : "text-muted-foreground"
              }
            >
              {recentActiveLabel}
            </span>
          ) : null}
          <ChevronRight
            aria-hidden
            className={`size-3.5 ${
              emphasis ? "text-background/70" : "text-muted-foreground"
            }`}
          />
        </span>
      </button>
      <button
        type="button"
        aria-label={favorite ? unfavoriteLabel : favoriteLabel}
        onClick={onToggleFavorite}
        className="absolute right-2 top-2 inline-flex size-7 items-center justify-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Star
          aria-hidden
          className="size-4"
          fill={favorite ? "currentColor" : "none"}
        />
      </button>
    </div>
  );
}
