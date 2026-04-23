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
  const triggerLabel = project?.name ?? t("empty");

  return (
    <Popover>
      <PopoverTrigger
        aria-label={t("switch_aria")}
        className="flex w-full items-center justify-between gap-2 border-b border-border px-3 py-2 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
      >
        <span className="truncate text-sm font-semibold">{triggerLabel}</span>
        <ChevronDown
          aria-hidden
          className="h-4 w-4 shrink-0 text-muted-foreground"
        />
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0">
        <ProjectSwitcher />
      </PopoverContent>
    </Popover>
  );
}
