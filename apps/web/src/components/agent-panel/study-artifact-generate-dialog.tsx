"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type {
  StudyArtifactDifficulty,
  StudyArtifactType,
} from "@opencairn/shared";

import {
  ApiError,
  projectsApi,
  studyArtifactsApi,
  type GenerateStudyArtifactResponse,
  type ProjectNoteRow,
} from "@/lib/api-client";
import { openOriginalFileTab } from "@/components/ingest/open-original-file-tab";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const STUDY_ARTIFACT_TYPES: StudyArtifactType[] = [
  "quiz_set",
  "mock_exam",
  "flashcard_deck",
  "fill_blank_set",
  "exam_prep_pack",
  "compare_table",
  "glossary",
  "cheat_sheet",
  "interactive_html",
  "data_table",
];

const DIFFICULTIES: StudyArtifactDifficulty[] = [
  "mixed",
  "easy",
  "medium",
  "hard",
];

export function StudyArtifactGenerateDialog({
  open,
  projectId,
  defaultType = "quiz_set",
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  projectId: string | null;
  defaultType?: StudyArtifactType;
  onOpenChange(open: boolean): void;
  onCreated?(response: GenerateStudyArtifactResponse): void;
}) {
  const t = useTranslations("project.tools.studyArtifact");
  const [type, setType] = useState<StudyArtifactType>(defaultType);
  const [difficulty, setDifficulty] =
    useState<StudyArtifactDifficulty>("mixed");
  const [title, setTitle] = useState("");
  const [itemCount, setItemCount] = useState(5);
  const [notes, setNotes] = useState<ProjectNoteRow[]>([]);
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [notesError, setNotesError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<
    | { kind: "generic" }
    | { kind: "retryable"; runId: string | null }
    | null
  >(null);

  useEffect(() => {
    if (!open) return;
    setType(defaultType);
    setDifficulty("mixed");
    setTitle("");
    setItemCount(5);
    setSubmitError(null);
  }, [defaultType, open]);

  useEffect(() => {
    if (!open || !projectId) return;
    let cancelled = false;
    setLoadingNotes(true);
    setNotesError(false);
    void projectsApi
      .notes(projectId, "all")
      .then((response) => {
        if (cancelled) return;
        setNotes(response.notes);
        setSelectedNoteIds((current) => {
          const valid = current.filter((id) =>
            response.notes.some((note) => note.id === id),
          );
          return valid.length > 0
            ? valid
            : response.notes.slice(0, 1).map((note) => note.id);
        });
      })
      .catch(() => {
        if (!cancelled) setNotesError(true);
      })
      .finally(() => {
        if (!cancelled) setLoadingNotes(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  const selectedSet = useMemo(
    () => new Set(selectedNoteIds),
    [selectedNoteIds],
  );
  const canSubmit =
    Boolean(projectId) && selectedNoteIds.length > 0 && !submitting;

  function toggleNote(noteId: string) {
    setSelectedNoteIds((current) =>
      current.includes(noteId)
        ? current.filter((id) => id !== noteId)
        : [...current, noteId].slice(0, 20),
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectId || !canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await studyArtifactsApi.generate(projectId, {
        type,
        sourceNoteIds: selectedNoteIds,
        title: title.trim() || undefined,
        difficulty,
        tags: [],
        itemCount,
      });
      onCreated?.(response);
      openOriginalFileTab(response.file.id, response.file.title);
      onOpenChange(false);
    } catch (error) {
      setSubmitError(readStudyArtifactSubmitError(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[82vh] flex-col gap-4 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <form className="flex min-h-0 flex-col gap-4" onSubmit={submit}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs font-medium text-foreground">
              <span>{t("typeLabel")}</span>
              <select
                value={type}
                onChange={(event) =>
                  setType(event.currentTarget.value as StudyArtifactType)
                }
                className="h-9 w-full rounded-[var(--radius-control)] border border-border bg-background px-2 text-sm font-normal"
              >
                {STUDY_ARTIFACT_TYPES.map((artifactType) => (
                  <option key={artifactType} value={artifactType}>
                    {t(`types.${artifactType}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs font-medium text-foreground">
              <span>{t("difficultyLabel")}</span>
              <select
                value={difficulty}
                onChange={(event) =>
                  setDifficulty(
                    event.currentTarget.value as StudyArtifactDifficulty,
                  )
                }
                className="h-9 w-full rounded-[var(--radius-control)] border border-border bg-background px-2 text-sm font-normal"
              >
                {DIFFICULTIES.map((value) => (
                  <option key={value} value={value}>
                    {t(`difficulties.${value}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs font-medium text-foreground sm:col-span-2">
              <span>{t("optionalTitleLabel")}</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.currentTarget.value)}
                placeholder={t("titlePlaceholder")}
                className="h-9 w-full rounded-[var(--radius-control)] border border-border bg-background px-2 text-sm font-normal"
              />
            </label>
            <label className="space-y-1 text-xs font-medium text-foreground">
              <span>{t("itemCountLabel")}</span>
              <input
                type="number"
                min={1}
                max={20}
                value={itemCount}
                onChange={(event) =>
                  setItemCount(
                    Math.max(
                      1,
                      Math.min(20, Number(event.currentTarget.value) || 1),
                    ),
                  )
                }
                className="h-9 w-full rounded-[var(--radius-control)] border border-border bg-background px-2 text-sm font-normal"
              />
            </label>
          </div>
          <section className="min-h-0 space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-normal text-muted-foreground">
              {t("sourceLabel")}
            </h3>
            {loadingNotes ? (
              <p className="rounded-[var(--radius-control)] border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                {t("loadingNotes")}
              </p>
            ) : notesError ? (
              <p role="alert" className="text-xs text-red-600">
                {t("notesError")}
              </p>
            ) : notes.length === 0 ? (
              <p className="rounded-[var(--radius-control)] border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                {t("noNotes")}
              </p>
            ) : (
              <div className="app-scrollbar-thin max-h-52 space-y-1 overflow-y-auto rounded-[var(--radius-control)] border border-border p-1">
                {notes.map((note) => (
                  <label
                    key={note.id}
                    className="app-hover flex min-h-9 items-center gap-2 rounded-[var(--radius-control)] px-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={selectedSet.has(note.id)}
                      onChange={() => toggleNote(note.id)}
                    />
                    <span className="min-w-0 flex-1 truncate">{note.title}</span>
                  </label>
                ))}
              </div>
            )}
          </section>
          {submitError ? (
            <p role="alert" className="text-xs text-red-600">
              {submitError.kind === "retryable"
                ? t("retryableError")
                : t("submitError")}
              {submitError.kind === "retryable" && submitError.runId ? (
                <span className="mt-1 block font-mono text-[11px]">
                  {submitError.runId}
                </span>
              ) : null}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {submitting ? t("generating") : t("generate")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function readStudyArtifactSubmitError(
  error: unknown,
): { kind: "generic" } | { kind: "retryable"; runId: string | null } {
  const body =
    error instanceof ApiError
      ? error.body
      : typeof error === "object" && error !== null && "body" in error
        ? (error as { body?: unknown }).body
        : null;
  if (typeof body === "object" && body !== null) {
    const raw = body as Record<string, unknown>;
    if (raw.retryable === true) {
      return {
        kind: "retryable",
        runId: typeof raw.runId === "string" ? raw.runId : null,
      };
    }
  }
  return { kind: "generic" };
}
