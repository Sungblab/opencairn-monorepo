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

import {
  EditorToolbar,
  type ToolbarActions,
  type ToolbarBlock,
  type ToolbarMark,
} from "./editor-toolbar";
import { latexPlugins } from "./plugins/latex";
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
  projectId: string;
  /** Authenticated user id — used as the Yjs awareness key. */
  userId: string;
  /** Display name shown next to remote cursors. */
  userName: string;
  /** Server-derived (role === viewer|commenter). Locks both title + body. */
  readOnly: boolean;
}

export function NoteEditor({
  noteId,
  initialTitle,
  wsSlug,
  projectId,
  userId,
  userName,
  readOnly,
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
    <div className="flex min-h-full flex-col">
      <EditorToolbar actions={actions} />
      <WikiLinkCombobox
        ctx={{ wsSlug, projectId }}
        editor={editor as unknown as Parameters<typeof WikiLinkCombobox>[0]["editor"]}
      />
      <SlashMenu editor={editor as unknown as SlashEditor} />
      <div className="mx-auto w-full max-w-[720px] flex-1 px-8 py-8">
        <input
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder={t("placeholder.title")}
          disabled={readOnly}
          className="placeholder:text-fg-muted w-full bg-transparent text-3xl font-semibold outline-none"
          data-testid="note-title"
        />
        <Plate editor={editor} readOnly={readOnly}>
          <PlateContent
            data-testid="note-body"
            placeholder={t("placeholder.body")}
            className="prose prose-stone mt-6 min-h-[60vh] max-w-none focus:outline-none"
            readOnly={readOnly}
          />
        </Plate>
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
  );
}
