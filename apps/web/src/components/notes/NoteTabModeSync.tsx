"use client";
import { useEffect } from "react";
import { modeFromSourceType, useTabsStore } from "@/stores/tabs-store";

interface Props {
  noteId: string;
  sourceType: string | null;
}

export function NoteTabModeSync({ noteId, sourceType }: Props) {
  const targetTab = useTabsStore((s) =>
    s.tabs.find((t) => t.kind === "note" && t.targetId === noteId),
  );
  const updateTab = useTabsStore((s) => s.updateTab);

  useEffect(() => {
    const targetMode = modeFromSourceType(sourceType);
    if (targetMode === "plate") return;
    if (!targetTab || targetTab.mode === targetMode) return;
    updateTab(targetTab.id, { mode: targetMode });
  }, [sourceType, targetTab, updateTab]);

  return null;
}
