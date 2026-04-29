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
        // Card-style trigger — thicker fg-toned border + 2px box-shadow accent
        // mark this as the *active project identity* in the sidebar (mockup
        // 2026-04-23-app-shell §sidebar). Hover is the workspace `app-hover`
        // 6% wash, NOT the mockup's full invert (deviation: full flips are
        // reserved for landing/auth surfaces).
        className="app-hover mx-3 mb-2 mt-3 flex items-center justify-between gap-2 rounded-lg border-[1.5px] border-foreground bg-background px-3 py-2 text-left transition-colors focus-visible:outline-none"
        style={{ boxShadow: "0 2px 0 0 var(--theme-fg)" }}
      >
        <span className="truncate text-[14px] font-semibold tracking-tight">
          {triggerLabel}
        </span>
        <ChevronDown
          aria-hidden
          className="h-3 w-3 shrink-0 opacity-70"
        />
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0">
        <ProjectSwitcher />
      </PopoverContent>
    </Popover>
  );
}
