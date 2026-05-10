"use client";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  useCurrentProjectContext,
  useCurrentProjectData,
} from "./use-current-project";
import { ProjectSwitcher } from "./project-switcher";

// Title strip for the current project. When there's no project selected
// (new workspace, dashboard route) the trigger invites the user to create
// one; the popover body always lets them jump to another project.
export function ProjectHero() {
  const { projectId } = useCurrentProjectContext();
  const { data: project } = useCurrentProjectData(projectId);
  const t = useTranslations("sidebar.project");
  const triggerLabel = project?.name ?? t("select");

  return (
    <Popover>
      <PopoverTrigger
        aria-label={t("switch_aria")}
        className="flex min-h-10 w-full items-center justify-between gap-2 rounded-[var(--radius-control)] border border-transparent bg-background px-3 py-2 text-left transition-colors hover:border-border hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-9 md:py-1.5"
      >
        <span className="truncate text-sm font-semibold">
          {triggerLabel}
        </span>
        <ChevronDown
          aria-hidden
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[280px] rounded-[var(--radius-control)] border border-border bg-background p-0 shadow-sm ring-0"
      >
        <ProjectSwitcher />
      </PopoverContent>
    </Popover>
  );
}
