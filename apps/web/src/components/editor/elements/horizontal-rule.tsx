"use client";

import type { PlateElementProps } from "platejs/react";

export function HorizontalRuleElement({
  attributes,
  children,
}: PlateElementProps) {
  return (
    <div
      {...attributes}
      contentEditable={false}
      className="my-6"
      data-slate-void="true"
      data-horizontal-rule
    >
      <hr className="border-border" />
      {children}
    </div>
  );
}
