"use client";

// Plan 2E Phase B-4 Task 4.6 — MathBlock with click-to-edit popover.
//
// Extends the Plan 2A MathBlock (void block node) with a click-to-edit
// MathEditPopover. Clicking the rendered block opens the popover;
// saving commits a single editor.tf.setNodes op. Empty save deletes the node.

import katex from "katex";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import type { PlateElementProps } from "platejs/react";
import { useEditorRef } from "platejs/react";
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
