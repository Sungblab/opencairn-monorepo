"use client";

// Plan 2E Phase B-4 Task 4.6 — MathInline with click-to-edit popover.
//
// Extends the Plan 2A MathInline (void inline node) with a click-to-edit
// MathEditPopover. Clicking the rendered equation opens the popover;
// saving commits a single editor.tf.setNodes op. Empty save deletes the node.

import katex from "katex";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import type { PlateElementProps } from "platejs/react";
import { useEditorRef } from "platejs/react";
import { MathEditPopover } from "./math-edit-popover";

export function MathInline({
  attributes,
  children,
  element,
}: PlateElementProps) {
  const t = useTranslations("editor.math");
  const editor = useEditorRef();
  const tex = (element as { texExpression?: string }).texExpression ?? "";
  const [open, setOpen] = useState(false);

  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, { throwOnError: true });
    } catch {
      return null;
    }
  }, [tex]);

  function handleSave(next: string) {
    const path = editor.api.findPath(element as never);
    if (!path) return;
    editor.tf.setNodes({ texExpression: next } as never, { at: path });
  }

  function handleDelete() {
    const path = editor.api.findPath(element as never);
    if (!path) return;
    editor.tf.removeNodes({ at: path });
  }

  const anchor = (
    <span
      {...attributes}
      contentEditable={false}
      className="mx-0.5 inline-block cursor-pointer"
      data-slate-void="true"
      data-math-inline
      onClick={() => setOpen(true)}
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

  return (
    <MathEditPopover
      open={open}
      onOpenChange={setOpen}
      initialTex={tex}
      onSave={handleSave}
      onDelete={handleDelete}
      anchor={anchor}
    />
  );
}
