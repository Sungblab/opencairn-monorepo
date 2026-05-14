"use client";
import { useEffect, type ReactNode } from "react";
import { usePanelStore } from "@/stores/panel-store";
import { BacklinksPanelLoader } from "./BacklinksPanelLoader";
import { EnrichmentPanelLoader } from "./EnrichmentPanelLoader";

interface Props {
  noteId: string;
  children: ReactNode;
}

// Splits the note view into a primary content column + optional right-rail
// panels: BacklinksPanel (Cmd+Shift+B) and the Spec-B EnrichmentPanel
// (Cmd+Shift+I — "info" / metadata). Both panels are independent toggles
// so a power user can stack them; on narrow viewports the editor will
// shrink first, which matches the existing BacklinksPanel behaviour.
//
// EnrichmentPanel renders even when the note has no `note_enrichments`
// row — the empty state is a useful "this note hasn't been enriched yet"
// signal and avoids the toggle becoming silent on pre-Spec-B notes.
export function NoteWithBacklinks({ noteId, children }: Props) {
  const backlinksOpen = usePanelStore((s) => s.backlinksOpen);
  const enrichmentOpen = usePanelStore((s) => s.enrichmentOpen);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return;
      if (e.key === "B" || e.key === "b") {
        e.preventDefault();
        usePanelStore.getState().toggleBacklinks();
        return;
      }
      if (e.key === "I" || e.key === "i") {
        e.preventDefault();
        usePanelStore.getState().toggleEnrichment();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-full min-w-0 overflow-hidden">
      <div className="app-scrollbar-thin min-w-0 flex-1 overflow-auto">
        {children}
      </div>
      {enrichmentOpen ? <EnrichmentPanelLoader noteId={noteId} /> : null}
      {backlinksOpen ? <BacklinksPanelLoader noteId={noteId} /> : null}
    </div>
  );
}
