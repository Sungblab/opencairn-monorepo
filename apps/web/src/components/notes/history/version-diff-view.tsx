"use client";

import type { NoteVersionDiff } from "@/lib/api-client-note-versions";
import { cn } from "@/lib/utils";

interface VersionDiffViewProps {
  diff: NoteVersionDiff | undefined;
  loading: boolean;
  error: boolean;
  labels: {
    loading: string;
    diffTooLarge: string;
    selectVersion: string;
    addedBlocks: string;
    removedBlocks: string;
    changedBlocks: string;
    addedWords: string;
    removedWords: string;
    emptyDiff: string;
    status: {
      added: string;
      removed: string;
      changed: string;
    };
  };
}

export function VersionDiffView({
  diff,
  loading,
  error,
  labels,
}: VersionDiffViewProps) {
  if (loading) {
    return (
      <div className="p-6 text-sm text-muted-foreground">{labels.loading}</div>
    );
  }
  if (error) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        {labels.diffTooLarge}
      </div>
    );
  }
  if (!diff) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        {labels.selectVersion}
      </div>
    );
  }

  const changedBlocks = diff.blocks.filter((b) => b.status !== "unchanged");

  return (
    <div className="min-h-0 flex-1 overflow-auto p-6">
      <div className="mb-4 grid grid-cols-2 gap-2 text-xs md:grid-cols-5">
        <SummaryCell
          label={labels.addedBlocks}
          value={diff.summary.addedBlocks}
        />
        <SummaryCell
          label={labels.removedBlocks}
          value={diff.summary.removedBlocks}
        />
        <SummaryCell
          label={labels.changedBlocks}
          value={diff.summary.changedBlocks}
        />
        <SummaryCell
          label={labels.addedWords}
          value={diff.summary.addedWords}
        />
        <SummaryCell
          label={labels.removedWords}
          value={diff.summary.removedWords}
        />
      </div>

      {changedBlocks.length === 0 ? (
        <p className="text-sm text-muted-foreground">{labels.emptyDiff}</p>
      ) : (
        <div className="space-y-3">
          {changedBlocks.map((block) => (
            <div
              key={block.key}
              className={cn(
                "rounded-md border p-3 text-sm",
                block.status === "added" &&
                  "border-emerald-500/30 bg-emerald-500/10",
                block.status === "removed" &&
                  "border-destructive/30 bg-destructive/10",
              )}
            >
              <div className="mb-2 text-xs font-medium text-muted-foreground">
                {labels.status[block.status as keyof typeof labels.status]}
              </div>
              {block.textDiff ? (
                <p className="leading-7">
                  {block.textDiff.map((part, idx) => (
                    <span
                      key={`${block.key}-${idx}`}
                      className={cn(
                        part.kind === "insert" &&
                          "rounded bg-emerald-500/20 px-0.5",
                        part.kind === "delete" &&
                          "rounded bg-destructive/20 px-0.5 line-through",
                      )}
                    >
                      {part.text}
                    </span>
                  ))}
                </p>
              ) : (
                <pre className="overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">
                  {JSON.stringify(block.after ?? block.before, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-muted/30 p-2">
      <div className="text-muted-foreground">{label}</div>
      <div className="mt-1 text-base font-semibold">{value}</div>
    </div>
  );
}
