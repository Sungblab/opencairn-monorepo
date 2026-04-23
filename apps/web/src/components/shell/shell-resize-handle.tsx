"use client";
import { useCallback, useEffect, useRef } from "react";

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
//
// `onDrag` is closed over by the parent on every render (it captures the
// CURRENT panel width). The window-level `mousemove` listener is registered
// once on mousedown, so without an indirection we'd be stuck calling the
// initial `onDrag` for the entire drag — which means every mousemove uses
// the starting width instead of the latest, and the resize stalls at the
// first delta. Holding onDrag in a ref that we update on every render lets
// the listener always invoke the latest version without re-binding.
export function ShellResizeHandle({
  onDrag,
  onReset,
  className = "",
}: Props) {
  const startX = useRef(0);
  const dragging = useRef(false);
  const onDragRef = useRef(onDrag);
  onDragRef.current = onDrag;

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging.current) return;
    const delta = e.clientX - startX.current;
    startX.current = e.clientX;
    onDragRef.current(delta);
  }, []);

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

  // Defensive cleanup: if the handle unmounts mid-drag (panel collapsed via
  // shortcut while user holds the mouse), tear down the window listeners
  // so we don't leak them or fire `onDrag` after the parent unmounts.
  useEffect(() => {
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", stop);
    };
  }, [onMouseMove, stop]);

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
