"use client";

import {
  Activity,
  BookText,
  Bot,
  CheckSquare,
  DownloadCloud,
  FileText,
  GraduationCap,
  Network,
  Presentation,
  Search,
  Sparkles,
  Table2,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { ToolDiscoveryIcon } from "./tool-discovery-catalog";

export type ToolDiscoveryTileSize = "project" | "panel";

const ICONS: Record<ToolDiscoveryIcon, LucideIcon> = {
  activity: Activity,
  book: BookText,
  bot: Bot,
  check: CheckSquare,
  download: DownloadCloud,
  file: FileText,
  graduation: GraduationCap,
  network: Network,
  presentation: Presentation,
  search: Search,
  sparkles: Sparkles,
  table: Table2,
};

export function getToolDiscoveryTileClassName({
  emphasis = false,
  size = "project",
  className,
}: {
  emphasis?: boolean;
  size?: ToolDiscoveryTileSize;
  className?: string;
}) {
  return cn(
    "group flex flex-col gap-2 rounded-[var(--radius-control)] border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
    size === "panel" ? "min-h-28" : "min-h-24",
    emphasis
      ? "border-primary/40 bg-primary text-primary-foreground hover:bg-primary/90"
      : "border-border bg-background text-foreground hover:border-foreground hover:bg-muted/40",
    className,
  );
}

export function ToolDiscoveryTileContent({
  icon,
  title,
  description,
  emphasis = false,
}: {
  icon: ToolDiscoveryIcon;
  title: string;
  description: string;
  emphasis?: boolean;
}) {
  const Icon = ICONS[icon];

  return (
    <>
      <Icon
        aria-hidden
        className={
          emphasis
            ? "h-4 w-4 text-primary-foreground/80"
            : "h-4 w-4 text-muted-foreground group-hover:text-foreground"
        }
      />
      <span className="text-sm font-medium leading-5">{title}</span>
      <span
        className={
          emphasis
            ? "line-clamp-2 text-xs leading-5 text-primary-foreground/75"
            : "line-clamp-2 text-xs leading-5 text-muted-foreground"
        }
      >
        {description}
      </span>
    </>
  );
}
