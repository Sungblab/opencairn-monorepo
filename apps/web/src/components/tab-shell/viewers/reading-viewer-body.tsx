"use client";

import { Pencil } from "lucide-react";
import { Plate, PlateContent } from "platejs/react";
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
import { CodeBlockPlugin, CodeLinePlugin } from "@platejs/code-block/react";
import { ListPlugin } from "@platejs/list/react";

import { CalloutPlugin } from "@/components/editor/blocks/callout/callout-plugin";
import { tablePlugins } from "@/components/editor/blocks/table/table-plugin";
import { latexPlugins } from "@/components/editor/plugins/latex";
import {
  colorFor,
  useCollaborativeEditor,
} from "@/hooks/useCollaborativeEditor";
import { useTabsStore, type Tab } from "@/stores/tabs-store";
import { HorizontalRuleElement } from "@/components/editor/elements/horizontal-rule";

// Same content block coverage as NoteEditor minus wiki-link + slash menu.
// Reading mode is content-only, so interactive overlays are off.
const readingPlugins = [
  BoldPlugin,
  ItalicPlugin,
  StrikethroughPlugin,
  CodePlugin,
  CodeBlockPlugin,
  CodeLinePlugin,
  H1Plugin,
  H2Plugin,
  H3Plugin,
  BlockquotePlugin,
  HorizontalRulePlugin.withComponent(HorizontalRuleElement),
  ListPlugin,
  CalloutPlugin,
  ...tablePlugins,
  ...latexPlugins,
];

export interface ReadingViewerBodyProps {
  tab: Tab;
  note: {
    id: string;
    title: string;
    workspaceId: string;
  };
  me: {
    userId: string;
    email: string;
    name?: string | null;
  };
  size: number;
  setSize: (n: number) => void;
  label: { editMode: string; fontSize: string; readingMode: string };
}

export function ReadingViewerBody({
  tab,
  note,
  me,
  size,
  setSize,
  label,
}: ReadingViewerBodyProps) {
  const updateTab = useTabsStore((s) => s.updateTab);
  // useCollaborativeEditor is called unconditionally here: rules-of-hooks.
  // The outer host gates on targetId/note/me before this body is loaded.
  const editor = useCollaborativeEditor({
    noteId: note.id,
    user: {
      id: me.userId,
      name: me.name ?? me.email ?? "Anonymous",
      color: colorFor(me.userId),
    },
    readOnly: true,
    basePlugins: readingPlugins,
  });

  return (
    <div
      data-testid="reading-viewer"
      className="app-scrollbar-thin h-full overflow-auto"
    >
      <div className="sticky top-0 z-10 flex min-h-11 items-center justify-between gap-3 border-b border-border bg-background/90 px-4 py-2 backdrop-blur">
        <span className="text-xs font-medium text-muted-foreground">
          {label.readingMode}
        </span>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={14}
            max={22}
            step={1}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            aria-label={label.fontSize}
            className="w-32"
          />
          <button
            type="button"
            className="app-hover inline-flex min-h-8 items-center gap-1.5 rounded-[var(--radius-control)] border border-border px-2.5 text-xs font-medium text-foreground"
            onClick={() => updateTab(tab.id, { mode: "plate" })}
          >
            <Pencil aria-hidden className="h-3.5 w-3.5" />
            {label.editMode}
          </button>
        </div>
      </div>
      <div
        data-testid="reading-viewer-body"
        style={{ fontSize: `${size}px`, lineHeight: 1.75 }}
        className="mx-auto max-w-[860px] px-6 py-9"
      >
        <Plate editor={editor} readOnly>
          <PlateContent
            data-testid="plate-content"
            readOnly
            className="prose prose-stone max-w-none focus:outline-none [&_h1]:mb-5 [&_h1]:border-b [&_h1]:border-border [&_h1]:pb-3 [&_h2]:mt-9 [&_h2]:border-b [&_h2]:border-border/70 [&_h2]:pb-2 [&_h3]:mt-6 [&_li]:my-1 [&_pre]:rounded-[var(--radius-card)] [&_pre]:border [&_pre]:border-border [&_pre]:bg-muted/45 [&_pre]:p-3 [&_table]:text-sm"
          />
        </Plate>
      </div>
    </div>
  );
}
