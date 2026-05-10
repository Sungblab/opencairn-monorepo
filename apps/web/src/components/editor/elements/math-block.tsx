"use client";

// Plan 2E Phase B-4 Task 4.6 — MathBlock with click-to-edit popover.
//
// Extends the Plan 2A MathBlock (void block node) with a click-to-edit
// MathEditPopover. Clicking the rendered block opens the popover;
// saving commits a single editor.tf.setNodes op. Empty save deletes the node.

import { useTranslations } from "next-intl";
import { useState } from "react";
import type { PlateElementProps } from "platejs/react";
import { useEditorRef } from "platejs/react";
import { KatexRendererLoader } from "./katex-renderer-loader";
import { MathEditPopover } from "./math-edit-popover";

export function MathBlock({
  attributes,
  children,
  element,
}: PlateElementProps) {
  const t = useTranslations("editor.math");
  const editor = useEditorRef();
  const tex = (element as { texExpression?: string }).texExpression ?? "";
  const [open, setOpen] = useState(false);

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
    <div
      {...attributes}
      contentEditable={false}
      className="my-3 cursor-pointer"
      data-slate-void="true"
      data-math-block
      onClick={() => setOpen(true)}
    >
      <KatexRendererLoader
        tex={tex}
        displayMode
        block
        className="rounded border border-border p-3"
        errorClassName="rounded border border-red-600 p-3 text-sm text-red-600"
        errorText={`${t("parse_error")}: $${tex}$`}
      />
      {children}
    </div>
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
