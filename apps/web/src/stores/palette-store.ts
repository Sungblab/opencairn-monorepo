import { create } from "zustand";

// Session-only — the palette is ephemeral, persisting it would just resurface
// stale queries on reload. Phase 5 wires this to cmdk; Phase 1 keeps the
// open/close shape stable so the keyboard shortcut in Task 11 has somewhere
// to dispatch into.
interface State {
  isOpen: boolean;
  query: string;
  open(): void;
  close(): void;
  setQuery(q: string): void;
}

export const usePaletteStore = create<State>((set) => ({
  isOpen: false,
  query: "",
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false, query: "" }),
  setQuery: (q) => set({ query: q }),
}));
