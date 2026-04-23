"use client";
import { useCallback, useRef } from "react";

interface Props {
  onDrag(delta: number): void;
  onReset(): void;
  orientation?: "vertical";
  className?: string;
}

// Mouse-driven resize: deltas are forwarded as relative pixel changes so
// the consumer can clamp via the panel-store setters (which already enforce
// min/max). Double-click resets — matches what every IDE-style sidebar
// already trains users to expect.
export function ShellResizeHandle({
  onDrag,
  onReset,
  className = "",
}: Props) {
  const startX = useRef(0);
  const dragging = useRef(false);

  const onMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = e.clientX - startX.current;
      startX.current = e.clientX;
      onDrag(delta);
    },
    [onDrag],
  );

  const stop = useCallback(() => {
    dragging.current = false;
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", stop);
  }, [onMouseMove]);

  const onMouseDown = (e: React.MouseEvent) => {
    dragging.current = true;
    startX.current = e.clientX;
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", stop);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      className={`w-1 cursor-col-resize bg-border hover:bg-primary/40 ${className}`}
      onMouseDown={onMouseDown}
      onDoubleClick={onReset}
      data-testid="shell-resize-handle"
    />
  );
}
