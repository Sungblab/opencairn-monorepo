"use client";

import { Button } from "@/components/ui/button";
import type {
  NoteVersionActor,
  NoteVersionListItem,
} from "@/lib/api-client-note-versions";
import { cn } from "@/lib/utils";

interface VersionTimelineProps {
  versions: NoteVersionListItem[];
  selected: number | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onSelect: (version: number) => void;
  sourceLabel: (source: NoteVersionListItem["source"]) => string;
  actorLabel: (actor: NoteVersionActor) => string;
  dateLabel: (createdAt: string) => string;
  labels: {
    empty: string;
    loadFailed: string;
    loading: string;
    retry: string;
    version: (version: number) => string;
  };
}

export function VersionTimeline({
  versions,
  selected,
  loading,
  error,
  onRetry,
  onSelect,
  sourceLabel,
  actorLabel,
  dateLabel,
  labels,
}: VersionTimelineProps) {
  if (loading) {
    return (
      <div className="p-3 text-sm text-muted-foreground">{labels.loading}</div>
    );
  }
  if (error) {
    return (
      <div className="space-y-3 p-3 text-sm text-muted-foreground">
        <p>{labels.loadFailed}</p>
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          {labels.retry}
        </Button>
      </div>
    );
  }
  if (versions.length === 0) {
    return (
      <div className="p-3 text-sm text-muted-foreground">{labels.empty}</div>
    );
  }

  return (
    <div className="space-y-1">
      {versions.map((version) => (
        <button
          key={version.id}
          type="button"
          onClick={() => onSelect(version.version)}
          className={cn(
            "w-full rounded-md px-3 py-2 text-left text-sm transition hover:bg-muted",
            selected === version.version && "bg-muted",
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">
              {labels.version(version.version)}
            </span>
            <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[11px] text-secondary-foreground">
              {sourceLabel(version.source)}
            </span>
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">
            {version.contentTextPreview || version.title}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            <span>{actorLabel(version.actor)}</span>
            <span>{dateLabel(version.createdAt)}</span>
          </div>
        </button>
      ))}
    </div>
  );
}
