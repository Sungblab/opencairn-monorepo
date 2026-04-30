"use client";

// Plan 2E Phase B-4 Task 4.5 — Math edit popover.
//
// A Popover (shadcn / base-ui) containing:
//   - A textarea for LaTeX input (left pane)
//   - A KaTeX live preview (right pane)
//   - Save / Cancel buttons
//
// The void node is NOT updated until Save — typing in the textarea does
// not churn Yjs. On Save with empty content, onDelete() is called instead
// (treats "save with empty LaTeX" as "remove math node").
//
// Keyboard: Esc → close (no save), Ctrl+Enter → save.

import { useEffect, useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import katex from "katex";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

export interface MathEditPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTex: string;
  onSave: (tex: string) => void;
  onDelete: () => void;
  anchor: React.ReactNode;
}

export function MathEditPopover({
  open,
  onOpenChange,
  initialTex,
  onSave,
  onDelete,
  anchor,
}: MathEditPopoverProps) {
  const t = useTranslations("editor.math.editPopover");
  const [tex, setTex] = useState(initialTex);

  // Sync textarea when popover reopens with a different expression.
  useEffect(() => {
    if (open) setTex(initialTex);
  }, [open, initialTex]);

  const previewHtml = useMemo(() => {
    if (!tex.trim()) return "";
    try {
      return katex.renderToString(tex, { throwOnError: true });
    } catch {
      return null; // null signals a parse error
    }
  }, [tex]);

  function handleSave() {
    if (tex.trim().length === 0) {
      onDelete();
      onOpenChange(false);
      return;
    }
    onSave(tex);
    onOpenChange(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      // Cancel without saving
      onOpenChange(false);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleSave();
    }
  }

  return (
    <Popover open={open} onOpenChange={(v) => onOpenChange(v)}>
      <PopoverTrigger>{anchor}</PopoverTrigger>
      <PopoverContent className="w-[480px]" onKeyDown={handleKeyDown}>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">
              {t("title")}
            </label>
            <textarea
              value={tex}
              onChange={(e) => setTex(e.target.value)}
              placeholder={t("placeholder")}
              // biome-ignore lint/a11y/noAutofocus: popover requires immediate focus
              autoFocus
              rows={4}
              className="w-full rounded-md border bg-background p-2 font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">
              {t("previewLabel")}
            </label>
            <div className="min-h-[6rem] rounded-md border bg-muted/30 p-2 overflow-auto">
              {previewHtml === null ? (
                <p className="text-sm text-destructive">{t("invalid")}</p>
              ) : previewHtml ? (
                <span
                  // KaTeX output is sanitised; renderToString does not execute scripts
                  // eslint-disable-next-line react/no-danger
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              ) : null}
            </div>
          </div>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            {t("cancel")}
          </Button>
          <Button type="button" size="sm" onClick={handleSave} data-save-math>
            {t("save")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
