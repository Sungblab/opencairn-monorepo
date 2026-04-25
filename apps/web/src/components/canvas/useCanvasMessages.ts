"use client";
import { useEffect, useRef, type RefObject } from "react";

// Discriminated union of every message kind the iframe is allowed to post.
// Anything else is ignored. CANVAS_RESIZE is reserved for Phase 2 height
// auto-grow; Phase 1 only emits READY/ERROR but the type pins the surface.
export type CanvasMessage =
  | { type: "CANVAS_READY" }
  | { type: "CANVAS_ERROR"; error: string }
  | { type: "CANVAS_RESIZE"; height: number };

/**
 * Blob URL iframes always report `event.origin === "null"`.
 * We additionally compare `event.source` to the iframe's contentWindow so a
 * sibling tab posting from `origin: null` (e.g. a malicious data: URL window)
 * cannot impersonate our sandbox.
 *
 * Caller must ensure `iframeRef.current` is mounted before any message is
 * expected; otherwise messages are silently dropped (the source check fails).
 */
export function useCanvasMessages(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  onMessage: (m: CanvasMessage) => void,
): void {
  // Latest-callback ref pattern so the listener doesn't re-bind on every
  // render (caller doesn't need to memoize onMessage).
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  useEffect(() => {
    function listener(event: MessageEvent) {
      if (event.origin !== "null") return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      handlerRef.current(event.data as CanvasMessage);
    }
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [iframeRef]);
}
