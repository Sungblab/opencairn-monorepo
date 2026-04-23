import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useKeyboardShortcut } from "./use-keyboard-shortcut";

function dispatchKey(opts: {
  key: string;
  meta?: boolean;
  ctrl?: boolean;
  shift?: boolean;
}) {
  const ev = new KeyboardEvent("keydown", {
    key: opts.key,
    metaKey: !!opts.meta,
    ctrlKey: !!opts.ctrl,
    shiftKey: !!opts.shift,
    bubbles: true,
  });
  window.dispatchEvent(ev);
}

describe("useKeyboardShortcut", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      value: "MacIntel",
    });
  });

  it("invokes handler on mod+\\ (mac: meta key)", () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcut("mod+\\", handler));
    dispatchKey({ key: "\\", meta: true });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("uses Ctrl on non-mac", () => {
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      value: "Win32",
    });
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcut("mod+j", handler));
    dispatchKey({ key: "j", ctrl: true });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("respects shift modifier", () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcut("mod+shift+\\", handler));
    dispatchKey({ key: "\\", meta: true });
    expect(handler).not.toHaveBeenCalled();
    dispatchKey({ key: "\\", meta: true, shift: true });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("does not fire without modifier", () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcut("mod+j", handler));
    dispatchKey({ key: "j" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("unsubscribes on unmount", () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() =>
      useKeyboardShortcut("mod+j", handler),
    );
    unmount();
    dispatchKey({ key: "j", meta: true });
    expect(handler).not.toHaveBeenCalled();
  });
});
