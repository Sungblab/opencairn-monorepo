"use client";

import dynamic from "next/dynamic";
import type { KatexRenderedHtmlProps } from "./katex-rendered-html";

const LazyKatexRenderedHtml = dynamic<KatexRenderedHtmlProps>(
  () => import("./katex-rendered-html").then((mod) => mod.KatexRenderedHtml),
  { ssr: false, loading: () => null },
);

export function KatexRendererLoader(props: KatexRenderedHtmlProps) {
  return <LazyKatexRenderedHtml {...props} />;
}
