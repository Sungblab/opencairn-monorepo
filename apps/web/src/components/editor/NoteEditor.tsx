"use client";

import {
  BlockquotePlugin,
  BoldPlugin,
  CodePlugin,
  H1Plugin,
  H2Plugin,
  H3Plugin,
  ItalicPlugin,
  StrikethroughPlugin,
} from "@platejs/basic-nodes/react";
import { ListPlugin } from "@platejs/list/react";
import { toggleList } from "@platejs/list";
import { Plate, PlateContent, usePlateEditor } from "platejs/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { useSaveNote } from "@/hooks/use-save-note";
import {
  emptyEditorValue,
  parseEditorContent,
  type PlateValue,
} from "@/lib/editor-utils";

import {
  EditorToolbar,
  type ToolbarActions,
  type ToolbarBlock,
  type ToolbarMark,
} from "./editor-toolbar";
import { latexPlugins } from "./plugins/latex";

// Basic marks + blocks. Lists are handled by the indent-based ListPlugin; the
// bulleted/numbered toolbar buttons call `toggleList` directly with the style
// type. Slash-command list insertion lands in Task 17. `latexPlugins` wires the
// void equation/inline-equation nodes to their KaTeX renderers.
const basePlugins = [
  BoldPlugin,
  ItalicPlugin,
  StrikethroughPlugin,
  CodePlugin,
  H1Plugin,
  H2Plugin,
  H3Plugin,
  BlockquotePlugin,
  ListPlugin,
  ...latexPlugins,
];

export interface NoteEditorProps {
  noteId: string;
  initialTitle: string;
  initialValue: PlateValue | null;
  readOnly?: boolean;
}

export function NoteEditor({
  noteId,
  initialTitle,
  initialValue,
  readOnly,
}: NoteEditorProps) {
  const t = useTranslations("editor");
  const { save, flush, status, lastError } = useSaveNote(noteId);

  const [title, setTitle] = useState(initialTitle);
  const startValue = useMemo(
    () => parseEditorContent(initialValue ?? emptyEditorValue()),
    [initialValue],
  );

  const editor = usePlateEditor({
    plugins: basePlugins,
    // `PlateValue` is intentionally loose (see lib/editor-utils.ts); Plate's
    // internal `Value` type is strict. Cast at the boundary.
    value: startValue as unknown as never,
  });

  const handleTitleChange = useCallback(
    (v: string) => {
      setTitle(v);
      save({ title: v });
    },
    [save],
  );

  const handleContentChange = useCallback(
    ({ value }: { value: unknown }) => {
      save({ content: value as PlateValue });
    },
    [save],
  );

  // Cmd/Ctrl+S forces a synchronous save of the current title + editor value.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void flush({ title, content: editor.children as PlateValue }).catch(
          () => {
            // useSaveNote already surfaces the error via `lastError`.
          },
        );
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flush, title, editor]);

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
      <div className="mx-auto w-full max-w-[720px] flex-1 px-8 py-8">
        <input
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder={t("placeholder.title")}
          disabled={readOnly}
          className="placeholder:text-fg-muted w-full bg-transparent text-3xl font-semibold outline-none"
          data-testid="note-title"
        />
        <Plate
          editor={editor}
          onValueChange={handleContentChange}
          readOnly={readOnly}
        >
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
          {status === "saving" && t("save.saving")}
          {status === "saved" && t("save.saved")}
          {status === "error" && (
            <span className="text-red-600">
              {t("save.failed")}
              {lastError ? `: ${lastError}` : null}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
