"use client";

import {
  BlockquotePlugin,
  BoldPlugin,
  CodePlugin,
  H1Plugin,
  H2Plugin,
  H3Plugin,
  HorizontalRulePlugin,
  ItalicPlugin,
  StrikethroughPlugin,
} from "@platejs/basic-nodes/react";
import { ListPlugin } from "@platejs/list/react";
import { toggleList } from "@platejs/list";
import { CodeBlockPlugin, CodeLinePlugin } from "@platejs/code-block/react";
import { Plate, PlateContent } from "platejs/react";
import debounce from "lodash.debounce";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Bot, MessageSquare, Share2, Volume2 } from "lucide-react";

import {
  useCollaborativeEditor,
  colorFor,
} from "@/hooks/useCollaborativeEditor";
import { api, ApiError } from "@/lib/api-client";

import { DisconnectedBanner } from "../collab/DisconnectedBanner";
import { ReadOnlyBanner } from "../collab/ReadOnlyBanner";
import { CommentsPanel } from "../comments/CommentsPanel";
import { ShareDialog } from "../share/share-dialog";
import {
  EditorToolbar,
  type ToolbarActions,
  type ToolbarBlock,
  type ToolbarMark,
} from "./editor-toolbar";
import { latexPlugins } from "./plugins/latex";
import { PresenceStack } from "./PresenceStack";
import { SlashMenu, type SlashEditor, type SlashAiKey } from "./plugins/slash";
import {
  InlineDiffSheet,
  TRANSLATE_LANGUAGES,
  type TranslateLanguage,
} from "./doc-editor/inline-diff-sheet";
import { applyHunksToValue } from "./doc-editor/apply-hunks";
import {
  readBlockSelection,
  type BlockSelectionEditor,
} from "./doc-editor/read-block-selection";
import { useDocEditorCommand } from "@/hooks/use-doc-editor-command";
import type { Value } from "platejs";
import { createWikiLinkPlugin, WikiLinkCombobox } from "./plugins/wiki-link";
import { researchMetaPlugin } from "./blocks/research-meta/research-meta-plugin";
import { MermaidPlugin } from "./blocks/mermaid/mermaid-plugin";
import { CalloutPlugin } from "./blocks/callout/callout-plugin";
import { TogglePlugin } from "./blocks/toggle/toggle-plugin";
import { tablePlugins } from "./blocks/table/table-plugin";
import { columnsPlugins } from "./blocks/columns/columns-plugin";
import { MermaidFencePlugin } from "./plugins/mermaid-fence";
import { PasteNormPlugin } from "./plugins/paste-norm";
import { mathTriggerPlugin } from "./plugins/math-trigger";
import { embedPlugin } from "./blocks/embed/embed-plugin";
import {
  EmbedInsertPopover,
  insertEmbedNode,
  type EmbedInsertResolution,
} from "./blocks/embed/embed-insert-popover";
import { imagePlugin } from "./blocks/image/image-plugin";
import {
  ImageInsertPopover,
  insertImageNode,
  type ImageInsertData,
} from "./blocks/image/image-insert-popover";
import {
  imageDropDeferredPlugin,
  useImageUploadDeferredToast,
} from "./plugins/image-drop-deferred";
import { useActiveEditorStore } from "@/stores/activeEditorStore";
import { urls } from "@/lib/urls";

// Basic marks + blocks. Lists are handled by the indent-based ListPlugin; the
// bulleted/numbered toolbar buttons call `toggleList` directly with the style
// type. `latexPlugins` wires the void equation/inline-equation nodes to their
// KaTeX renderers. Content persistence is handled by YjsPlugin in
// `useCollaborativeEditor` — this array does NOT include YjsPlugin itself.
const basePlugins = [
  BoldPlugin,
  ItalicPlugin,
  StrikethroughPlugin,
  CodePlugin,
  H1Plugin,
  H2Plugin,
  H3Plugin,
  BlockquotePlugin,
  HorizontalRulePlugin,
  ListPlugin,
  CodeBlockPlugin,
  CodeLinePlugin,
  ...latexPlugins,
  researchMetaPlugin,
  MermaidPlugin,
  CalloutPlugin,
  TogglePlugin,
  ...tablePlugins,
  ...columnsPlugins,
  MermaidFencePlugin,
  PasteNormPlugin,
  mathTriggerPlugin,
  embedPlugin,
  imagePlugin,
  imageDropDeferredPlugin,
];

