"use client";
import { createPlatePlugin } from "platejs/react";
import { CalloutElement } from "./callout-element";

// Plan 2D — Callout block (info / warn / tip / danger).
// Element shape: { type: 'callout', kind: CalloutKind, children: [...] }
export const CalloutPlugin = createPlatePlugin({
  key: "callout",
  node: { isElement: true, type: "callout" },
}).withComponent(CalloutElement);
