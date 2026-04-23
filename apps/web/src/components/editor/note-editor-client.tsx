"use client";
import { NoteEditor, type NoteEditorProps } from "./NoteEditor";
import { useTabPreviewPromotion } from "@/hooks/use-tab-preview-promotion";

// Client island between the server-resolved note page and NoteEditor. Wires
// the App Shell Phase 3 preview-tab-promotion hook into the editor's first
// keystroke so opening a note via sidebar single-click + typing converts
// the italic preview tab into a sticky one without the user having to pin
// or double-click.
//
// Kept separate from NoteEditor itself so the editor stays usable outside
// the app shell (e.g., in isolated tests or future embed surfaces).
export function NoteEditorClient(props: NoteEditorProps) {
  const onFirstEdit = useTabPreviewPromotion(props.noteId);
  return <NoteEditor {...props} onFirstEdit={onFirstEdit} />;
}
