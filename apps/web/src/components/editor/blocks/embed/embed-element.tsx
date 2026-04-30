"use client";

// Plan 2E Phase B — embed void block element renderer.
// Renders a sandboxed iframe inside an aspect-video container.
// The `embedUrl` field is NEVER user-supplied — it is computed by
// `toEmbedUrl()` on insertion and stored in the Plate node.

import type { PlateElementProps } from "platejs/react";

interface TEmbedElement {
  type: "embed";
  provider: "youtube" | "vimeo" | "loom";
  url: string;
  embedUrl: string;
}

export function EmbedElement({ attributes, children, element }: PlateElementProps) {
  const node = element as unknown as TEmbedElement;
  return (
    <div
      {...attributes}
      contentEditable={false}
      data-slate-void="true"
      className="my-4 aspect-video w-full"
    >
      <iframe
        src={node.embedUrl}
        title={`${node.provider} embed`}
        sandbox="allow-scripts allow-same-origin allow-presentation"
        allow="autoplay; fullscreen; picture-in-picture"
        referrerPolicy="strict-origin-when-cross-origin"
        loading="lazy"
        className="h-full w-full rounded-md border-0"
      />
      {/* Slate requires void elements to render `children` for selection. */}
      <span style={{ display: "none" }}>{children}</span>
    </div>
  );
}
