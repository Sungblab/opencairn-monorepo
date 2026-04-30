import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";

// Same shim as composer.test.tsx — keeps assertions stable across locales
// and avoids dragging the real next-intl provider into the hook test.
vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (k: string) => (ns ? `${ns}.${k}` : k),
}));

const toastErrorMock = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

import { useChatSend } from "./use-chat-send";

// Build a ReadableStream<Uint8Array> from a list of pre-encoded SSE frames.
// We split the chunks deliberately so the parser is forced to handle frames
// that arrive across multiple reads (the real network behavior).
function mkSseBody(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  toastErrorMock.mockReset();
  vi.unstubAllGlobals();
});

describe("useChatSend", () => {
  it("accumulates text deltas and resets live to null on done", async () => {
    const body = mkSseBody([
      'event: status\ndata: {"phrase":"검색 중"}\n\n',
      'event: agent_placeholder\ndata: {"id":"m1"}\n\n',
      'event: text\ndata: {"delta":"Hel"}\n\n',
      'event: text\ndata: {"delta":"lo"}\n\n',
      'event: done\ndata: {"id":"m1","status":"complete"}\n\n',
    ]);
    fetchMock.mockResolvedValueOnce({ ok: true, body } as Partial<Response>);

    const { result } = renderHook(() => useChatSend("t1"), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      await result.current.send({ content: "hi" });
    });

    // After done, live is reset to null so the persisted-row render takes over.
    await waitFor(() => expect(result.current.live).toBeNull());

    // Verify the request shape — POST + JSON body + SSE accept header.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/threads/t1/messages");
    expect(init).toMatchObject({
      method: "POST",
      credentials: "include",
    });
    expect(init.headers).toMatchObject({
      "content-type": "application/json",
      accept: "text/event-stream",
    });
    const sent = JSON.parse(init.body as string);
    expect(sent).toMatchObject({ content: "hi", mode: "auto" });
  });

  it("passes concrete retrieval scope through the request body", async () => {
    const body = mkSseBody([
      'event: done\ndata: {"id":"m1","status":"complete"}\n\n',
    ]);
    fetchMock.mockResolvedValueOnce({ ok: true, body } as Partial<Response>);

    const { result } = renderHook(() => useChatSend("t1"), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      await result.current.send({
        content: "with scope",
        scope: {
          strict: "loose",
          chips: [
            { type: "page", id: "n1" },
            { type: "workspace", id: "w1" },
          ],
        },
      });
    });

    const [, init] = fetchMock.mock.calls[0];
    const sent = JSON.parse(init.body as string);
    expect(sent.scope).toEqual({
      strict: "loose",
      chips: [
        { type: "page", id: "n1" },
        { type: "workspace", id: "w1" },
      ],
    });
  });

  it("does nothing when threadId is null", async () => {
    const { result } = renderHook(() => useChatSend(null), {
      wrapper: makeWrapper(),
    });
    await act(async () => {
      await result.current.send({ content: "hi" });
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clears live when the response is not ok", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, body: null } as Partial<Response>);

    const { result } = renderHook(() => useChatSend("t1"), {
      wrapper: makeWrapper(),
    });
    await act(async () => {
      await result.current.send({ content: "hi" });
    });

    expect(result.current.live).toBeNull();
  });

  it("surfaces `event: error` SSE frames via the toast", async () => {
    const body = mkSseBody([
      'event: agent_placeholder\ndata: {"id":"m3"}\n\n',
      'event: text\ndata: {"delta":"partial"}\n\n',
      'event: error\ndata: {"message":"provider blew up","code":"provider_error"}\n\n',
      'event: done\ndata: {"id":"m3","status":"failed"}\n\n',
    ]);
    fetchMock.mockResolvedValueOnce({ ok: true, body } as Partial<Response>);

    const { result } = renderHook(() => useChatSend("t1"), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      await result.current.send({ content: "fail me" });
    });

    // Toast was triggered with the i18n key (shimmed namespace.key).
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
    expect(toastErrorMock).toHaveBeenCalledWith("chat.errors.streamFailed");

    // `done` still resets `live` after `error` — error doesn't preempt
    // completion in the route's contract.
    await waitFor(() => expect(result.current.live).toBeNull());
  });

  it("aborts in-flight when a new send begins", async () => {
    // First call returns a stream that pauses indefinitely. We track abort
    // by listening for the AbortSignal the hook passes in `init.signal`.
    let firstSignal: AbortSignal | undefined;
    const slowBody = new ReadableStream({
      // Never enqueues — simulates a stream that hasn't produced any frames
      // yet. The reader will hang on `.read()` until the request is aborted.
      pull() {
        /* no-op */
      },
    });
    const fastBody = mkSseBody([
      'event: done\ndata: {"id":"m2","status":"complete"}\n\n',
    ]);
    fetchMock
      .mockImplementationOnce((_url: string, init: RequestInit) => {
        firstSignal = init.signal ?? undefined;
        return Promise.resolve({ ok: true, body: slowBody } as Response);
      })
      .mockResolvedValueOnce({ ok: true, body: fastBody } as Partial<Response>);

    const { result } = renderHook(() => useChatSend("t1"), {
      wrapper: makeWrapper(),
    });

    // Fire the first send but don't await — it would never resolve since
    // the stream hangs. We just need the fetch to register so the next
    // send can abort it.
    void act(async () => {
      void result.current.send({ content: "first" });
    });

    // Yield to the microtask queue so `controller.current` is set before
    // the second send reads it.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    await act(async () => {
      await result.current.send({ content: "second" });
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The first request's signal should now be aborted by the second send.
    expect(firstSignal?.aborted).toBe(true);
  });
});
