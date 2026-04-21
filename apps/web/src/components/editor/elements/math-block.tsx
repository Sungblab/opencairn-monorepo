"use client";

import katex from "katex";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import type { PlateElementProps } from "platejs/react";

// Void block node. See `math-inline.tsx` for the `contentEditable={false}`
// rationale. `displayMode: true` asks KaTeX to render centered block math.
export function MathBlock({
  attributes,
  children,
  element,
}: PlateElementProps) {
  const t = useTranslations("editor.math");
  const tex = (element as { texExpression?: string }).texExpression ?? "";
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, {
        displayMode: true,
        throwOnError: true,
      });
    } catch {
      return null;
    }
  }, [tex]);

  return (
    <div
      {...attributes}
      contentEditable={false}
      className="my-3"
      data-slate-void="true"
    >
      <div
        className={`rounded border p-3 ${
          html ? "border-border" : "border-red-600"
        }`}
      >
        {html ? (
          <span dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <span className="text-sm text-red-600">
            {`${t("parse_error")}: $${tex}$`}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}
