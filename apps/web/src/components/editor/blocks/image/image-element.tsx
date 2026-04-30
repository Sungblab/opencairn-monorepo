"use client";

// Plan 2E Phase B-2 — Image void block element renderer.
// Renders as <figure><img /><figcaption /></figure>.
// Caption is hidden when the `caption` field is absent.
// Alt defaults to "" (decorative) when not provided — jsx-a11y is satisfied.

import type { PlateElementProps } from "platejs/react";

interface TImageElement {
  type: "image";
  url: string;
  alt?: string;
  caption?: string;
  width?: number;
}

export function ImageElement({ attributes, children, element }: PlateElementProps) {
  const node = element as unknown as TImageElement;
  return (
    <figure
      {...attributes}
      contentEditable={false}
      data-slate-void="true"
      className="my-4"
    >
      <img
        src={node.url}
        alt={node.alt ?? ""}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        style={node.width ? { width: `${node.width * 100}%` } : undefined}
        className="rounded-md max-w-full h-auto"
      />
      {node.caption && (
        <figcaption className="text-sm text-muted-foreground mt-1">
          {node.caption}
        </figcaption>
      )}
      {children}
    </figure>
  );
}
