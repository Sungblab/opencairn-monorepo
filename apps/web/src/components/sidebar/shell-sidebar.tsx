"use client";
import type { ComponentType, ReactNode } from "react";
import { urls } from "@/lib/urls";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  Bot,
  ChevronLeft,
  ExternalLink,
  FileText,
  GraduationCap,
  HelpCircle,
  Home,
  MessageSquare,
  MoreHorizontal,
  Network,
  Newspaper,
  Settings,
  Share2,
  Sparkles,
  Star,
  Trash2,
  Wrench,
} from "lucide-react";
import { ScopedSearch } from "./scoped-search";
import { ProjectTree } from "./project-tree";
import { SidebarFooter } from "./sidebar-footer";
import { useCurrentProjectContext } from "./use-current-project";
import { NewNoteButton } from "./NewNoteButton";
import { NewFolderButton } from "./NewFolderButton";
import { NewCanvasButton } from "./NewCanvasButton";
import { SourceUploadButton } from "./SourceUploadButton";
import { NewCodeWorkspaceButton } from "./NewCodeWorkspaceButton";
import { GenerateDocumentButton } from "./GenerateDocumentButton";
import { ProjectHero } from "./project-hero";
import { MoreMenu } from "./more-menu";
import { SidebarEmptyState } from "./sidebar-empty-state";
import { usePanelStore } from "@/stores/panel-store";
import { LiteratureSearchButton } from "@/components/literature/literature-search-button";
import { SidebarFavorites } from "./sidebar-favorites";
import { SidebarRecentNotes } from "./sidebar-recent-notes";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  TrashTab,
  TrashTabSkeleton,
} from "@/components/views/workspace-settings/trash-tab";

export interface ShellSidebarProps {
  deepResearchEnabled: boolean;
  synthesisExportEnabled?: boolean;
}

