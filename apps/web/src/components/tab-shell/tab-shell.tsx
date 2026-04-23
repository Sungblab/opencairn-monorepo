"use client";
import { TabBar } from "./tab-bar";

// Phase 3-A scope: tab bar chrome + route-level content. The spec's
// per-mode viewer dispatch (TabModeRouter) lands in Plan 3-B alongside the
// backend endpoints that power source / data viewers. For plate and
// reading-mode notes, route-level pages (e.g., notes/[noteId]/page.tsx)
// render via `children` — they already do the server-side auth + fetch
// fan-out that NoteEditor needs.
export function TabShell({ children }: { children: React.ReactNode }) {
  return (
    <main
      data-testid="app-shell-main"
      className="flex min-h-0 flex-1 flex-col bg-background"
    >
      <TabBar />
      <div className="flex min-h-0 flex-1 overflow-auto">{children}</div>
    </main>
  );
}
