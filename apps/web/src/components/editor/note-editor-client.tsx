"use client";
import dynamic from "next/dynamic";
import type { NoteEditorProps } from "./NoteEditor";
import { useTabPreviewPromotion } from "@/hooks/use-tab-preview-promotion";

const LazyNoteEditor = dynamic<NoteEditorProps>(
  () => import("./NoteEditor").then((mod) => mod.NoteEditor),
  { ssr: false, loading: () => <NoteEditorSkeleton /> },
);

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
  return <LazyNoteEditor {...props} onFirstEdit={onFirstEdit} />;
}

function NoteEditorSkeleton() {
  return (
    <div aria-hidden className="flex min-h-full flex-col xl:flex-row">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="h-11 border-b bg-background" />
        <div className="mx-auto w-full max-w-[720px] flex-1 px-4 py-6 sm:px-8 sm:py-8">
          <div className="h-10 w-2/3 animate-pulse rounded bg-muted" />
          <div className="mt-8 space-y-3">
            <div className="h-4 animate-pulse rounded bg-muted/80" />
            <div className="h-4 w-11/12 animate-pulse rounded bg-muted/70" />
            <div className="h-4 w-4/5 animate-pulse rounded bg-muted/60" />
          </div>
        </div>
      </div>
      <div className="hidden border-l xl:block xl:w-80" />
    </div>
  );
}
