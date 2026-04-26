// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useVisualizeMutation } from "../useVisualizeMutation";

// Build a ReadableStream from pre-baked SSE chunks. jsdom ships a working
// `ReadableStream` + `Response.body`, so we can hand the same Response shape
// the real fetch would produce.
function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
}

function sseResponse(chunks: string[]): Response {
  return new Response(streamFromChunks(chunks), {
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("useVisualizeMutation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("collects progress events and viewSpec on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseResponse([
        'event: tool_use\ndata: {"name":"search_concepts","callId":"1"}\n\n',
        'event: tool_result\ndata: {"callId":"1","ok":true}\n\n',
        'event: view_spec\ndata: {"viewSpec":{"viewType":"graph","layout":"fcose","rootId":null,"nodes":[],"edges":[]}}\n\n',
        "event: done\ndata: {}\n\n",
      ]),
    );

    const { result } = renderHook(() => useVisualizeMutation());
    await act(async () => {
      await result.current.submit({ projectId: "p", prompt: "graph" });
    });

    await waitFor(() =>
      expect(result.current.viewSpec?.viewType).toBe("graph"),
    );
    expect(result.current.progress.length).toBeGreaterThanOrEqual(2);
    expect(result.current.progress[0].event).toBe("tool_use");
    expect(result.current.progress[1].event).toBe("tool_result");
    expect(result.current.error).toBeNull();
    expect(result.current.submitting).toBe(false);
  });

  it("captures error event payload", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseResponse([
        'event: error\ndata: {"error":"agent_did_not_emit_view_spec","messageKey":"graph.errors.visualizeFailed"}\n\n',
        "event: done\ndata: {}\n\n",
      ]),
    );

    const { result } = renderHook(() => useVisualizeMutation());
    await act(async () => {
      await result.current.submit({ projectId: "p", prompt: "x" });
    });

    await waitFor(() =>
      expect(result.current.error).toBe("agent_did_not_emit_view_spec"),
    );
    expect(result.current.viewSpec).toBeNull();
  });

  it("maps non-ok responses to a coarse error code", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 429 }),
    );

    const { result } = renderHook(() => useVisualizeMutation());
    await act(async () => {
      await result.current.submit({ projectId: "p", prompt: "x" });
    });

    expect(result.current.error).toBe("concurrent-visualize");
  });

  it("falls back to visualizeFailed for other non-ok statuses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 500 }),
    );

    const { result } = renderHook(() => useVisualizeMutation());
    await act(async () => {
      await result.current.submit({ projectId: "p", prompt: "x" });
    });

    expect(result.current.error).toBe("visualizeFailed");
  });

  it("cancel aborts the in-flight fetch", async () => {
    let abortReason: unknown;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = (init as RequestInit | undefined)?.signal as
            | AbortSignal
            | undefined;
          signal?.addEventListener("abort", () => {
            abortReason = signal.reason;
            reject(
              Object.assign(new Error("aborted"), { name: "AbortError" }),
            );
          });
        }),
    );

    const { result } = renderHook(() => useVisualizeMutation());
    await act(async () => {
      void result.current.submit({ projectId: "p", prompt: "x" });
      // Yield so the fetch promise registers the abort listener.
      await new Promise((r) => setTimeout(r, 5));
      result.current.cancel();
    });

    await waitFor(() => expect(abortReason).toBeDefined());
    // AbortError must not surface as a user-facing error.
    expect(result.current.error).toBeNull();
  });

  it("resets progress + viewSpec + error between submits", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(
      sseResponse([
        'event: error\ndata: {"error":"first_failure"}\n\n',
        "event: done\ndata: {}\n\n",
      ]),
    );

    const { result } = renderHook(() => useVisualizeMutation());
    await act(async () => {
      await result.current.submit({ projectId: "p", prompt: "x" });
    });
    expect(result.current.error).toBe("first_failure");

    fetchSpy.mockResolvedValueOnce(
      sseResponse([
        'event: view_spec\ndata: {"viewSpec":{"viewType":"cards","layout":"preset","rootId":null,"nodes":[],"edges":[]}}\n\n',
        "event: done\ndata: {}\n\n",
      ]),
    );
    await act(async () => {
      await result.current.submit({ projectId: "p", prompt: "y" });
    });

    await waitFor(() =>
      expect(result.current.viewSpec?.viewType).toBe("cards"),
    );
    expect(result.current.error).toBeNull();
  });
});
