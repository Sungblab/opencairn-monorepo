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
import { Plate, PlateContent } from "platejs/react";
import debounce from "lodash.debounce";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import {
  useCollaborativeEditor,
  colorFor,
} from "@/hooks/useCollaborativeEditor";
import { api, ApiError } from "@/lib/api-client";

import { DisconnectedBanner } from "../collab/DisconnectedBanner";
import { ReadOnlyBanner } from "../collab/ReadOnlyBanner";
import { CommentsPanel } from "../comments/CommentsPanel";
import {
  EditorToolbar,
  type ToolbarActions,
  type ToolbarBlock,
  type ToolbarMark,
} from "./editor-toolbar";
import { latexPlugins } from "./plugins/latex";
import { PresenceStack } from "./PresenceStack";
import { SlashMenu, type SlashEditor } from "./plugins/slash";
import {
  createWikiLinkPlugin,
  WikiLinkCombobox,
} from "./plugins/wiki-link";

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
  ...latexPlugins,
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
      firstEditFiredRef.current = true;
      onFirstEdit?.();
    },
    [onFirstEdit],
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
        className="contents"
      >
      {/* Outer flex row: editor column (flex-1) on the left, CommentsPanel
          (fixed 320px) on the right. The panel is outside the Plate content
          flow but still inside <Plate> so future block-anchored jumps can
          use the editor context without prop drilling. */}
      <div className="flex min-h-full">
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
            editor={editor as unknown as Parameters<typeof WikiLinkCombobox>[0]["editor"]}
          />
          <SlashMenu editor={editor as unknown as SlashEditor} />
          <div className="mx-auto w-full max-w-[720px] flex-1 px-8 py-8">
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
                  layout disruption. */}
              <div className="shrink-0 pt-2">
                <PresenceStack />
              </div>
            </div>
            <PlateContent
              data-testid="note-body"
              placeholder={t("placeholder.body")}
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
        <CommentsPanel
          noteId={noteId}
          workspaceId={workspaceId}
          canComment={canComment}
        />
      </div>
      </div>
    </Plate>
  );
}
