import { renderHook, act } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useBreakpoint } from "./use-breakpoint";

function setWidth(w: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: w });
  window.dispatchEvent(new Event("resize"));
}

describe("useBreakpoint", () => {
  it("returns lg for width >= 1024", () => {
    setWidth(1280);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe("lg");
  });

  it("returns md for 768~1023", () => {
    setWidth(900);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe("md");
  });

  it("returns sm for 640~767", () => {
    setWidth(700);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe("sm");
  });

  it("returns xs for <640", () => {
    setWidth(400);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe("xs");
  });

  it("updates on window resize", () => {
    setWidth(1280);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe("lg");
    act(() => setWidth(500));
    expect(result.current).toBe("xs");
  });
});
