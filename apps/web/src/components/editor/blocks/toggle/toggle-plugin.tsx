"use client";
import { createPlatePlugin } from "platejs/react";
import { ToggleElement } from "./toggle-element";

export const TogglePlugin = createPlatePlugin({
  key: "toggle",
  node: { isElement: true, type: "toggle" },
}).withComponent(ToggleElement);
