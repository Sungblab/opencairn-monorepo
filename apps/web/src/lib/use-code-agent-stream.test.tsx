import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useCodeAgentStream } from "./use-code-agent-stream";

// Minimal EventSource fake — mirrors the FakeES used in
// `hooks/use-research-stream.test.tsx`. We expose `instances` so tests can
// assert close behavior across runId changes.
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
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

describe("useCodeAgentStream", () => {
  let originalES: typeof EventSource | undefined;

  beforeEach(() => {
    FakeEventSource.instances = [];
    originalES = (globalThis as unknown as { EventSource?: typeof EventSource })
      .EventSource;
    (globalThis as unknown as { EventSource: typeof EventSource }).EventSource =
      FakeEventSource as unknown as typeof EventSource;
  });

  afterEach(() => {
    if (originalES) {
      (globalThis as unknown as { EventSource: typeof EventSource }).EventSource =
        originalES;
    }
  });

  it("returns idle defaults and opens no stream when runId is null", () => {
    const { result } = renderHook(() => useCodeAgentStream(null));
    expect(result.current.status).toBe("queued");
    expect(result.current.turns).toEqual([]);
    expect(result.current.doneStatus).toBeNull();
    expect(result.current.errorCode).toBeNull();
    expect(FakeEventSource.instances.length).toBe(0);
  });

  it("opens an EventSource targeting /api/code/runs/:id/stream", () => {
    renderHook(() => useCodeAgentStream("run-1"));
    expect(FakeEventSource.instances[0]?.url).toMatch(
      /\/api\/code\/runs\/run-1\/stream$/,
    );
  });

  it("collects turns and transitions to awaiting_feedback", async () => {
    const { result } = renderHook(() => useCodeAgentStream("run-1"));
    const es = FakeEventSource.instances[0];

    act(() => es.emit({ kind: "queued", runId: "run-1" }));
    await waitFor(() => expect(result.current.status).toBe("running"));

    act(() =>
      es.emit({
        kind: "turn_complete",
        turn: { kind: "generate", source: "x", explanation: "", seq: 0 },
      }),
    );
    await waitFor(() => expect(result.current.turns.length).toBe(1));
    expect(result.current.turns[0]).toMatchObject({
      kind: "generate",
      source: "x",
      seq: 0,
    });

    act(() => es.emit({ kind: "awaiting_feedback" }));
    await waitFor(() =>
      expect(result.current.status).toBe("awaiting_feedback"),
    );
  });

  it("closes the stream on done event and records terminal status", async () => {
    const { result } = renderHook(() => useCodeAgentStream("run-2"));
    const es = FakeEventSource.instances[0];
    act(() => es.emit({ kind: "done", status: "completed" }));
    await waitFor(() => {
      expect(result.current.status).toBe("done");
      expect(result.current.doneStatus).toBe("completed");
    });
    expect(es.closed).toBe(true);
  });

  it("captures error code and closes on error event", async () => {
    const { result } = renderHook(() => useCodeAgentStream("run-3"));
    const es = FakeEventSource.instances[0];
    act(() => es.emit({ kind: "error", code: "workflowFailed" }));
    await waitFor(() => {
      expect(result.current.status).toBe("error");
      expect(result.current.errorCode).toBe("workflowFailed");
    });
    expect(es.closed).toBe(true);
  });

  it("ignores thought/token placeholder events without changing state", async () => {
    const { result } = renderHook(() => useCodeAgentStream("run-4"));
    const es = FakeEventSource.instances[0];
    act(() => es.emit({ kind: "queued", runId: "run-4" }));
    await waitFor(() => expect(result.current.status).toBe("running"));

    act(() => es.emit({ kind: "thought", text: "thinking..." }));
    act(() => es.emit({ kind: "token", delta: "abc" }));
    // Status should remain "running"; turns should remain empty.
    expect(result.current.status).toBe("running");
    expect(result.current.turns).toEqual([]);
  });

  it("ignores malformed JSON without throwing", () => {
    renderHook(() => useCodeAgentStream("run-5"));
    const es = FakeEventSource.instances[0];
    expect(() => {
      es.onmessage?.(new MessageEvent("message", { data: "{not json" }));
    }).not.toThrow();
  });

  it("falls back to error status when EventSource fires onerror", async () => {
    const { result } = renderHook(() => useCodeAgentStream("run-6"));
    const es = FakeEventSource.instances[0];
    act(() => es.fail());
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(es.closed).toBe(true);
  });

  it("closes the previous stream and resets state when runId changes", async () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useCodeAgentStream(id),
      { initialProps: { id: "run-a" as string | null } },
    );
    const esA = FakeEventSource.instances[0];
    act(() => esA.emit({ kind: "queued", runId: "run-a" }));
    await waitFor(() => expect(result.current.status).toBe("running"));

    rerender({ id: "run-b" });
    await waitFor(() => expect(result.current.status).toBe("queued"));
    expect(result.current.turns).toEqual([]);
    expect(esA.closed).toBe(true);
    // A new EventSource should have been opened for run-b.
    expect(FakeEventSource.instances.length).toBe(2);
    expect(FakeEventSource.instances[1].url).toMatch(
      /\/api\/code\/runs\/run-b\/stream$/,
    );
  });

  it("closes the stream on unmount", () => {
    const { unmount } = renderHook(() => useCodeAgentStream("run-7"));
    const es = FakeEventSource.instances[0];
    expect(es.closed).toBe(false);
    unmount();
    expect(es.closed).toBe(true);
  });
});
