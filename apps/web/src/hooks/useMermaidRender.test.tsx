import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { mermaidThemeFor, useMermaidRender } from "./useMermaidRender";

const initialize = vi.fn();
const render = vi.fn(async (id: string, _code: string) => ({
  svg: `<svg data-id="${id}"/>`,
}));

vi.mock("mermaid", () => ({
  default: {
    initialize: (...args: unknown[]) => initialize(...args),
    render: (...args: unknown[]) => render(...(args as [string, string])),
  },
}));

describe("mermaidThemeFor", () => {
  it("maps cairn-dark to dark", () => {
    expect(mermaidThemeFor("cairn-dark")).toBe("dark");
  });
  it("maps high-contrast to neutral", () => {
    expect(mermaidThemeFor("high-contrast")).toBe("neutral");
  });
  it("maps cairn-light to default", () => {
    expect(mermaidThemeFor("cairn-light")).toBe("default");
  });
  it("maps sepia to default", () => {
    expect(mermaidThemeFor("sepia")).toBe("default");
  });
  it("maps undefined to default", () => {
    expect(mermaidThemeFor(undefined)).toBe("default");
  });
});

describe("useMermaidRender", () => {
  beforeEach(() => {
    initialize.mockClear();
    render.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-initializes mermaid with the new theme on theme change", async () => {
    const { rerender, result } = renderHook(
      ({ code, theme }: { code: string; theme: "default" | "dark" | "neutral" }) =>
        useMermaidRender(code, theme),
      {
        initialProps: { code: "graph TD\nA --> B", theme: "default" as const },
      },
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.svg).toBeTruthy();
    });

    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({ theme: "default" }),
    );
    const renderCallsBefore = render.mock.calls.length;

    rerender({ code: "graph TD\nA --> B", theme: "dark" });

    await waitFor(() => {
      expect(initialize).toHaveBeenCalledWith(
        expect.objectContaining({ theme: "dark" }),
      );
    });
    expect(render.mock.calls.length).toBeGreaterThan(renderCallsBefore);
  });

  it("returns loading=false with svg=null for empty code", async () => {
    const { result } = renderHook(() => useMermaidRender(""));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.svg).toBeNull();
    expect(render).not.toHaveBeenCalled();
  });
});
