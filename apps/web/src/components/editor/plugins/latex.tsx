"use client";

// `@platejs/math` transitively imports `katex/dist/katex.min.css` at module
// load, but Next.js 16 + Turbopack occasionally drops the CSS when the plugin
// is only referenced via a re-export. Importing the stylesheet explicitly here
// guarantees the bundler picks it up.
import "katex/dist/katex.min.css";

import { EquationPlugin, InlineEquationPlugin } from "@platejs/math/react";

import { MathBlock } from "../elements/math-block";
import { MathInline } from "../elements/math-inline";

// Plate v49: attach custom renderers via `.withComponent()`. Both plugins are
// void nodes — insertion flows through `editor.tf.insert.equation()` and
// `editor.tf.insert.inlineEquation(tex)` (wired up in Task 17 via slash `/math`).
// There is no `$...$` autoformat in @platejs/math v49.
export const latexPlugins = [
  EquationPlugin.withComponent(MathBlock),
  InlineEquationPlugin.withComponent(MathInline),
];
