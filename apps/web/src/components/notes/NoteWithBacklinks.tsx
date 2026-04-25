"use client";
import { useEffect, type ReactNode } from "react";
import { usePanelStore } from "@/stores/panel-store";
import { BacklinksPanel } from "./BacklinksPanel";

interface Props {
  noteId: string;
  children: ReactNode;
}

// Splits the note view into a primary content column + an optional
// BacklinksPanel rail. Exposes Cmd+Shift+B / Ctrl+Shift+B to toggle the
// panel through the shared panel-store. Mounted by the note route page so
// BacklinksPanel sits beside whatever primary surface the page renders
// (placeholder today, the real Plate editor once Plan 2D ships).
export function NoteWithBacklinks({ noteId, children }: Props) {
  const backlinksOpen = usePanelStore((s) => s.backlinksOpen);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        (e.key === "B" || e.key === "b")
      ) {
        e.preventDefault();
        usePanelStore.getState().toggleBacklinks();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-auto">{children}</div>
      {backlinksOpen ? <BacklinksPanel noteId={noteId} /> : null}
    </div>
  );
}
