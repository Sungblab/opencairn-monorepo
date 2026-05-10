"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import type { ViewType } from "@opencairn/shared";
import { ViewSwitcher } from "./ViewSwitcher";
import { ViewRenderer } from "./ViewRenderer";
import type { VisualizeDialogProps } from "./ai/VisualizeDialog";

export interface ProjectGraphProps {
  projectId: string;
}

const VIEW_BY_KEY: Record<string, ViewType> = {
  "1": "graph",
  "2": "mindmap",
  "3": "cards",
  "4": "timeline",
  "5": "board",
};

const LazyVisualizeDialog = dynamic<VisualizeDialogProps>(
  () => import("./ai/VisualizeDialog").then((mod) => mod.VisualizeDialog),
  { ssr: false },
);

export function ProjectGraph({ projectId }: ProjectGraphProps) {
  const [aiOpen, setAiOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Check both event.target and the active element so we still ignore
      // keys when an input is focused even if the event was dispatched on
      // the window (real browsers route to the focused element; tests don't).
      const candidates: Array<HTMLElement | null> = [
        e.target as HTMLElement | null,
        typeof document !== "undefined"
          ? (document.activeElement as HTMLElement | null)
          : null,
      ];
      for (const el of candidates) {
        const tag = el?.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea" || el?.isContentEditable) {
          return;
        }
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const view = VIEW_BY_KEY[e.key];
      if (!view) return;
      const next = new URLSearchParams(params.toString());
      next.set("view", view);
      if (view !== "mindmap" && view !== "board") next.delete("root");
      router.replace(`?${next.toString()}`, { scroll: false });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, params]);

  return (
    <div
      data-testid="project-graph-viewer"
      data-hydrated={hydrated ? "true" : "false"}
      className="flex h-full flex-col"
    >
      <ViewSwitcher onAiClick={() => setAiOpen(true)} />
      <div className="min-h-0 flex-1">
        <ViewRenderer projectId={projectId} />
      </div>
      {aiOpen ? (
        <LazyVisualizeDialog
          open={aiOpen}
          onClose={() => setAiOpen(false)}
          projectId={projectId}
        />
      ) : null}
    </div>
  );
}
