"use client";
import { createPlatePlugin } from "platejs/react";
import { MermaidElement } from "./mermaid-element";

// Plan 2D — Mermaid void block.
//
// Element shape: { type: 'mermaid', code: string, children: [{ text: '' }] }
//
// Insert via `editor.tf.insertNodes({ type: 'mermaid', code: '', children: [{ text: '' }] })`
// from the slash menu (Task 14) or the markdown fence autoformat (Task 15).
export const MermaidPlugin = createPlatePlugin({
  key: "mermaid",
  node: { isElement: true, isVoid: true, type: "mermaid" },
}).withComponent(MermaidElement);
