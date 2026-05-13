"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import type { StudyArtifactType } from "@opencairn/shared";

import { LiteratureSearchModal } from "@/components/literature/literature-search-modal";
import { useIngestUpload } from "@/hooks/use-ingest-upload";
import {
  integrationsApi,
  studioToolsApi,
  type StudioToolPreflightResponse,
} from "@/lib/api-client";
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
import { DeepResearchLaunchDialog } from "./deep-research-launch-dialog";
import { StudyArtifactGenerateDialog } from "./study-artifact-generate-dialog";

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

const FAVORITE_TOOLS_KEY = "opencairn.agentTools.favoriteIds";
const RECENT_TOOLS_KEY = "opencairn.agentTools.recentIds";
type PreflightState =
  | { status: "idle" }
  | { status: "loading"; itemId: string }
  | {
      status: "confirm";
      item: ToolDiscoveryItem;
      preflight: StudioToolPreflightResponse["preflight"];
    }
  | {
      status: "blocked";
      item: ToolDiscoveryItem;
      preflight: StudioToolPreflightResponse["preflight"];
    }
  | { status: "error"; item: ToolDiscoveryItem };

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
  const [query, setQuery] = useState("");
  const [favoriteIds, setFavoriteIds] = useState(() =>
    readStoredToolIds(FAVORITE_TOOLS_KEY),
  );
  const [recentIds, setRecentIds] = useState(() =>
    readStoredToolIds(RECENT_TOOLS_KEY),
  );
  const [preflightState, setPreflightState] = useState<PreflightState>({
    status: "idle",
  });
  const [studyArtifactType, setStudyArtifactType] =
    useState<StudyArtifactType | null>(null);
  const [deepResearchOpen, setDeepResearchOpen] = useState(false);
  const [deepResearchBillingPath, setDeepResearchBillingPath] =
    useState<"managed" | "byok">("byok");
  const { upload, isUploading } = useIngestUpload();
  const uploading = isUploading || uploadingLocal;
  const requestDocumentGenerationPreset = useAgentWorkbenchStore(
    (s) => s.requestDocumentGenerationPreset,
  );
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
    void Promise.allSettled(
      selected.map((file) => upload(file, projectId)),
    ).finally(() => {
      uploadBatchInFlightRef.current = false;
      setUploadingLocal(false);
    });
    onOpenActivity();
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
    if (route === "project_learn_flashcards") {
      router.push(
        urls.workspace.projectLearnFlashcards(locale, wsSlug, projectId),
      );
      return;
    }
    if (route === "project_learn_socratic") {
      router.push(
        urls.workspace.projectLearnSocratic(locale, wsSlug, projectId),
      );
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
    if (route === "workspace_import_web") {
      router.push(
        `${urls.workspace.import(locale, wsSlug)}?projectId=${encodeURIComponent(projectId)}&source=web`,
      );
      return;
    }
    if (route === "workspace_import_youtube") {
      router.push(
        `${urls.workspace.import(locale, wsSlug)}?projectId=${encodeURIComponent(projectId)}&source=youtube`,
      );
      return;
    }
    router.push(urls.workspace.projectLearn(locale, wsSlug, projectId));
  }

  function executeItemAfterPreflight(
    item: ToolDiscoveryItem,
    preflight?: StudioToolPreflightResponse["preflight"],
  ) {
    markRecent(item.id);
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
      case "deep_research":
        setDeepResearchBillingPath(preflight?.billingPath ?? "byok");
        setDeepResearchOpen(true);
        return;
      case "workbench_command":
        runCommand(item.action.commandId);
        return;
      case "study_artifact_generate":
        setStudyArtifactType(item.action.artifactType);
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

  async function executeItem(item: ToolDiscoveryItem) {
    if (!item.preflight || !projectId) {
      executeItemAfterPreflight(item);
      return;
    }
    setPreflightState({ status: "loading", itemId: item.id });
    try {
      const { preflight } = await studioToolsApi.preflight(projectId, {
        tool: item.preflight.tool,
        sourceTokenEstimate: item.preflight.sourceTokenEstimate,
      });
      if (!preflight.canStart) {
        setPreflightState({ status: "blocked", item, preflight });
        return;
      }
      if (preflight.requiresConfirmation) {
        setPreflightState({ status: "confirm", item, preflight });
        return;
      }
      setPreflightState({ status: "idle" });
      executeItemAfterPreflight(item, preflight);
    } catch {
      setPreflightState({ status: "error", item });
    }
  }

  function confirmPreflight() {
    if (preflightState.status !== "confirm") return;
    const { item, preflight } = preflightState;
    setPreflightState({ status: "idle" });
    executeItemAfterPreflight(item, preflight);
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
    if (
      preflightState.status === "blocked" &&
      preflightState.item.id === item.id
    ) {
      return true;
    }
    if (item.action.type === "route") return routeDisabled;
    if (item.action.type === "upload") return disabled || uploading;
    if (preflightState.status === "loading") return true;
    return disabled;
  }

  function unavailableLabel(item: ToolDiscoveryItem): string | null {
    if (
      preflightState.status === "blocked" &&
      preflightState.item.id === item.id
    ) {
      return panelT("unavailable.overQuota");
    }
    if (!projectId) return panelT("unavailable.missingProject");
    if (item.action.type === "route" && !wsSlug) {
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
      <PreflightBanner
        state={preflightState}
        confirmLabel={panelT("preflight.confirmStart")}
        cancelLabel={panelT("preflight.cancel")}
        loadingLabel={panelT("preflight.loading")}
        blockedLabel={
          preflightState.status === "blocked"
            ? panelT("preflight.blocked", {
                credits: preflightState.preflight.cost.billableCredits,
                available: preflightState.preflight.balance.availableCredits,
              })
            : ""
        }
        confirmText={
          preflightState.status === "confirm"
            ? panelT("preflight.confirm", {
                credits: preflightState.preflight.cost.billableCredits,
              })
            : ""
        }
        errorLabel={panelT("preflight.error")}
        onConfirm={confirmPreflight}
        onCancel={() => setPreflightState({ status: "idle" })}
      />
      <div className="space-y-3">
        {visibleToolGroups.map((group) => (
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
                    onClick={() => void executeItem(item)}
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
      <StudyArtifactGenerateDialog
        open={studyArtifactType !== null}
        projectId={projectId}
        defaultType={studyArtifactType ?? "quiz_set"}
        onOpenChange={(open) => {
          if (!open) setStudyArtifactType(null);
        }}
      />
      <DeepResearchLaunchDialog
        open={deepResearchOpen}
        workspaceId={workspaceId}
        projectId={projectId}
        wsSlug={wsSlug}
        billingPath={deepResearchBillingPath}
        onOpenChange={setDeepResearchOpen}
      />
    </div>
  );
}

function PreflightBanner({
  state,
  confirmLabel,
  cancelLabel,
  loadingLabel,
  blockedLabel,
  confirmText,
  errorLabel,
  onConfirm,
  onCancel,
}: {
  state: PreflightState;
  confirmLabel: string;
  cancelLabel: string;
  loadingLabel: string;
  blockedLabel: string;
  confirmText: string;
  errorLabel: string;
  onConfirm(): void;
  onCancel(): void;
}) {
  if (state.status === "idle") return null;
  if (state.status === "loading") {
    return (
      <p className="mb-3 rounded-[var(--radius-control)] border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        {loadingLabel}
      </p>
    );
  }
  const text =
    state.status === "confirm"
      ? confirmText
      : state.status === "blocked"
        ? blockedLabel
        : errorLabel;
  return (
    <div className="mb-3 rounded-[var(--radius-control)] border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      <p>{text}</p>
      {state.status === "confirm" ? (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-[var(--radius-control)] bg-foreground px-2 py-1 font-medium text-background"
          >
            {confirmLabel}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-[var(--radius-control)] border border-border px-2 py-1 font-medium text-foreground"
          >
            {cancelLabel}
          </button>
        </div>
      ) : null}
      {state.status === "blocked" || state.status === "error" ? (
        <button
          type="button"
          onClick={onCancel}
          className="mt-2 rounded-[var(--radius-control)] border border-border px-2 py-1 font-medium text-foreground"
        >
          {cancelLabel}
        </button>
      ) : null}
    </div>
  );
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
        className={getToolDiscoveryTileClassName({
          emphasis,
          size: "panel",
          className: "w-full pr-9",
        })}
      >
        <ToolDiscoveryTileContent
          icon={icon}
          title={title}
          description={description}
          emphasis={emphasis}
        />
        {unavailableLabel ? (
          <span className="mt-auto rounded-[var(--radius-control)] bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {unavailableLabel}
          </span>
        ) : null}
        {statusLabel ? (
          <span className="mt-auto rounded-[var(--radius-control)] border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {statusLabel}
          </span>
        ) : null}
        {favorite || recent ? (
          <span className="mt-auto flex flex-wrap gap-1 text-[11px] font-medium">
            {favorite ? (
              <span
                className={
                  emphasis
                    ? "text-primary-foreground/80"
                    : "text-muted-foreground"
                }
              >
                {favoriteActiveLabel}
              </span>
            ) : null}
            {recent ? (
              <span
                className={
                  emphasis
                    ? "text-primary-foreground/80"
                    : "text-muted-foreground"
                }
              >
                {recentActiveLabel}
              </span>
            ) : null}
          </span>
        ) : null}
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
