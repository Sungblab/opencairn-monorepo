"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
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
import { ListPlugin } from "@platejs/list/react";

import {
  useCollaborativeEditor,
  colorFor,
} from "@/hooks/useCollaborativeEditor";
import { latexPlugins } from "@/components/editor/plugins/latex";
import type { Tab } from "@/stores/tabs-store";

// Same plugin list as NoteEditor minus wiki-link + slash menu. Reading mode
// is content-only, so interactive overlays are off. If you find yourself
// copying more plugins here, extract a shared `readingPlugins` array
// colocated with NoteEditor's own plugin list.
const readingPlugins = [
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

interface NoteMeta {
  id: string;
  title: string;
  workspaceId: string;
}

interface Me {
  userId: string;
  email: string;
  name?: string | null;
}

export function ReadingViewer({ tab }: { tab: Tab }) {
  const t = useTranslations("appShell.viewers.reading");
  const [size, setSize] = useState(16);

  const { data: note } = useQuery<NoteMeta>({
    queryKey: ["note-meta", tab.targetId],
    enabled: !!tab.targetId,
    queryFn: async () => {
      const r = await fetch(`/api/notes/${tab.targetId}`);
      if (!r.ok) throw new Error(`note ${r.status}`);
      return (await r.json()) as NoteMeta;
    },
  });

  const { data: me } = useQuery<Me>({
    queryKey: ["me"],
    queryFn: async () => {
      const r = await fetch("/api/auth/me");
      if (!r.ok) throw new Error(`me ${r.status}`);
      return (await r.json()) as Me;
    },
  });

  if (!tab.targetId) return null;
  if (!note || !me) {
    return (
      <div
        data-testid="reading-viewer"
        className="flex h-full items-center justify-center text-sm text-muted-foreground"
      >
        ...
      </div>
    );
  }

  return (
    <ReadingViewerBody
      tab={tab}
      note={note}
      me={me}
      size={size}
      setSize={setSize}
      label={{ fontSize: t("fontSize") }}
    />
  );
}

function ReadingViewerBody({
  tab: _tab,
  note,
  me,
  size,
  setSize,
  label,
}: {
  tab: Tab;
  note: NoteMeta;
  me: Me;
  size: number;
  setSize: (n: number) => void;
  label: { fontSize: string };
}) {
  // useCollaborativeEditor is called unconditionally here — rules-of-hooks.
  // The gating on `tab.targetId` / `note` / `me` happens ABOVE in the outer
  // component, so by the time we reach this body we have real values.
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
    <div data-testid="reading-viewer" className="h-full overflow-auto">
      <div className="sticky top-0 z-10 flex items-center justify-end gap-3 border-b border-border bg-background/80 px-4 py-2 backdrop-blur">
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
      </div>
      <div
        data-testid="reading-viewer-body"
        style={{ fontSize: `${size}px`, lineHeight: 1.7 }}
        className="mx-auto max-w-[720px] px-6 py-8"
      >
        <Plate editor={editor} readOnly>
          <PlateContent
            data-testid="plate-content"
            readOnly
            className="prose prose-stone max-w-none focus:outline-none"
          />
        </Plate>
      </div>
    </div>
  );
}
