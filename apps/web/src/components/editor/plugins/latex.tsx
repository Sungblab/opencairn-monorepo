"use client";

import "katex/dist/katex.min.css";

import { createPlatePlugin } from "platejs/react";

import { MathBlock } from "../elements/math-block";
import { MathInline } from "../elements/math-inline";

const EquationPlugin = createPlatePlugin({
  key: "equation",
  node: { isElement: true, isVoid: true, type: "equation" },
}).withComponent(MathBlock);

const InlineEquationPlugin = createPlatePlugin({
  key: "inline_equation",
  node: {
    isElement: true,
    isInline: true,
    isVoid: true,
    type: "inline_equation",
  },
}).withComponent(MathInline);

// Lightweight local math nodes. The slash/math-trigger code inserts the
// `equation` and `inline_equation` nodes directly, so the upstream math React
// entry would only add unused KaTeX runtime code to the initial editor bundle.
export const latexPlugins = [
  EquationPlugin,
  InlineEquationPlugin,
];
