import { create } from "zustand";
import type { PlateEditor } from "platejs/react";

// Plan 2D — registry of currently mounted Plate editors keyed by noteId.
// Used by `insertFromSaveSuggestion` to grab the editor for the active
// tab without prop-drilling through the agent panel. Each NoteEditor
// registers on mount and removes on unmount; leaks would surface as a
// growing Map (the test guards against that).
interface ActiveEditorState {
  editors: Map<string, PlateEditor>;
  setEditor: (noteId: string, editor: PlateEditor) => void;
  getEditor: (noteId: string) => PlateEditor | undefined;
  removeEditor: (noteId: string) => void;
}

export const useActiveEditorStore = create<ActiveEditorState>((set, get) => ({
  editors: new Map(),
  setEditor: (noteId, editor) => {
    const next = new Map(get().editors);
    next.set(noteId, editor);
    set({ editors: next });
  },
  getEditor: (noteId) => get().editors.get(noteId),
  removeEditor: (noteId) => {
    const next = new Map(get().editors);
    next.delete(noteId);
    set({ editors: next });
  },
}));
