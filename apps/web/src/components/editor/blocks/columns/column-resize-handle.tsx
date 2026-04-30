"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";

const MIN = 10;
const MAX = 90;

export interface ColumnResizeHandleProps {
  /** Left column width percentage (0-100). */
  leftWidthPct: number;
  /** Called during drag with the new pct (display only — local state). */
  onResize: (pct: number) => void;
  /** Called on pointerup or keyboard commit with the final pct. */
  onCommit: (pct: number) => void;
  /** Called on double-click or Home key. */
  onReset: () => void;
}

function clamp(v: number) {
  return Math.max(MIN, Math.min(MAX, v));
}

export function ColumnResizeHandle({
  leftWidthPct,
  onResize,
  onCommit,
  onReset,
}: ColumnResizeHandleProps) {
  const t = useTranslations("editor.columns.resize");
  const dragging = useRef(false);
  const lastPct = useRef(leftWidthPct);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // setPointerCapture may be absent in jsdom — guard defensively
    if (e.currentTarget.setPointerCapture) {
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    dragging.current = true;
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    const parent = e.currentTarget.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    if (rect.width === 0) return;
    const pct = clamp(((e.clientX - rect.left) / rect.width) * 100);
    lastPct.current = pct;
    requestAnimationFrame(() => onResize(pct));
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    if (e.currentTarget.releasePointerCapture) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragging.current = false;
    onCommit(lastPct.current);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 1 : 5;
    let next = leftWidthPct;
    switch (e.key) {
      case "ArrowLeft":
        next = clamp(leftWidthPct - step);
        break;
      case "ArrowRight":
        next = clamp(leftWidthPct + step);
        break;
      case "Home":
        onReset();
        return;
      default:
        return;
    }
    e.preventDefault();
    if (next !== leftWidthPct) onCommit(next);
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t("aria")}
      aria-valuenow={Math.round(leftWidthPct)}
      aria-valuemin={MIN}
      aria-valuemax={MAX}
      tabIndex={0}
      className="group relative w-2 cursor-col-resize select-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDoubleClick={onReset}
      onKeyDown={handleKeyDown}
    >
      <div className="absolute inset-y-2 left-1/2 w-px -translate-x-1/2 bg-border opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
    </div>
  );
}
