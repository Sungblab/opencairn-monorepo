"use client";
import { useTabsStore } from "@/stores/tabs-store";
import type { ViewNode } from "@opencairn/shared";

/**
 * One card in the `?view=cards` grid. Clicking opens the concept's first
 * source note as a *preview tab* (italic, single-slot) — same UX contract as
 * graph node single-click in Phase 1's GraphView. Disabled when the concept
 * has no source notes.
 */
export function ConceptCard({ node }: { node: ViewNode }) {
  const addOrReplacePreview = useTabsStore((s) => s.addOrReplacePreview);
  function open() {
    if (!node.firstNoteId) return;
    addOrReplacePreview({
      id: crypto.randomUUID(),
      kind: "note",
      targetId: node.firstNoteId,
      mode: "plate",
      title: node.name,
      pinned: false,
      preview: true,
      dirty: false,
      splitWith: null,
      splitSide: null,
      scrollY: 0,
    });
  }
  return (
    <button
      type="button"
      onClick={open}
      disabled={!node.firstNoteId}
      className="flex flex-col items-start gap-2 rounded-lg border bg-card p-4 text-left hover:bg-accent disabled:opacity-50"
    >
      <span className="text-sm font-medium">{node.name}</span>
      {node.description && (
        <span className="line-clamp-3 text-xs text-muted-foreground">
          {node.description}
        </span>
      )}
      {typeof node.degree === "number" && (
        <span className="text-xs text-muted-foreground">
          {`\u{1F517} ${node.degree}`}
        </span>
      )}
    </button>
  );
}
