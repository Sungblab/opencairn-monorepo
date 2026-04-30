"use client";

import type { PlateElementProps } from "platejs/react";
import { useState, useMemo } from "react";
import { useEditorRef } from "platejs/react";
import { ColumnResizeHandle } from "./column-resize-handle";

interface TColumnGroup {
  type: "column_group";
  widths?: number[];
  children: unknown[];
}

function defaultEqualWidths(n: number): number[] {
  return Array(n).fill(1 / n);
}

function normalize(widths: number[]): number[] {
  const sum = widths.reduce((a, b) => a + b, 0);
  if (sum === 0) return defaultEqualWidths(widths.length);
  return widths.map((w) => w / sum);
}

export function ColumnGroupElement({
  attributes,
  children,
  element,
}: PlateElementProps) {
  const editor = useEditorRef();
  const node = element as unknown as TColumnGroup;
  const n = Array.isArray(node.children) ? node.children.length : 0;

  const persistedWidths = useMemo(
    () =>
      node.widths && node.widths.length === n
        ? normalize(node.widths)
        : defaultEqualWidths(n),
    [node.widths, n],
  );

  const [localWidths, setLocalWidths] = useState<number[] | null>(null);
  const widths = localWidths ?? persistedWidths;

  function commitWidths(next: number[]) {
    const path = editor.api.findPath(element as never);
    if (!path) return;
    editor.tf.setNodes({ widths: next } as never, { at: path });
    setLocalWidths(null);
  }

  function resetEqual() {
    commitWidths(defaultEqualWidths(n));
  }

  /**
   * `leftPct` is the absolute position (0–100) of the separator from the
   * left edge of the column_group container. This maps directly to the
   * cumulative width of all columns to the left of the separator.
   *
   * Only the two adjacent columns (handleIdx and handleIdx+1) are adjusted;
   * all others remain unchanged.
   */
  function computeNextWidths(
    base: number[],
    handleIdx: number,
    leftPct: number,
  ): number[] {
    // cumulative width of columns before the left column of this pair
    const cumBefore = base.slice(0, handleIdx).reduce((a, b) => a + b, 0);
    const pairTotal = base[handleIdx] + base[handleIdx + 1];
    const newLeft = Math.max(
      0.10,
      Math.min(pairTotal - 0.10, leftPct / 100 - cumBefore),
    );
    const next = [...base];
    next[handleIdx] = newLeft;
    next[handleIdx + 1] = pairTotal - newLeft;
    return next;
  }

  function onResize(handleIdx: number, leftPct: number) {
    setLocalWidths(computeNextWidths(persistedWidths, handleIdx, leftPct));
  }

  function onCommit(handleIdx: number, leftPct: number) {
    commitWidths(computeNextWidths(persistedWidths, handleIdx, leftPct));
  }

  // Render: wrap each column child in a flex-basis div, insert handles between.
  // `children` is the Plate-rendered ReactNode array for the group's child nodes.
  const childArr = Array.isArray(children) ? children : [children];

  return (
    <div {...attributes} className="my-2 flex w-full">
      {childArr.map((child, i) => {
        const w = widths[i] ?? 1 / n;
        // Cumulative position from left to the RIGHT edge of column[i] — this
        // is where the separator handle sits (0–100).
        const handleAbsolutePct =
          widths.slice(0, i + 1).reduce((a, b) => a + b, 0) * 100;
        return (
          <div key={`col-wrap-${i}`} className="contents">
            <div
              key={`col-${i}`}
              style={{
                flexBasis: `${w * 100}%`,
                flexGrow: 0,
                flexShrink: 0,
                minWidth: 0,
              }}
            >
              {child}
            </div>
            {i < n - 1 && (
              <ColumnResizeHandle
                key={`sep-${i}`}
                leftWidthPct={handleAbsolutePct}
                onResize={(pct) => onResize(i, pct)}
                onCommit={(pct) => onCommit(i, pct)}
                onReset={resetEqual}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
