"use client";
import { create } from "zustand";
import type { ViewSpec, ViewType } from "@opencairn/shared";

type Key = string;
function keyOf(projectId: string, viewType: ViewType, rootId: string | null): Key {
  return `${projectId}::${viewType}::${rootId ?? ""}`;
}

interface ViewStateStore {
  inline: Record<Key, ViewSpec>;
  setInline: (projectId: string, spec: ViewSpec) => void;
  getInline: (
    projectId: string,
    viewType: ViewType,
    rootId: string | null,
  ) => ViewSpec | null;
  clearProject: (projectId: string) => void;
}

export const useViewStateStore = create<ViewStateStore>((set, get) => ({
  inline: {},
  setInline: (projectId, spec) =>
    set((s) => ({
      inline: { ...s.inline, [keyOf(projectId, spec.viewType, spec.rootId)]: spec },
    })),
  getInline: (projectId, viewType, rootId) =>
    get().inline[keyOf(projectId, viewType, rootId)] ?? null,
  clearProject: (projectId) =>
    set((s) => {
      const next: Record<Key, ViewSpec> = {};
      for (const [k, v] of Object.entries(s.inline)) {
        if (!k.startsWith(`${projectId}::`)) next[k] = v;
      }
      return { inline: next };
    }),
}));
