"use client";

// Plan 11B Phase A — InlineDiffSheet.
//
// Read-only preview of the LLM's proposed edits with accept-all / reject-all
// affordances. Phase A keeps it intentionally simple: no per-hunk accept,
// no inline edit. The sheet is driven entirely by `useDocEditorCommand`'s
// state machine (idle → running → ready / error) so the slash-menu wiring
// stays trivial.

import { useTranslations } from "next-intl";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import type { DocEditorState } from "@/hooks/use-doc-editor-command";

type Props = {
  open: boolean;
  state: DocEditorState;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onClose: () => void;
};

const ERROR_KEYS = new Set([
  "llm_failed",
  "selection_race",
  "command_unknown",
  "internal",
]);

export function InlineDiffSheet({
  open,
  state,
  onAcceptAll,
  onRejectAll,
  onClose,
}: Props) {
  const t = useTranslations("docEditor.sheet");
  const tErr = useTranslations("docEditor.error");

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        className="flex w-[480px] flex-col gap-4 p-4"
      >
        <SheetHeader>
          <SheetTitle>{t("title")}</SheetTitle>
        </SheetHeader>

        {state.status === "running" && (
          <p className="text-sm text-muted-foreground">{t("loading")}</p>
        )}

        {state.status === "error" && (
          <p className="text-sm text-destructive">
            {ERROR_KEYS.has(state.code) ? tErr(state.code) : tErr("internal")}
          </p>
        )}

        {state.status === "ready" && (
          <>
            <p className="mb-2 text-sm text-muted-foreground">
              {state.payload.summary || t("noChange")}
            </p>
            <div className="flex-1 space-y-3 overflow-y-auto">
              {state.payload.hunks.map((h, i) => (
                <div
                  key={`${h.blockId}-${h.originalRange.start}-${i}`}
                  className="rounded border p-2 text-sm"
                >
                  <div className="mb-1 text-xs text-muted-foreground">
                    {t("hunkOriginal")}
                  </div>
                  <pre className="line-through whitespace-pre-wrap text-foreground/70">
                    {h.originalText}
                  </pre>
                  <div className="mb-1 mt-2 text-xs text-muted-foreground">
                    {t("hunkReplacement")}
                  </div>
                  <pre className="whitespace-pre-wrap text-foreground">
                    {h.replacementText}
                  </pre>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between border-t pt-3">
              <span className="text-xs text-muted-foreground">
                {t("cost", {
                  tokensIn: state.cost.tokens_in,
                  tokensOut: state.cost.tokens_out,
                })}
              </span>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={onRejectAll}>
                  {t("rejectAll")}
                </Button>
                <Button onClick={onAcceptAll}>{t("acceptAll")}</Button>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
