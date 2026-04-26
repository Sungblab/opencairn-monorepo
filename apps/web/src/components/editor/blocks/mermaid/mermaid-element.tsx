"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { PlateElementProps } from "platejs/react";
import { useMermaidRender } from "@/hooks/useMermaidRender";
import { proseClasses } from "@/lib/markdown/shared-prose";

interface MermaidElementProps extends Omit<PlateElementProps, "element"> {
  element: PlateElementProps["element"] & {
    type: "mermaid";
    code: string;
    children: [{ text: "" }];
  };
}

export function MermaidElement({
  attributes,
  children,
  element,
}: MermaidElementProps) {
  const t = useTranslations("editor.blocks.mermaid");
  const [showSource, setShowSource] = useState(false);
  const { svg, error, loading } = useMermaidRender(element.code);

  return (
    <div
      {...attributes}
      contentEditable={false}
      className="my-2 group relative"
      data-testid="mermaid-block"
    >
      {/* Slate requires void elements to render `children` for selection. */}
      <span style={{ display: "none" }}>{children}</span>

      {error ? (
        <div
          className="rounded border border-red-400 bg-red-50 p-3 text-sm dark:bg-red-950/30"
          data-testid="mermaid-error"
        >
          <div className="font-medium text-red-700 dark:text-red-300">
            {t("error_title")}
          </div>
          <div className="mt-1 text-xs text-red-600 dark:text-red-400">
            {t("error_help")}
          </div>
          <pre className="mt-2 overflow-x-auto text-xs">
            <code>{element.code}</code>
          </pre>
        </div>
      ) : loading ? (
        <div className={proseClasses.mermaidContainer}>
          <span className="text-xs text-[color:var(--fg-muted)]">…</span>
        </div>
      ) : (
        <div
          className={proseClasses.mermaidContainer}
          dangerouslySetInnerHTML={{ __html: svg ?? "" }}
        />
      )}

      <button
        type="button"
        onClick={() => setShowSource((v) => !v)}
        className="absolute right-1 top-1 rounded bg-[color:var(--bg-base)] px-2 py-0.5 text-xs opacity-0 group-hover:opacity-100"
        data-testid="mermaid-toggle-source"
      >
        {showSource ? t("hide_source") : t("show_source")}
      </button>

      {showSource && (
        <pre className="mt-2 overflow-x-auto rounded bg-[color:var(--bg-muted)] p-2 text-xs">
          <code>{element.code}</code>
        </pre>
      )}
    </div>
  );
}
