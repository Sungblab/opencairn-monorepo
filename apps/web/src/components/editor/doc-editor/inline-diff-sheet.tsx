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
import type { DocEditorCommand } from "@opencairn/shared";
import {
  TRANSLATE_LANGUAGES,
  type TranslateLanguage,
} from "./inline-diff-shared";

export { TRANSLATE_LANGUAGES };
export type { TranslateLanguage };

export interface InlineDiffSheetProps {
  open: boolean;
  state: DocEditorState;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onClose: () => void;
  /**
   * Plan 11B Phase A T12 — when set, the sheet shows a small language
   * picker for `/translate`. Currently scoped to the four shipped
   * languages (ko/en/ja/zh) so we don't have to maintain a separate
   * locale-name catalog.
   */
  currentCommand?: DocEditorCommand;
  currentLanguage?: TranslateLanguage;
  onLanguageChange?: (lang: TranslateLanguage) => void;
  onShowComments?: (commentIds: string[]) => void;
}

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
  currentCommand,
  currentLanguage,
  onLanguageChange,
  onShowComments,
}: InlineDiffSheetProps) {
  const t = useTranslations("docEditor.sheet");
  const tErr = useTranslations("docEditor.error");
  const tLang = useTranslations("docEditor.translate.language");

  // Show the picker only for /translate before a result lands. Once the
  // result is in the user accepts or rejects — re-translating is "open
  // the slash menu again", which is a faster mental model than another
  // round-trip from the same sheet.
  const showLanguagePicker =
    currentCommand === "translate" &&
    state.status !== "ready" &&
    !!onLanguageChange;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        className="flex w-[480px] flex-col gap-4 p-4"
      >
        <SheetHeader>
          <SheetTitle>{t("title")}</SheetTitle>
        </SheetHeader>

        {showLanguagePicker && (
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">
              {t("hunkReplacement")}
            </span>
            <select
              value={currentLanguage ?? ""}
              onChange={(e) =>
                onLanguageChange?.(e.target.value as TranslateLanguage)
              }
              className="rounded border bg-background px-2 py-1 text-sm"
              data-testid="translate-language-picker"
            >
              {TRANSLATE_LANGUAGES.map((lang) => (
                <option key={lang} value={lang}>
                  {tLang(lang)}
                </option>
              ))}
            </select>
          </label>
        )}

        {state.status === "running" && (
          <p className="text-sm text-muted-foreground">{t("loading")}</p>
        )}

        {state.status === "error" && (
          <p className="text-sm text-destructive">
            {ERROR_KEYS.has(state.code) ? tErr(state.code) : tErr("internal")}
          </p>
        )}

        {state.status === "ready" && state.outputMode === "comment" && (
          <>
            <p className="text-sm text-muted-foreground">
              {t("commentsAdded", { count: state.commentIds.length })}
            </p>
            <div className="app-scrollbar-thin flex-1 space-y-3 overflow-y-auto">
              {state.payload.claims.map((claim, i) => (
                <div
                  key={`${claim.blockId}-${claim.range.start}-${i}`}
                  className="rounded border p-2 text-sm"
                >
                  <div className="mb-1 text-xs text-muted-foreground">
                    {t(`verdict.${claim.verdict}`)}
                  </div>
                  <p>{claim.note}</p>
                  {claim.evidence.length > 0 && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t("evidenceCount", { count: claim.evidence.length })}
                    </p>
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 border-t pt-3">
              <Button variant="ghost" onClick={onRejectAll}>
                {t("close")}
              </Button>
              <Button onClick={() => onShowComments?.(state.commentIds)}>
                {t("showComments")}
              </Button>
            </div>
          </>
        )}

        {state.status === "ready" && state.outputMode === "diff" && (
          <>
            <p className="mb-2 text-sm text-muted-foreground">
              {state.payload.summary || t("noChange")}
            </p>
            <div className="app-scrollbar-thin flex-1 space-y-3 overflow-y-auto">
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
