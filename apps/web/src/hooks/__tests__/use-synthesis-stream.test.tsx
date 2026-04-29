import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useSynthesisStream } from "../use-synthesis-stream";

// Minimal EventSource mock — captures handlers so tests can drive state.
class MockEventSource {
  static lastInstance: MockEventSource | null = null;
  url: string;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.lastInstance = this;
  }

  close() {
    this.closed = true;
  }

  emit(data: unknown) {
    this.onmessage?.(
      new MessageEvent("message", { data: JSON.stringify(data) }),
    );
  }

  fail() {
    this.onerror?.(new Event("error"));
  }
}

describe("useSynthesisStream", () => {
  let originalES: typeof EventSource | undefined;

  beforeEach(() => {
    originalES = (globalThis as unknown as { EventSource?: typeof EventSource })
      .EventSource;
    (globalThis as unknown as { EventSource: typeof EventSource }).EventSource =
      MockEventSource as unknown as typeof EventSource;
    MockEventSource.lastInstance = null;
  });

  afterEach(() => {
    if (originalES !== undefined) {
      (
        globalThis as unknown as { EventSource: typeof EventSource }
      ).EventSource = originalES;
    } else {
      delete (globalThis as unknown as { EventSource?: typeof EventSource })
        .EventSource;
    }
  });

  it("transitions through queued → fetching → done", async () => {
    const { result } = renderHook(() => useSynthesisStream("run-abc"));

    // Initial state is "queued"
    expect(result.current.status).toBe("queued");
    expect(MockEventSource.lastInstance?.url).toMatch(
      /\/api\/synthesis-export\/runs\/run-abc\/stream$/,
    );

    // queued event → running
    act(() => {
      MockEventSource.lastInstance?.emit({ kind: "queued", runId: "run-abc" });
    });
    await waitFor(() => expect(result.current.status).toBe("running"));

    // fetching_sources event → fetching + sourceCount
    act(() => {
      MockEventSource.lastInstance?.emit({ kind: "fetching_sources", count: 5 });
    });
    await waitFor(() => {
      expect(result.current.status).toBe("fetching");
      expect(result.current.sourceCount).toBe(5);
    });

    // done event → terminal state, ES closed
    act(() => {
      MockEventSource.lastInstance?.emit({
        kind: "done",
        docUrl: "https://cdn.example.com/doc.pdf",
        format: "pdf",
        sourceCount: 5,
        tokensUsed: 1200,
      });
    });
    await waitFor(() => {
      expect(result.current.status).toBe("done");
      expect(result.current.docUrl).toBe("https://cdn.example.com/doc.pdf");
      expect(result.current.format).toBe("pdf");
      expect(result.current.sourceCount).toBe(5);
      expect(result.current.tokensUsed).toBe(1200);
    });

    expect(MockEventSource.lastInstance?.closed).toBe(true);
  });

  it("error event sets errorCode and closes stream", async () => {
    const { result } = renderHook(() => useSynthesisStream("run-xyz"));

    act(() => {
      MockEventSource.lastInstance?.emit({ kind: "error", code: "quota_exceeded" });
    });
    await waitFor(() => {
      expect(result.current.status).toBe("error");
      expect(result.current.errorCode).toBe("quota_exceeded");
    });

    expect(MockEventSource.lastInstance?.closed).toBe(true);
  });
});
