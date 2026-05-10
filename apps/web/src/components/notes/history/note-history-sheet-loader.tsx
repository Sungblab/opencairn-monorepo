"use client";

import dynamic from "next/dynamic";
import type { NoteHistorySheetProps } from "./note-history-sheet";

const LazyNoteHistorySheet = dynamic<NoteHistorySheetProps>(
  () => import("./note-history-sheet").then((mod) => mod.NoteHistorySheet),
  { ssr: false, loading: () => null },
);

export function NoteHistorySheetLoader(props: NoteHistorySheetProps) {
  return <LazyNoteHistorySheet {...props} />;
}
