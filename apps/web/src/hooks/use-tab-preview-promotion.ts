"use client";
import { useCallback } from "react";
import { useTabsStore } from "@/stores/tabs-store";

// Promotes a note-kind preview tab to a normal (non-italic, sticky) tab
// the first time the user edits it. Looks the tab up by `targetId` so the
// caller (a client island wrapping NoteEditor) only has to know the
// noteId — it does not need to track the ephemeral tab id.
export function useTabPreviewPromotion(noteId: string | null) {
  return useCallback(() => {
    if (!noteId) return;
    const state = useTabsStore.getState();
    const tab = state.findTabByTarget("note", noteId);
    if (tab?.preview) state.promoteFromPreview(tab.id);
  }, [noteId]);
}
