"use client";

import { useEffect, useState } from "react";
import { History, RotateCcw, Save } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  useCreateNoteCheckpoint,
  useNoteVersionDetail,
  useNoteVersionDiff,
  useNoteVersions,
  useRestoreNoteVersion,
} from "@/hooks/use-note-versions";

import { RestoreVersionDialog } from "./restore-version-dialog";
import { VersionDiffView } from "./version-diff-view";
import { VersionPreview } from "./version-preview";
import { VersionTimeline } from "./version-timeline";

export interface NoteHistorySheetProps {
  noteId: string;
  readOnly: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type HistoryMode = "preview" | "diff";

export function NoteHistorySheet({
  noteId,
  readOnly,
  open,
  onOpenChange,
}: NoteHistorySheetProps) {
  const t = useTranslations("noteHistory");
  const format = useFormatter();
  const [selected, setSelected] = useState<number | null>(null);
  const [mode, setMode] = useState<HistoryMode>("preview");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const versions = useNoteVersions(noteId, open);
  const detail = useNoteVersionDetail(noteId, selected);
  const diff = useNoteVersionDiff(noteId, selected, mode === "diff");
  const checkpoint = useCreateNoteCheckpoint(noteId);
  const restore = useRestoreNoteVersion(noteId);

  const firstVersion = versions.data?.versions[0]?.version ?? null;

  useEffect(() => {
    if (open && selected === null && firstVersion !== null) {
      setSelected(firstVersion);
    }
  }, [firstVersion, open, selected]);

  const currentVersionLabel =
    firstVersion === null
      ? t("currentVersionEmpty")
      : t("currentVersion", { version: firstVersion });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-5xl"
      >
        <SheetHeader className="border-b px-4 py-3">
          <div className="flex items-start justify-between gap-3 pr-8">
            <div className="min-w-0">
              <SheetTitle className="flex items-center gap-2 text-base">
                <History className="size-4" aria-hidden />
                {t("title")}
              </SheetTitle>
              <SheetDescription>{currentVersionLabel}</SheetDescription>
            </div>
            {!readOnly && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  checkpoint.mutate(undefined, {
                    onSuccess: () => toast.success(t("checkpointCreated")),
                    onError: () => toast.error(t("checkpointFailed")),
                  })
                }
                disabled={checkpoint.isPending}
              >
                <Save className="size-4" aria-hidden />
                {t("createCheckpoint")}
              </Button>
            )}
          </div>
          {readOnly && (
            <p className="text-xs text-muted-foreground">
              {t("readOnlyRestoreHint")}
            </p>
          )}
        </SheetHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[18rem_minmax(0,1fr)]">
          <aside className="min-h-0 overflow-auto border-b p-3 md:border-b-0 md:border-r">
            <VersionTimeline
              versions={versions.data?.versions ?? []}
              selected={selected}
              loading={versions.isLoading}
              error={versions.isError}
              onRetry={() => versions.refetch()}
              onSelect={setSelected}
              sourceLabel={(source) => t(`source.${source}`)}
              actorLabel={(actor) => {
                if (actor.name) return actor.name;
                return t(`actor.${actor.type}`);
              }}
              dateLabel={(createdAt) =>
                format.dateTime(new Date(createdAt), {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "numeric",
                })
              }
              labels={{
                empty: t("empty"),
                loadFailed: t("loadFailed"),
                loading: t("loading"),
                retry: t("retry"),
                version: (version) => t("versionLabel", { version }),
              }}
            />
          </aside>

          <main className="flex min-h-0 flex-col">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
              <div className="flex gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant={mode === "preview" ? "secondary" : "ghost"}
                  onClick={() => setMode("preview")}
                >
                  {t("preview")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={mode === "diff" ? "secondary" : "ghost"}
                  onClick={() => setMode("diff")}
                  disabled={!selected}
                >
                  {t("compareWithCurrent")}
                </Button>
              </div>
              {!readOnly && (
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={!selected}
                  onClick={() => setConfirmOpen(true)}
                >
                  <RotateCcw className="size-4" aria-hidden />
                  {t("restore")}
                </Button>
              )}
            </div>

            {mode === "preview" ? (
              <VersionPreview
                version={detail.data}
                loading={detail.isLoading}
                error={detail.isError}
                labels={{
                  loading: t("loading"),
                  loadFailed: t("loadFailed"),
                  selectVersion: t("selectVersion"),
                }}
              />
            ) : (
              <VersionDiffView
                diff={diff.data}
                loading={diff.isLoading}
                error={diff.isError}
                labels={{
                  loading: t("loading"),
                  diffTooLarge: t("diffTooLarge"),
                  selectVersion: t("selectVersion"),
                  addedBlocks: t("summary.addedBlocks"),
                  removedBlocks: t("summary.removedBlocks"),
                  changedBlocks: t("summary.changedBlocks"),
                  addedWords: t("summary.addedWords"),
                  removedWords: t("summary.removedWords"),
                  emptyDiff: t("emptyDiff"),
                  status: {
                    added: t("status.added"),
                    removed: t("status.removed"),
                    changed: t("status.changed"),
                  },
                }}
              />
            )}
          </main>
        </div>

        <RestoreVersionDialog
          open={confirmOpen}
          version={selected}
          pending={restore.isPending}
          onOpenChange={setConfirmOpen}
          onConfirm={() => {
            if (!selected) return;
            restore.mutate(selected, {
              onSuccess: () => {
                setConfirmOpen(false);
                toast.success(t("restoreSuccess"));
              },
              onError: () => toast.error(t("restoreFailed")),
            });
          }}
          labels={{
            title: t("restoreConfirmTitle"),
            body: t("restoreConfirmBody", { version: selected ?? "" }),
            cancel: t("cancel"),
            restore: t("restore"),
            pending: t("restorePending"),
          }}
        />
      </SheetContent>
    </Sheet>
  );
}
