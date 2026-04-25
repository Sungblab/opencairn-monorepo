import { describe, expect, it, vi } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import koMessages from "../../../../messages/ko/canvas.json";
import { CanvasViewer } from "./canvas-viewer";
import type { Tab } from "@/stores/tabs-store";

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <NextIntlClientProvider locale="ko" messages={{ canvas: koMessages }}>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </NextIntlClientProvider>
  );
}

const mockNote = {
  id: "n1",
  title: "Hello",
  contentText: "print('hi')",
  canvasLanguage: "python" as const,
  sourceType: "canvas" as const,
};

vi.mock("@/lib/api-client", () => ({
  apiClient: vi.fn().mockImplementation((path: string, opts?: RequestInit) => {
    const method = opts?.method ?? "GET";
    if (path === "/notes/n1" && method === "GET") {
      return Promise.resolve(mockNote);
    }
    if (path === "/notes/n1/canvas" && method === "PATCH") {
      const body = JSON.parse(opts!.body as string);
      return Promise.resolve({ ...mockNote, contentText: body.source });
    }
    throw new Error(`Unexpected ${method} ${path}`);
  }),
  ApiError: class extends Error {
    constructor(
      public status: number,
      msg: string,
    ) {
      super(msg);
    }
  },
}));

// Speed up Pyodide-related rendering: the loader's real CDN fetch isn't useful
// in this test. We assert on the loading-status text rendered before any
// resolve happens, so the mock just needs to exist.
vi.mock("@/lib/pyodide-loader", () => ({
  PYODIDE_VERSION: "0.27.0",
  loadPyodide: vi.fn(() => new Promise(() => {})), // never resolves — we only check the loading text
}));

const tab = {
  id: "t1",
  kind: "note",
  targetId: "n1",
  mode: "canvas",
  title: "Canvas",
  pinned: false,
  preview: false,
  dirty: false,
  splitWith: null,
  splitSide: null,
  scrollY: 0,
} as unknown as Tab;

describe("CanvasViewer", () => {
  it("python language → PyodideRunner mounts (shows Pyodide loading text)", async () => {
    const { findByText } = render(wrap(<CanvasViewer tab={tab} />));
    await findByText(/Pyodide 로드 중/);
  });

  it("language='html' note → CanvasFrame mounts (iframe present)", async () => {
    const { apiClient } = await import("@/lib/api-client");
    (apiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...mockNote,
      canvasLanguage: "html",
      contentText: "<h1>x</h1>",
    });
    const { container } = render(wrap(<CanvasViewer tab={tab} />));
    await waitFor(() =>
      expect(container.querySelector("iframe")).not.toBeNull(),
    );
  });

  it("textarea change → debounced 1.5s PATCH call", async () => {
    const { apiClient } = await import("@/lib/api-client");
    const { findByRole } = render(wrap(<CanvasViewer tab={tab} />));

    // Wait for the initial GET to resolve and the textarea to render under
    // real timers (testing-library's findBy retry loop relies on real
    // setTimeout, so we keep real timers until the element is visible).
    const ta = (await findByRole("textbox")) as HTMLTextAreaElement;

    // Switch to fake timers ONLY for the debounce window so the 1.5s wait
    // collapses without burning real wallclock.
    vi.useFakeTimers();
    try {
      await act(async () => {
        // React-friendly value setter so the synthetic onChange fires.
        const setter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )!.set!;
        setter.call(ta, "print('new')");
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        // Advance past SAVE_DEBOUNCE_MS (1500); 1600 gives a small margin.
        vi.advanceTimersByTime(1600);
      });

      // Restore real timers so any pending mutation microtasks can settle.
      vi.useRealTimers();

      await waitFor(() => {
        const sawPatch = (
          apiClient as unknown as ReturnType<typeof vi.fn>
        ).mock.calls.some(
          (c: unknown[]) =>
            c[0] === "/notes/n1/canvas" &&
            (c[1] as RequestInit | undefined)?.method === "PATCH",
        );
        expect(sawPatch).toBe(true);
      });
    } finally {
      // Defensive — if anything threw before the explicit restore above.
      vi.useRealTimers();
    }
  });
});
