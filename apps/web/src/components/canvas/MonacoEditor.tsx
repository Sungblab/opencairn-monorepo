"use client";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import type { CanvasLanguage } from "@opencairn/shared";
import { useTheme } from "@/lib/theme/provider";

// Monaco ships its own webworker + DOM-mutating editor; never SSR.
// Loading is deferred so the canvas-viewer chunk stays small until the
// editor pane actually mounts.
const Monaco = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => null,
});

// CanvasLanguage→Monaco language mapping. Monaco doesn't ship a "react"
// grammar; JSX is highlighted under the javascript/typescript tokenizer.
const LANG_MAP: Record<CanvasLanguage, "python" | "javascript" | "html"> = {
  python: "python",
  javascript: "javascript",
  react: "javascript",
  html: "html",
};

// Project themes (`cairn-light | cairn-dark | sepia | high-contrast`) need
// to be folded into Monaco's two built-in themes (`vs-dark` / `light`).
// `cairn-dark` and `high-contrast` map to dark; the rest stay light.
const DARK_THEMES = new Set(["cairn-dark", "high-contrast"]);

export function MonacoEditor(props: {
  language: CanvasLanguage;
  value: string;
  onChange: (v: string) => void;
}) {
  const t = useTranslations("canvas");
  const { theme } = useTheme();
  const monacoTheme = DARK_THEMES.has(theme) ? "vs-dark" : "light";
  return (
    <Monaco
      height="100%"
      theme={monacoTheme}
      language={LANG_MAP[props.language]}
      value={props.value}
      onChange={(v) => props.onChange(v ?? "")}
      options={{
        minimap: { enabled: false },
        fontSize: 13,
        tabSize: 2,
        wordWrap: "on",
        fixedOverflowWidgets: true,
        scrollBeyondLastLine: false,
      }}
      loading={<div className="text-xs p-2">{t("monaco.loading")}</div>}
    />
  );
}