type TitleSaveStatus = "idle" | "saving" | "saved" | "error";

export interface NoteEditorProps {
  noteId: string;
  initialTitle: string;
  wsSlug: string;
  /**
   * Workspace uuid (not slug). Forwarded to CommentsPanel so the @mention
   * combobox can scope `/api/mentions/search`. `wsSlug` is kept separately
   * because the wiki-link combobox builds route URLs from the slug.
   */
  workspaceId: string;
  projectId: string;
  /** Authenticated user id — used as the Yjs awareness key. */
  userId: string;
  /** Display name shown next to remote cursors. */
  userName: string;
  /** Server-derived (role === viewer|commenter). Locks both title + body. */
  readOnly: boolean;
  /**
   * Server-derived (role !== viewer). Commenters are `readOnly` for Yjs but
   * still allowed to post/resolve/delete comments — the two flags are
   * intentionally decoupled.
   */
  canComment: boolean;
  /**
   * Fires once on the user's first interactive keystroke. Used by the
   * App Shell Phase 3 tab system to promote a preview (single-click)
   * tab into a sticky tab on first edit. Safe to omit — the editor
   * works the same without it.
   */
  onFirstEdit?: () => void;
}

export function NoteEditor({
  noteId,
  initialTitle,
  wsSlug,
  workspaceId,
  projectId,
  userId,
  userName,
  readOnly,
  canComment,
  onFirstEdit,
}: NoteEditorProps) {
  const t = useTranslations("editor");
  // Plan 2C Task 9 — separate namespace because the existing `t` is bound
  // to "editor" and we want the share UI strings to live in their own JSON
  // file (one feature per namespace, easier i18n parity).
  const tShare = useTranslations("shareDialog");
  const tDocEditor = useTranslations("docEditor");
  const [shareOpen, setShareOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [scrollTargetCommentId, setScrollTargetCommentId] = useState<
    string | null
  >(null);

  // Plan 11B Phase A — slash AI commands (`/improve`, `/translate`, etc.).
  // Gated client-side by NEXT_PUBLIC_FEATURE_DOC_EDITOR_SLASH so the menu
  // items only render when the backend route + worker are also live; the
  // API enforces the same gate server-side, so a stale browser would only
  // see 404s here regardless.
  const aiSlashEnabled =
    process.env.NEXT_PUBLIC_FEATURE_DOC_EDITOR_SLASH === "true";
  const ragSlashEnabled =
    aiSlashEnabled && process.env.NEXT_PUBLIC_FEATURE_DOC_EDITOR_RAG === "true";
  const docEditor = useDocEditorCommand();
  const queryClient = useQueryClient();
  // Plan 2E Phase B — embed insert popover state (Task 1.4).
  const [embedPopoverOpen, setEmbedPopoverOpen] = useState(false);
  // Plan 2E Phase B-2 — image insert popover state (Task 2.3).
  const [imagePopoverOpen, setImagePopoverOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pendingCommand, setPendingCommand] = useState<SlashAiKey | null>(null);
  const [pendingSelection, setPendingSelection] = useState<ReturnType<
    typeof readBlockSelection
  > | null>(null);
  const locale = useLocale();
  const defaultTranslateTarget: TranslateLanguage =
    locale === "ko" ? "en" : "ko";
  const [translateLanguage, setTranslateLanguage] = useState<TranslateLanguage>(
    defaultTranslateTarget,
  );

  // ── Title save path (PATCH /notes/:id with { title } only) ────────────
  // Content persists via Yjs; only title/folderId still flow through the
  // REST API (updateNoteSchema.omit({content})). Kept a tiny local debounce
  // here instead of a hook since the logic is straightforward.
  const [title, setTitle] = useState(initialTitle);
  const [titleStatus, setTitleStatus] = useState<TitleSaveStatus>("idle");
  const [titleError, setTitleError] = useState<string | null>(null);
  // Guard against "saved"→"idle" flicker when rapid edits race the response.
  const pendingRef = useRef(0);
  // Tracks whether `onFirstEdit` has already fired so preview-tab promotion
  // is a one-shot. Lives on a ref (not state) so it doesn't cause a
  // re-render on the first keystroke.
  const firstEditFiredRef = useRef(false);
  const notifyFirstEditOnce = useCallback(() => {
    if (firstEditFiredRef.current) return;
    firstEditFiredRef.current = true;
    onFirstEdit?.();
  }, [onFirstEdit]);

  const notifyFirstEditOnKey = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (firstEditFiredRef.current) return;
      // Modifier chords (⌘S, ⌘A, ⌘C, etc.) are not "edits" for promotion
      // purposes — the user is inspecting or saving, not authoring. Alt on
      // its own is often used for word-nav and special-char entry; leave
      // it out of promotion too.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Printable one-character keys (letters, digits, punctuation) are
      // real authoring. e.key.length === 1 distinguishes "a" from
      // "ArrowLeft" / "Tab" / "Escape" / "Shift". Bare modifiers (Shift
      // held alone) have e.key === "Shift" and fail the length check.
      const isPrintable = e.key.length === 1;
      const isEditingKey =
        e.key === "Backspace" || e.key === "Delete" || e.key === "Enter";
      if (!isPrintable && !isEditingKey) return;
      notifyFirstEditOnce();
    },
    [notifyFirstEditOnce],
  );

  // Paste and drop are always "edit intent" (the user is authoring content,
  // just via a non-keystroke channel) so they skip the printable-key filter
  // and go straight to the shared one-shot gate. Without these, a user who
  // starts a fresh note by pasting or dragging content never promotes the
  // preview tab — the next sidebar click silently replaces their work.
  const notifyFirstEditOnPaste = useCallback(
    (_e: React.ClipboardEvent<HTMLDivElement>) => {
      notifyFirstEditOnce();
    },
    [notifyFirstEditOnce],
  );

  const notifyFirstEditOnDrop = useCallback(
    (_e: React.DragEvent<HTMLDivElement>) => {
      notifyFirstEditOnce();
    },
    [notifyFirstEditOnce],
  );

  const patchTitle = useCallback(
    async (value: string) => {
      pendingRef.current += 1;
      setTitleStatus("saving");
      try {
        await api.patchNote(noteId, { title: value });
        pendingRef.current -= 1;
        if (pendingRef.current === 0) {
          setTitleStatus("saved");
          setTitleError(null);
        }
      } catch (err) {
        pendingRef.current = Math.max(0, pendingRef.current - 1);
        setTitleStatus("error");
        setTitleError(err instanceof ApiError ? err.message : String(err));
      }
    },
    [noteId],
  );

  const debouncedPatchTitle = useMemo(
    () => debounce((v: string) => void patchTitle(v), 500),
    [patchTitle],
  );

  // Cancel pending debounced save on unmount so unmounts mid-typing don't
  // fire a spurious PATCH after the page is gone.
  useEffect(() => () => debouncedPatchTitle.cancel(), [debouncedPatchTitle]);

  const handleTitleChange = useCallback(
    (v: string) => {
      setTitle(v);
      debouncedPatchTitle(v);
    },
    [debouncedPatchTitle],
  );

  // Wiki-link plugin is built per-editor so the element renderer can close
  // over the route context. Memoized so `useCollaborativeEditor` (which
  // depends on `basePlugins` by reference) doesn't churn.
  const plugins = useMemo(
    () => [...basePlugins, createWikiLinkPlugin({ wsSlug, projectId })],
    [wsSlug, projectId],
  );

  const editor = useCollaborativeEditor({
    noteId,
    user: { id: userId, name: userName, color: colorFor(userId) },
    readOnly,
    basePlugins: plugins,
  });
  useImageUploadDeferredToast(noteId, editor as never);

  const setEditor = useActiveEditorStore((s) => s.setEditor);
  const removeEditor = useActiveEditorStore((s) => s.removeEditor);

  useEffect(() => {
    if (!editor) return;
    setEditor(noteId, editor);
    return () => {
      // Only clear the registration if our editor is still the registered
      // one. A newer mount for the same noteId (split view, rapid tab
      // remount, StrictMode) may have already replaced it; clearing then
      // would orphan the new instance.
      if (useActiveEditorStore.getState().getEditor(noteId) === editor) {
        removeEditor(noteId);
      }
    };
  }, [editor, noteId, setEditor, removeEditor]);

  // Cmd/Ctrl+S flushes the PENDING title save only — editor content is
  // already live via Yjs, so there is nothing to "save" on keystroke.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        debouncedPatchTitle.cancel();
        void patchTitle(title);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [debouncedPatchTitle, patchTitle, title]);

  const handleAiCommand = useCallback(
    (cmd: SlashAiKey) => {
      if (readOnly) return;
      const selection = readBlockSelection(
        editor as unknown as BlockSelectionEditor,
      );
      // Silent no-op when there's no usable selection (empty block, no id,
      // over the 4000-char ceiling). The user retries; T13 will surface a
      // hint here once the toast plumbing lands.
      if (!selection) return;
      setPendingCommand(cmd);
      setPendingSelection(selection);
      setSheetOpen(true);
      void docEditor.run(noteId, cmd, {
        selection,
        documentContextSnippet: "",
        ...(cmd === "translate" ? { language: translateLanguage } : {}),
      });
    },
    [editor, readOnly, docEditor, noteId, translateLanguage],
  );

  const handleLanguageChange = useCallback(
    (lang: TranslateLanguage) => {
      if (!TRANSLATE_LANGUAGES.includes(lang)) return;
      setTranslateLanguage(lang);
      // Re-fire the workflow with the new language. The hook aborts the
      // previous in-flight fetch on every `run`, so old SSE frames can't
      // bleed into the new diff sheet.
      if (pendingCommand !== "translate" || !pendingSelection) return;
      void docEditor.run(noteId, "translate", {
        selection: pendingSelection,
        documentContextSnippet: "",
        language: lang,
      });
    },
    [pendingCommand, pendingSelection, docEditor, noteId],
  );

  const handleAcceptAll = useCallback(() => {
    if (
      docEditor.state.status !== "ready" ||
      docEditor.state.outputMode !== "diff"
    ) {
      return;
    }
    const result = applyHunksToValue(
      editor.children as unknown as Value,
      docEditor.state.payload.hunks,
    );
    // v49: `editor.tf.setValue(value)` replaces the whole document. Cast
    // through unknown — the PlateEditor generic parameterises tf with the
    // full plugin set and would force us to re-declare the same shape.
    (editor.tf as unknown as { setValue: (v: Value) => void }).setValue(
      result.value,
    );
    // Document drifted between selection capture and accept — at least one
    // hunk no longer matches its expected `originalText`. The successful
    // hunks still apply (right-to-left splice keeps offsets valid for the
    // ones that did match), but warn the user so they re-check the doc.
    if (result.skippedCount > 0) {
      toast.warning(tDocEditor("error.selection_race"));
    }
    setSheetOpen(false);
    setPendingCommand(null);
    setPendingSelection(null);
    docEditor.reset();
  }, [editor, docEditor, tDocEditor]);

  const handleRejectAll = useCallback(() => {
    setSheetOpen(false);
    setPendingCommand(null);
    setPendingSelection(null);
    docEditor.reset();
  }, [docEditor]);

  useEffect(() => {
    if (
      docEditor.state.status === "ready" &&
      docEditor.state.outputMode === "comment"
    ) {
      setCommentsOpen(true);
      void queryClient.invalidateQueries({ queryKey: ["comments", noteId] });
    }
  }, [docEditor.state, noteId, queryClient]);

  const handleShowComments = useCallback(
    (commentIds: string[]) => {
      setCommentsOpen(true);
      setScrollTargetCommentId(commentIds[0] ?? null);
      handleRejectAll();
    },
    [handleRejectAll],
  );

  // Plan 2E Phase B — embed + image insert popover handlers (Tasks 1.4 + 2.3).
  const handleRequestPopover = useCallback((kind: "embed" | "image") => {
    if (kind === "embed") setEmbedPopoverOpen(true);
    if (kind === "image") setImagePopoverOpen(true);
  }, []);

  const handleEmbedInsert = useCallback(
    (resolution: EmbedInsertResolution) => {
      insertEmbedNode(
        editor as unknown as Parameters<typeof insertEmbedNode>[0],
        resolution,
      );
    },
    [editor],
  );

  const handleImageInsert = useCallback(
    (data: ImageInsertData) => {
      insertImageNode(
        editor as unknown as Parameters<typeof insertImageNode>[0],
        data,
      );
    },
    [editor],
  );

  const actions: ToolbarActions = useMemo(
    () => ({
      toggleMark: (mark: ToolbarMark) => {
        // v49: editor.tf.{pluginKey}.toggle()
        const tf = editor.tf as unknown as Record<
          string,
          { toggle?: () => void } | undefined
        >;
        tf[mark]?.toggle?.();
      },
      toggleBlock: (type: ToolbarBlock) => {
        if (type === "ul") {
          toggleList(editor, { listStyleType: "disc" });
          return;
        }
        if (type === "ol") {
          toggleList(editor, { listStyleType: "decimal" });
          return;
        }
        const tf = editor.tf as unknown as Record<
          string,
          { toggle?: () => void } | undefined
        >;
        tf[type]?.toggle?.();
      },
    }),
    [editor],
  );

  return (
    <Plate editor={editor} readOnly={readOnly}>
      {/* onKeyDownCapture wraps both the title input and PlateContent so
          any user keystroke anywhere in the editor fires notifyFirstEdit
          once — used by the tab shell to promote a preview tab on the
          first interactive input. Capture-phase so ancestor toolbar keys
          still bubble normally. */}
      <div
        onKeyDownCapture={readOnly ? undefined : notifyFirstEditOnKey}
        onPasteCapture={readOnly ? undefined : notifyFirstEditOnPaste}
        onDropCapture={readOnly ? undefined : notifyFirstEditOnDrop}
        className="contents"
      >
        {/* Outer flex row: editor column (flex-1) on the left, CommentsPanel
          (fixed 320px) on the right. The panel is outside the Plate content
          flow but still inside <Plate> so future block-anchored jumps can
          use the editor context without prop drilling. */}
        <div className="flex min-h-full flex-col xl:flex-row">
          <div className="flex min-w-0 flex-1 flex-col">
            {/* Banners live inside <Plate> so they can read the editor context
              via useEditorRef / usePluginOption. `DisconnectedBanner`
              self-hides when connected; `ReadOnlyBanner` is gated by the
              server-resolved `readOnly` prop. */}
            <DisconnectedBanner />
            {readOnly && <ReadOnlyBanner />}

            <EditorToolbar actions={actions} />
            <WikiLinkCombobox
              ctx={{ wsSlug, projectId }}
              editor={
                editor as unknown as Parameters<
                  typeof WikiLinkCombobox
                >[0]["editor"]
              }
            />
            <SlashMenu
              editor={editor as unknown as SlashEditor}
              aiEnabled={aiSlashEnabled && !readOnly}
              ragEnabled={ragSlashEnabled && !readOnly}
              onAiCommand={handleAiCommand}
              onRequestPopover={readOnly ? undefined : handleRequestPopover}
            />
            {/* Plan 2E Phase B — embed URL input popover (Task 1.4).
              The anchor is invisible; the popover is opened programmatically
              via embedPopoverOpen state set by onRequestPopover. */}
            <EmbedInsertPopover
              open={embedPopoverOpen}
              onOpenChange={setEmbedPopoverOpen}
              anchor={<span />}
              onInsert={handleEmbedInsert}
            />
            {/* Plan 2E Phase B-2 — image URL input popover (Task 2.3). */}
            <ImageInsertPopover
              open={imagePopoverOpen}
              onOpenChange={setImagePopoverOpen}
              anchor={<span />}
              onInsert={handleImageInsert}
            />
            {aiSlashEnabled && (
              <InlineDiffSheet
                open={sheetOpen}
                state={docEditor.state}
                onAcceptAll={handleAcceptAll}
                onRejectAll={handleRejectAll}
                onClose={handleRejectAll}
                currentCommand={pendingCommand ?? undefined}
                currentLanguage={translateLanguage}
                onLanguageChange={handleLanguageChange}
                onShowComments={handleShowComments}
              />
            )}
            <div className="mx-auto w-full max-w-[720px] flex-1 px-4 py-6 sm:px-8 sm:py-8">
              <div className="flex items-start justify-between gap-4">
                <input
                  value={title}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  placeholder={t("placeholder.title")}
                  disabled={readOnly}
                  className="placeholder:text-fg-muted w-full bg-transparent text-3xl font-semibold outline-none"
                  data-testid="note-title"
                />
                {/* PresenceStack shows remote collaborators; self-hides when
                  alone. Positioned in the title row's top-right for minimal
                  layout disruption. The Share button only renders for
                  writers — the route-level `readOnly` flag already strips it
                  for viewer/commenter roles, so we don't need an explicit
                  perms check here. */}
                <div
                  className="flex shrink-0 items-center gap-1 pt-1"
                  data-testid="note-actions"
                >
                  {!readOnly ? (
                    <Link
                      href={`${urls.workspace.projectAgents(locale, wsSlug, projectId)}?noteId=${noteId}`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                      data-testid="note-agent-link"
                      aria-label={t("toolbar.agents")}
                      title={t("toolbar.agents")}
                    >
                      <Bot aria-hidden className="h-4 w-4" />
                    </Link>
                  ) : null}
                  {!readOnly ? (
                    <Link
                      href={`${urls.workspace.projectAgents(locale, wsSlug, projectId)}?agent=narrator&noteId=${noteId}`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                      data-testid="narrate-note-link"
                      aria-label={t("toolbar.narrate")}
                      title={t("toolbar.narrate")}
                    >
                      <Volume2 aria-hidden className="h-4 w-4" />
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setCommentsOpen((open) => !open)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                    data-testid="comments-toggle-button"
                    aria-expanded={commentsOpen}
                    aria-label={t("toolbar.comments")}
                    title={t("toolbar.comments")}
                  >
                    <MessageSquare aria-hidden className="h-4 w-4" />
                  </button>
                  {!readOnly ? (
                    <button
                      type="button"
                      onClick={() => setShareOpen(true)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                      data-testid="share-button"
                      aria-label={tShare("title")}
                      title={tShare("title")}
                    >
                      <Share2 aria-hidden className="h-4 w-4" />
                    </button>
                  ) : null}
                  <PresenceStack />
                </div>
              </div>
              <ShareDialog
                noteId={noteId}
                workspaceId={workspaceId}
                open={shareOpen}
                onOpenChange={setShareOpen}
              />
              <PlateContent
                data-testid="note-body"
                placeholder={
                  aiSlashEnabled && !readOnly
                    ? t("placeholder.body_with_slash")
                    : t("placeholder.body")
                }
                className="prose prose-stone mt-6 min-h-[60vh] max-w-none focus:outline-none"
                readOnly={readOnly}
              />
              <div
                className="text-fg-muted mt-4 text-xs"
                data-testid="save-status"
                role="status"
                aria-live="polite"
              >
                {titleStatus === "saving" && t("save.saving")}
                {titleStatus === "saved" && t("save.saved")}
                {titleStatus === "error" && (
                  <span className="text-red-600">
                    {t("save.failed")}
                    {titleError ? `: ${titleError}` : null}
                  </span>
                )}
              </div>
            </div>
          </div>
          {commentsOpen ? (
            <CommentsPanel
              noteId={noteId}
              workspaceId={workspaceId}
              canComment={canComment}
              onClose={() => setCommentsOpen(false)}
              scrollTargetCommentId={scrollTargetCommentId}
              onScrolledToTarget={() => setScrollTargetCommentId(null)}
            />
          ) : null}
        </div>
      </div>
    </Plate>
  );
}
