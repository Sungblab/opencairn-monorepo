"use client";
import { createContext, useContext } from "react";
import type { TreeNode } from "@/hooks/use-project-tree";

// Shared state bag handed down from <ProjectTree> to row renderers without
// running the arborist row prop plumbing. react-arborist renders rows via
// a children-as-component prop whose signature we can't extend, so any
// per-tree state lives here instead.
export interface ProjectTreeCtxValue {
  renamingId: string | null;
  onStartRename(id: string): void;
  onCommitRename(
    id: string,
    kind: TreeNode["kind"],
    newLabel: string | null,
  ): void;
  onDelete(id: string, kind: TreeNode["kind"], label: string): void;
}

export const ProjectTreeContext = createContext<ProjectTreeCtxValue | null>(
  null,
);

export function useProjectTreeCtx(): ProjectTreeCtxValue {
  const ctx = useContext(ProjectTreeContext);
  if (!ctx) {
    throw new Error("ProjectTreeNode must be rendered inside <ProjectTree>");
  }
  return ctx;
}
