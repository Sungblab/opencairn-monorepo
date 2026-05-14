"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { ChevronRight, Star } from "lucide-react";

import {
  ProjectUploadDialog,
  useProjectUploadDialog,
} from "@/components/upload/project-upload-dialog";
import { integrationsApi } from "@/lib/api-client";
import { useAgentWorkbenchStore } from "@/stores/agent-workbench-store";
import {
  getToolDiscoveryGroups,
  type ToolDiscoveryItem,
} from "./tool-discovery-catalog";
import type { AgentCommand } from "./agent-commands";
import {
  getToolRouteHref,
  routeShouldOpenAsWorkflow,
  workflowForToolItem,
} from "./tool-discovery-actions";
import { ToolDiscoveryTileContent } from "./tool-discovery-tile";

interface Props {
  projectId: string | null;
  workspaceId: string | null;
  wsSlug?: string;
  onRun?(command: AgentCommand): void;
  onOpenActivity(): void;
  onOpenChat?(): void;
}

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
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [pendingUploadFiles, setPendingUploadFiles] = useState<File[]>([]);
  const [query, setQuery] = useState("");
  const [favoriteIds, setFavoriteIds] = useState(() =>
    readStoredToolIds(FAVORITE_TOOLS_KEY),
  );
  const [recentIds, setRecentIds] = useState(() =>
    readStoredToolIds(RECENT_TOOLS_KEY),
  );
  const upload = useProjectUploadDialog({
    projectId,
    openOriginal: false,
    onUploaded: onOpenActivity,
  });
  const uploading = upload.isUploading;
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

  const routeDisabled = disabled || !wsSlug;

  function openRoute(
    route: Extract<ToolDiscoveryItem["action"], { type: "route" }>["route"],
  ) {
    if (!projectId || !wsSlug) return;
    router.push(getToolRouteHref({ route, locale, wsSlug, projectId }));
  }

  function executeItem(item: ToolDiscoveryItem) {
    markRecent(item.id);
    switch (item.action.type) {
      case "route":
        if (routeShouldOpenAsWorkflow(item.action.route)) {
          requestWorkflow(workflowForToolItem(item));
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
        requestWorkflow(workflowForToolItem(item));
        onOpenChat();
        return;
      case "workbench_command":
        requestWorkflow(workflowForToolItem(item));
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
      <p className="mb-3 rounded-[var(--radius-control)] border border-border bg-muted/20 px-3 py-2 text-xs leading-5 text-muted-foreground">
        {panelT("sidebarPrimary")}
      </p>
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
      <ProjectUploadDialog
        projectId={projectId}
        open={uploadDialogOpen}
        onOpenChange={(open) => {
          setUploadDialogOpen(open);
          if (!open) setPendingUploadFiles([]);
        }}
        files={pendingUploadFiles}
        uploading={uploading}
        error={upload.hasUploadError}
        onFilesChange={setPendingUploadFiles}
        onStart={(intent) => {
          void upload.startUpload(pendingUploadFiles, intent).then((result) => {
            if (result?.ok) {
              setPendingUploadFiles([]);
              setUploadDialogOpen(false);
            }
          });
        }}
      />
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
