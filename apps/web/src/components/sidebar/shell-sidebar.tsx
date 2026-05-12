"use client";
import { urls } from "@/lib/urls";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Home, MoreHorizontal, Trash2 } from "lucide-react";
import { ScopedSearch } from "./scoped-search";
import { ProjectTree } from "./project-tree";
import { SidebarFooter } from "./sidebar-footer";
import { useCurrentProjectContext } from "./use-current-project";
import { NewNoteButton } from "./NewNoteButton";
import { NewFolderButton } from "./NewFolderButton";
import { NewCanvasButton } from "./NewCanvasButton";
import { SourceUploadButton } from "./SourceUploadButton";
import { ProjectHero } from "./project-hero";
import { MoreMenu } from "./more-menu";
import { SidebarEmptyState } from "./sidebar-empty-state";
import { usePanelStore } from "@/stores/panel-store";
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
  synthesisExportEnabled = false,
}: ShellSidebarProps) {
  const { wsSlug, projectId } = useCurrentProjectContext();
  const locale = useLocale();
  const tNav = useTranslations("sidebar.nav");
  const tTrash = useTranslations("workspaceSettings.trash");
  const toggleSidebar = usePanelStore((s) => s.toggleSidebar);
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
      className="flex h-full min-h-0 flex-col border-r border-border bg-background"
    >
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
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
      <div className="border-b border-border px-3 py-2">
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
            <ProjectToolsMenu
              base={base}
              compact
              synthesisExportEnabled={synthesisExportEnabled}
              onOpenTrash={() => setTrashOpen(true)}
            />
          </div>
        ) : null}
      </div>
      {projectId && wsSlug ? (
        <>
          <div className="grid grid-cols-2 gap-1.5 px-3 py-2">
            <NewNoteButton workspaceSlug={wsSlug} projectId={projectId} />
            <SourceUploadButton projectId={projectId} />
            <NewFolderButton projectId={projectId} />
            <NewCanvasButton workspaceSlug={wsSlug} projectId={projectId} />
          </div>
          <div className="min-h-0 flex-1 overflow-hidden border-t border-border">
            <ProjectTree projectId={projectId} workspaceSlug={wsSlug} />
          </div>
        </>
      ) : (
        <SidebarEmptyState />
      )}
      {base ? (
        <div className="border-t border-border bg-muted/20 px-3 py-2">
          <SidebarNavButton
            onClick={() => setTrashOpen(true)}
            label={tNav("trash")}
            Icon={Trash2}
            tone="utility"
          />
        </div>
      ) : null}
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

function SidebarNavLink({
  href,
  label,
  Icon,
  tone = "primary",
}: {
  href: string;
  label: string;
  Icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  tone?: "primary" | "utility";
}) {
  return (
    <Link
      href={href}
      className={`flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
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
  Icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
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