// App Shell Phase 2 assembled sidebar (distinct from the legacy
// project-scoped `Sidebar` that still layouts the editor page). The sidebar
// keeps workspace navigation and project navigation as separate outline blocks.
// The testid matches what Phase 1's e2e already watches.
export function ShellSidebar({
  deepResearchEnabled,
  synthesisExportEnabled = false,
}: ShellSidebarProps) {
  const { wsSlug, projectId } = useCurrentProjectContext();
  const locale = useLocale();
  const tNav = useTranslations("sidebar.nav");
  const tSections = useTranslations("sidebar.sections");
  const tTrash = useTranslations("workspaceSettings.trash");
  const toggleSidebar = usePanelStore((s) => s.toggleSidebar);
  const openAgentPanelTab = usePanelStore((s) => s.openAgentPanelTab);
  const base = wsSlug ? urls.workspace.root(locale, wsSlug) : null;
  const [trashOpen, setTrashOpen] = useState(false);
  const workspaces = useQuery({
    queryKey: ["workspaces", "me"],
    enabled: Boolean(wsSlug),
    queryFn: async (): Promise<{
      workspaces: { id: string; slug: string; name: string }[];
    }> => {
      const res = await fetch("/api/workspaces/me", { credentials: "include" });
      if (!res.ok) throw new Error(`workspaces/me ${res.status}`);
      return (await res.json()) as {
        workspaces: { id: string; slug: string; name: string }[];
      };
    },
    staleTime: 30_000,
  });
  const workspaceId = useMemo(
    () => workspaces.data?.workspaces.find((w) => w.slug === wsSlug)?.id ?? null,
    [workspaces.data?.workspaces, wsSlug],
  );

  return (
    <aside
      data-testid="app-shell-sidebar"
      className="flex h-full min-h-0 flex-col border-r border-border bg-muted/10"
    >
      <div className="flex items-center gap-1 border-b border-border bg-background px-2 py-1.5">
        <div className="min-w-0 flex-1">{wsSlug ? <ProjectHero /> : null}</div>
        <button
          type="button"
          aria-label={tNav("collapse_sidebar")}
          onClick={toggleSidebar}
          className="app-btn-ghost grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-control)]"
        >
          <ChevronLeft aria-hidden className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        <ScopedSearch />
        {base && wsSlug ? (
          <div className="mt-2 flex items-center gap-1.5">
            <SidebarNavLink
              href={
                projectId
                  ? urls.workspace.project(locale, wsSlug, projectId)
                  : base
              }
              label={projectId ? tNav("project_home") : tNav("dashboard")}
              Icon={Home}
            />
            <PanelIconButton
              label={tNav("chat")}
              Icon={MessageSquare}
              onClick={() => openAgentPanelTab("chat")}
            />
            <PanelIconButton
              label={tNav("tools")}
              Icon={Wrench}
              onClick={() => openAgentPanelTab("tools")}
            />
            <PanelIconButton
              label={tNav("notifications")}
              Icon={Bell}
              onClick={() => openAgentPanelTab("notifications")}
            />
            <ProjectToolsMenu
              base={base}
              compact
              synthesisExportEnabled={synthesisExportEnabled}
              onOpenTrash={() => setTrashOpen(true)}
            />
          </div>
        ) : null}

        {projectId && wsSlug ? (
          <>
            <SidebarSection label={tSections("create")} Icon={Sparkles}>
              <div
                className="grid grid-cols-2 gap-1 rounded-[var(--radius-control)] bg-background p-1 shadow-sm [&_button]:min-h-8 [&_button]:rounded-[var(--radius-control)] [&_button]:border-transparent [&_button]:bg-transparent [&_button]:px-2 [&_button]:text-xs [&_button]:hover:bg-muted"
                data-testid="sidebar-create-actions"
              >
                <NewNoteButton workspaceSlug={wsSlug} projectId={projectId} />
                <SourceUploadButton projectId={projectId} />
                <NewFolderButton projectId={projectId} />
                <NewCanvasButton
                  workspaceSlug={wsSlug}
                  projectId={projectId}
                />
                <NewCodeWorkspaceButton projectId={projectId} />
                <GenerateDocumentButton wsSlug={wsSlug} projectId={projectId} />
              </div>
            </SidebarSection>

            <SidebarSection label={tSections("favorites")} Icon={Star}>
              <SidebarFavorites wsSlug={wsSlug} />
            </SidebarSection>

            <SidebarSection label={tSections("files")} Icon={FileText}>
              <div
                className="h-[45vh] min-h-72 max-h-[520px] overflow-hidden rounded-[var(--radius-control)] border border-border bg-background shadow-sm"
                data-testid="sidebar-tree-region"
              >
                <ProjectTree projectId={projectId} workspaceSlug={wsSlug} />
              </div>
            </SidebarSection>

            <SidebarSection label={tSections("recent")} Icon={Newspaper}>
              <SidebarRecentNotes wsSlug={wsSlug} />
            </SidebarSection>

            <SidebarSection label={tSections("service_agent")} Icon={Bot}>
              <div className="grid gap-1">
                <SidebarNavLink
                  href={urls.workspace.projectAgents(locale, wsSlug, projectId)}
                  label={tNav("agents")}
                  Icon={Bot}
                  tone="agent"
                />
                {deepResearchEnabled ? (
                  <SidebarNavLink
                    href={`${base}/research`}
                    label={tNav("research")}
                    Icon={Sparkles}
                    tone="agent"
                  />
                ) : null}
                <LiteratureSearchButton wsSlug={wsSlug} />
              </div>
            </SidebarSection>

            <SidebarSection label={tSections("project_tools")} Icon={Network}>
              <div className="grid gap-1">
                <SidebarNavLink
                  href={urls.workspace.projectGraph(locale, wsSlug, projectId)}
                  label={tNav("graph")}
                  Icon={Network}
                  tone="utility"
                />
                <SidebarNavLink
                  href={urls.workspace.projectLearn(locale, wsSlug, projectId)}
                  label={tNav("learn")}
                  Icon={GraduationCap}
                  tone="utility"
                />
              </div>
            </SidebarSection>
          </>
        ) : (
          <SidebarEmptyState />
        )}

        {base && wsSlug ? (
          <>
            <SidebarSection label={tSections("publish")} Icon={Share2}>
              <div className="grid gap-1">
                <SidebarNavLink
                  href={`${base}/settings/shared-links`}
                  label={tNav("public_pages")}
                  Icon={Share2}
                  tone="utility"
                />
                <SidebarNavLink
                  href={`${base}/settings/shared-links`}
                  label={tNav("shared_links")}
                  Icon={Share2}
                  tone="utility"
                />
                {synthesisExportEnabled ? (
                  <SidebarNavLink
                    href={`${base}/synthesis-export`}
                    label={tNav("synthesis_export")}
                    Icon={ExternalLink}
                    tone="utility"
                  />
                ) : null}
              </div>
            </SidebarSection>

            <SidebarSection label={tSections("workspace_tools")} Icon={Wrench}>
              <div className="grid gap-1">
                <SidebarNavLink
                  href={`${base}/atlas`}
                  label={tNav("atlas")}
                  Icon={Network}
                  tone="utility"
                />
                <SidebarNavLink
                  href={`${base}/settings`}
                  label={tNav("settings")}
                  Icon={Settings}
                  tone="utility"
                />
                <SidebarNavButton
                  onClick={() => setTrashOpen(true)}
                  label={tNav("trash")}
                  Icon={Trash2}
                  tone="utility"
                />
              </div>
            </SidebarSection>

            <SidebarSection label={tSections("help")} Icon={HelpCircle}>
              <div className="grid gap-1">
                <SidebarNavLink
                  href={urls.workspace.help(locale, wsSlug)}
                  label={tNav("help")}
                  Icon={HelpCircle}
                  tone="utility"
                />
                <SidebarNavLink
                  href={urls.workspace.report(locale, wsSlug)}
                  label={tNav("feedback")}
                  Icon={MessageSquare}
                  tone="utility"
                />
                <SidebarExternalLink
                  href="/changelog"
                  label={tNav("changelog")}
                  Icon={Newspaper}
                />
              </div>
            </SidebarSection>
          </>
        ) : null}
      </div>
      <Dialog open={trashOpen} onOpenChange={setTrashOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{tTrash("heading")}</DialogTitle>
            <DialogDescription>{tTrash("retention")}</DialogDescription>
          </DialogHeader>
          {workspaceId ? (
            <TrashTab wsId={workspaceId} showHeader={false} />
          ) : !workspaces.isError ? (
            <TrashTabSkeleton />
          ) : (
            <p className="text-sm text-destructive">{tTrash("loadFailed")}</p>
          )}
        </DialogContent>
      </Dialog>
      <SidebarFooter />
    </aside>
  );
}

function SidebarSection({
  label,
  Icon,
  children,
}: {
  label: string;
  Icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  children: ReactNode;
}) {
  return (
    <section className="mt-4">
      <h2 className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] font-semibold text-muted-foreground">
        {Icon ? <Icon aria-hidden className="h-3.5 w-3.5" /> : null}
        {label}
      </h2>
      {children}
    </section>
  );
}

