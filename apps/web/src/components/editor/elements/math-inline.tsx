"use client";

import katex from "katex";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import type { PlateElementProps } from "platejs/react";

// Void inline node. `children` is a zero-width placeholder that Slate uses for
// selection bookkeeping; wrap the rendered equation in `contentEditable={false}`
// so user input never lands inside the rendered span.
export function MathInline({
  attributes,
  children,
  element,
}: PlateElementProps) {
  const t = useTranslations("editor.math");
  const tex = (element as { texExpression?: string }).texExpression ?? "";
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, { throwOnError: true });
    } catch {
      return null;
    }
  }, [tex]);

  return (
    <span
      {...attributes}
      contentEditable={false}
      className="mx-0.5 inline-block"
      data-slate-void="true"
    >
      {html ? (
        <span dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <span className="text-xs text-red-600" title={t("parse_error")}>
          {`$${tex}$`}
        </span>
      )}
      {children}
    </span>
  );
}
