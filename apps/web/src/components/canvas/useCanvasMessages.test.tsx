import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRef } from "react";
import { useCanvasMessages, type CanvasMessage } from "./useCanvasMessages";

function makeMessageEvent(
  data: CanvasMessage,
  origin: string,
  source: Window | null,
): MessageEvent {
  return new MessageEvent("message", { data, origin, source } as any);
}

describe("useCanvasMessages", () => {
  it("calls callback when origin is 'null' AND source is the iframe contentWindow", () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const onMsg = vi.fn();

    renderHook(() => {
      const ref = useRef<HTMLIFrameElement>(iframe);
      return useCanvasMessages(ref, onMsg);
    });

    act(() => {
      window.dispatchEvent(
        makeMessageEvent({ type: "CANVAS_READY" }, "null", iframe.contentWindow),
      );
    });

    expect(onMsg).toHaveBeenCalledWith({ type: "CANVAS_READY" });
  });

  it("ignores messages whose origin is not 'null'", () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const onMsg = vi.fn();

    renderHook(() => {
      const ref = useRef<HTMLIFrameElement>(iframe);
      return useCanvasMessages(ref, onMsg);
    });

    act(() => {
      window.dispatchEvent(
        makeMessageEvent({ type: "CANVAS_READY" }, "https://evil.com", iframe.contentWindow),
      );
    });

    expect(onMsg).not.toHaveBeenCalled();
  });

  it("ignores messages whose source is not the iframe contentWindow", () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const onMsg = vi.fn();

    renderHook(() => {
      const ref = useRef<HTMLIFrameElement>(iframe);
      return useCanvasMessages(ref, onMsg);
    });

    act(() => {
      window.dispatchEvent(
        makeMessageEvent({ type: "CANVAS_READY" }, "null", window /* not iframe */),
      );
    });

    expect(onMsg).not.toHaveBeenCalled();
  });
});
