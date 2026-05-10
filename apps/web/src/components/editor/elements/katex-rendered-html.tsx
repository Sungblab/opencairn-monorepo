"use client";

import katex from "katex";
import { useMemo } from "react";

export interface KatexRenderedHtmlProps {
  tex: string;
  displayMode?: boolean;
  block?: boolean;
  className?: string;
  errorClassName?: string;
  errorText?: string;
  errorTitle?: string;
}

export function KatexRenderedHtml({
  tex,
  displayMode = false,
  block = false,
  className,
  errorClassName,
  errorText,
  errorTitle,
}: KatexRenderedHtmlProps) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, {
        displayMode,
        throwOnError: true,
      });
    } catch {
      return null;
    }
  }, [displayMode, tex]);

  const Tag = block ? "div" : "span";

  if (html === null) {
    return (
      <Tag className={errorClassName} title={errorTitle}>
        {errorText ?? `$${tex}$`}
      </Tag>
    );
  }

  return (
    <Tag
      className={className}
      // KaTeX output is sanitized; renderToString does not execute scripts.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
