"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ViewType } from "@opencairn/shared";
import { ViewSwitcher } from "./ViewSwitcher";
import { ViewRenderer } from "./ViewRenderer";
import { VisualizeDialog } from "./ai/VisualizeDialog";

interface Props {
  projectId: string;
}

const VIEW_BY_KEY: Record<string, ViewType> = {
  "1": "graph",
  "2": "mindmap",
  "3": "cards",
  "4": "timeline",
  "5": "board",
};

export function ProjectGraph({ projectId }: Props) {
  const [aiOpen, setAiOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

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
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, pathname, params]);

  return (
    <div data-testid="project-graph-viewer" className="flex h-full flex-col">
      <ViewSwitcher onAiClick={() => setAiOpen(true)} />
      <div className="min-h-0 flex-1">
        <ViewRenderer projectId={projectId} />
      </div>
      <VisualizeDialog
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        projectId={projectId}
      />
    </div>
  );
}
