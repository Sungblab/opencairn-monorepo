"use client";

// Modal that drives the natural-language → ViewSpec flow. The component is
// deliberately thin: the SSE stream is owned by `useVisualizeMutation`, and
// the URL/store handoff lives in `useViewSpecApply`. This file is only
// responsible for:
//   - Collecting the prompt + an optional viewType hint.
//   - Showing per-state UI (idle / submitting / success / error).
//   - Closing itself once a viewSpec lands so the user is never left
//     looking at a successful dialog they then have to dismiss manually.
//
// The viewType picker is a flat row of buttons rather than a real <select>
// because (a) there are only 6 options including "auto" and (b) chained
// keyboard / pointer interactions land more reliably with native buttons in
// dialog focus traps. The default is `undefined` so the agent picks.
//
// Error rendering is unmapped-key tolerant: if the server returns a code
// the i18n bundle doesn't know about yet we fall back to the generic
// `errors.visualizeFailed` string.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import type { ViewType } from "@opencairn/shared";
import { useVisualizeMutation } from "./useVisualizeMutation";
import { useViewSpecApply } from "../useViewSpecApply";
import { VisualizeProgress } from "./VisualizeProgress";

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: string;
}

// `undefined` = let the agent infer from the prompt; the rest map
// 1:1 to the shared ViewType enum so a stale entry would fail TS, not
// silently render an empty button.
const VIEW_OPTIONS: ReadonlyArray<ViewType | undefined> = [
  undefined,
  "graph",
  "mindmap",
  "cards",
  "timeline",
  "board",
];

export function VisualizeDialog({ open, onClose, projectId }: Props) {
  const tAi = useTranslations("graph.ai");
  const tErr = useTranslations("graph.errors");
  const { submit, cancel, progress, viewSpec, error, submitting } =
    useVisualizeMutation();
  const apply = useViewSpecApply();

  const [prompt, setPrompt] = useState("");
  const [viewType, setViewType] = useState<ViewType | undefined>(undefined);

  // Auto-apply + close once the agent emits a spec. Including `apply` and
  // `onClose` in deps is safe because the mutation hook's identities are
  // stable across renders and `onClose` is owned by the parent.
  useEffect(() => {
    if (viewSpec) {
      apply(viewSpec, projectId);
      onClose();
    }
  }, [viewSpec, apply, projectId, onClose]);

  function onSubmit() {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    submit({ projectId, prompt: trimmed, viewType });
  }

  function onCancel() {
    cancel();
    onClose();
  }

  // Map the server's error code back to a translated string; unknown codes
  // fall back to the generic message so we never show a raw key.
  const errorMessage =
    error && tErr.has(error)
      ? tErr(error)
      : error
        ? tErr("visualizeFailed")
        : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tAi("dialogTitle")}</DialogTitle>
        </DialogHeader>

        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={tAi("promptPlaceholder")}
          maxLength={500}
          rows={3}
          disabled={submitting}
        />

        <div className="mt-1 flex flex-wrap gap-2" role="group" aria-label={tAi("viewTypeLabel")}>
          {VIEW_OPTIONS.map((v) => {
            const active = viewType === v;
            const label = v ? tAi(`viewType_${v}`) : tAi("viewTypeAuto");
            return (
              <button
                key={String(v)}
                type="button"
                onClick={() => setViewType(v)}
                data-active={active ? "true" : "false"}
                disabled={submitting}
                className={
                  active
                    ? "rounded bg-accent px-2 py-1 text-xs font-medium"
                    : "rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                }
              >
                {label}
              </button>
            );
          })}
        </div>

        {errorMessage && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {errorMessage}
          </p>
        )}

        <VisualizeProgress events={progress} />

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            {tAi("cancel")}
          </Button>
          <Button
            onClick={onSubmit}
            disabled={!prompt.trim() || submitting}
          >
            {submitting ? tAi("submitting") : tAi("submit")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