function SidebarNavLink({
  href,
  label,
  Icon,
  tone = "primary",
}: {
  href: string;
  label: string;
  Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  tone?: "primary" | "utility" | "agent";
}) {
  return (
    <Link
      href={href}
      className={`flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        tone === "agent"
          ? "border border-border/80 bg-background text-foreground shadow-sm hover:border-foreground hover:bg-muted"
          : tone === "utility"
            ? "border border-transparent text-muted-foreground hover:border-border hover:bg-background hover:text-foreground"
            : "border border-border bg-background text-foreground hover:border-foreground"
      }`}
    >
      <Icon
        aria-hidden
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </Link>
  );
}

function SidebarNavButton({
  onClick,
  label,
  Icon,
  tone = "primary",
}: {
  onClick: () => void;
  label: string;
  Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  tone?: "primary" | "utility";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        tone === "utility"
          ? "border border-transparent text-muted-foreground hover:border-border hover:bg-background hover:text-foreground"
          : "border border-border bg-background text-foreground hover:border-foreground"
      }`}
    >
      <Icon
        aria-hidden
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

function SidebarExternalLink({
  href,
  label,
  Icon,
}: {
  href: string;
  label: string;
  Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-control)] border border-transparent px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:border-border hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon
        aria-hidden
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <ExternalLink
        aria-hidden
        className="h-3 w-3 shrink-0 text-muted-foreground/70"
      />
    </a>
  );
}

function PanelIconButton({
  label,
  Icon,
  onClick,
}: {
  label: string;
  Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-control)] border border-border bg-background text-muted-foreground transition-colors hover:border-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon aria-hidden className="h-3.5 w-3.5" />
    </button>
  );
}

function ProjectToolsMenu({
  base,
  compact = false,
  synthesisExportEnabled,
  onOpenTrash,
}: {
  base: string;
  compact?: boolean;
  synthesisExportEnabled: boolean;
  onOpenTrash: () => void;
}) {
  const t = useTranslations("sidebar.nav");
  const [open, setOpen] = useState(false);
  const openTrash = () => {
    setOpen(false);
    onOpenTrash();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={t("more_aria")}
        className={
          compact
            ? "grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-control)] border border-border bg-background text-muted-foreground transition-colors hover:border-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            : "flex min-h-8 items-center gap-2 rounded-[var(--radius-control)] border border-border bg-background px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:border-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        }
      >
        <MoreHorizontal aria-hidden className="h-3.5 w-3.5 shrink-0" />
        {compact ? null : (
          <span className="min-w-0 flex-1 truncate">{t("more_aria")}</span>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[260px] rounded-[var(--radius-control)] border border-border bg-background p-2 shadow-sm ring-0"
      >
        <MoreMenu
          base={base}
          synthesisExportEnabled={synthesisExportEnabled}
          onOpenTrash={openTrash}
        />
      </PopoverContent>
    </Popover>
  );
}
