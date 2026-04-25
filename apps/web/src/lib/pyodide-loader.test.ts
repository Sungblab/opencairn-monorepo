// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";

describe("pyodide-loader", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    // @ts-expect-error window.loadPyodide is augmented globally
    delete window.loadPyodide;
    vi.resetModules();
  });

  it("PYODIDE_VERSION is dotted-numeric (no floating tags)", async () => {
    const { PYODIDE_VERSION } = await import("./pyodide-loader");
    expect(PYODIDE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("PYODIDE_CDN URL embeds PYODIDE_VERSION (not 'latest')", async () => {
    const { PYODIDE_VERSION, PYODIDE_CDN } = await import("./pyodide-loader");
    expect(PYODIDE_CDN).toContain(`v${PYODIDE_VERSION}`);
    expect(PYODIDE_CDN).not.toContain("latest");
  });

  it("two calls return the same Promise (cached)", async () => {
    const mockPyodide = { runPythonAsync: vi.fn() };
    // @ts-expect-error
    window.loadPyodide = vi.fn().mockResolvedValue(mockPyodide);

    // Simulate the script's onload handler firing on append.
    const origAppend = document.head.appendChild.bind(document.head);
    document.head.appendChild = ((node: any) => {
      const result = origAppend(node);
      if (node.tagName === "SCRIPT") setTimeout(() => node.onload?.(), 0);
      return result;
    }) as any;

    try {
      const { loadPyodide: load } = await import("./pyodide-loader");
      const p1 = load();
      const p2 = load();
      expect(p1).toBe(p2);
      await p1;
      // @ts-expect-error
      expect(window.loadPyodide).toHaveBeenCalledTimes(1);
    } finally {
      document.head.appendChild = origAppend;
    }
  });
});
