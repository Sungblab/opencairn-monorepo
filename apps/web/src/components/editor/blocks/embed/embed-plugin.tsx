"use client";

// Plan 2E Phase B — Plate v49 plugin registration for the embed void block.
// Mirrors the mermaid plugin pattern (createPlatePlugin from platejs/react,
// single void element, custom React component renderer).

import { createPlatePlugin } from "platejs/react";
import { EmbedElement } from "./embed-element";

export const embedPlugin = createPlatePlugin({
  key: "embed",
  node: { isElement: true, isVoid: true, type: "embed" },
}).withComponent(EmbedElement);
