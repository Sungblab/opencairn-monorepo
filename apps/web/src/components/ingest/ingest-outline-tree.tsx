"use client";
import type { OutlineNode } from "@/stores/ingest-store";

export function IngestOutlineTree({ nodes }: { nodes: OutlineNode[] }) {
  if (nodes.length === 0) return null;
  return (
    <ul className="ingest-outline-list">
      {nodes.map((n) => (
        <li key={n.id} style={{ paddingLeft: `${(n.level - 1) * 12}px` }}>
          {n.title}
        </li>
      ))}
    </ul>
  );
}
