"use client";

// Plan 2E Phase B-2 — Plate v49 plugin registration for the image void block.
// Custom plugin (not @platejs/media) — see spec § 3.2.

import { createPlatePlugin } from "platejs/react";
import { ImageElement } from "./image-element";

export const imagePlugin = createPlatePlugin({
  key: "image",
  node: { isElement: true, isVoid: true, type: "image" },
}).withComponent(ImageElement);
