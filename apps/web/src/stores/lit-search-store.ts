import { create } from "zustand";

// Per-tab payload for the literature-search viewer.
//
// The chat-side LitResultCard hands the user a "Open full results in editor"
// button. When clicked, we add a tab with mode='lit-search' and stash the
// result list here keyed by the new tab id. The TabModeRouter's lit-search
// branch reads this on mount; the data is purely transient (no localStorage)
// since a page refresh is expected to re-issue the search via the URL.

export interface LitPaperPayload {
  id: string;
  doi: string | null;
  arxivId: string | null;
  title: string;
  authors: string[];
  year: number | null;
  abstract: string | null;
  openAccessPdfUrl: string | null;
  citationCount: number | null;
  alreadyImported: boolean;
}

export interface LitSearchPayload {
  query: string;
  workspaceId: string;
  projectId: string | null;
  papers: LitPaperPayload[];
}

interface LitSearchState {
  byTabId: Record<string, LitSearchPayload>;
  set(tabId: string, payload: LitSearchPayload): void;
  get(tabId: string): LitSearchPayload | null;
  clear(tabId: string): void;
}

export const useLitSearchStore = create<LitSearchState>((set, get) => ({
  byTabId: {},
  set: (tabId, payload) =>
    set((s) => ({ byTabId: { ...s.byTabId, [tabId]: payload } })),
  get: (tabId) => get().byTabId[tabId] ?? null,
  clear: (tabId) =>
    set((s) => {
      if (!(tabId in s.byTabId)) return s;
      const next = { ...s.byTabId };
      delete next[tabId];
      return { byTabId: next };
    }),
}));
