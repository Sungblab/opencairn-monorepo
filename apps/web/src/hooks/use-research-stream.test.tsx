import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useResearchStream } from "./use-research-stream";
import type { ResearchStreamEvent } from "@opencairn/shared";

// Minimal EventSource fake — just enough surface for the hook's contract.
class FakeES {
  static lastInstance: FakeES | null = null;
  url: string;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeES.lastInstance = this;
  }
  close() {
    this.closed = true;
  }
  emit(data: unknown) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) }));
  }
  fail() {
    this.onerror?.(new Event("error"));
  }
}

describe("useResearchStream", () => {
  let originalES: typeof EventSource | undefined;
  beforeEach(() => {
    originalES = (globalThis as unknown as { EventSource?: typeof EventSource })
      .EventSource;
    (globalThis as unknown as { EventSource: typeof EventSource }).EventSource =
      FakeES as unknown as typeof EventSource;
  });
  afterEach(() => {
    if (originalES) {
      (globalThis as unknown as { EventSource: typeof EventSource }).EventSource =
        originalES;
    }
  });

  it("opens an EventSource targeting /api/research/runs/:id/stream", () => {
    renderHook(() => useResearchStream("r1", () => {}));
    expect(FakeES.lastInstance?.url).toMatch(
      /\/api\/research\/runs\/r1\/stream$/,
    );
  });

  it("dispatches typed events", () => {
    const events: ResearchStreamEvent[] = [];
    renderHook(() =>
      useResearchStream("r1", (ev) => events.push(ev)),
    );
    act(() => {
      FakeES.lastInstance?.emit({ type: "status", status: "researching" });
    });
    expect(events).toEqual([{ type: "status", status: "researching" }]);
  });

  it("ignores malformed JSON without throwing", () => {
    renderHook(() => useResearchStream("r1", () => {}));
    expect(() => {
      FakeES.lastInstance?.onmessage?.(
        new MessageEvent("message", { data: "{not json" }),
      );
    }).not.toThrow();
  });

  it("closes on unmount", () => {
    const { unmount } = renderHook(() =>
      useResearchStream("r1", () => {}),
    );
    expect(FakeES.lastInstance?.closed).toBe(false);
    unmount();
    expect(FakeES.lastInstance?.closed).toBe(true);
  });

  it("does nothing when runId is null", () => {
    FakeES.lastInstance = null;
    renderHook(() => useResearchStream(null, () => {}));
    expect(FakeES.lastInstance).toBeNull();
  });
});
