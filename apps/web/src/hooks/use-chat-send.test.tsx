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
    const invalidateSpy = vi.spyOn(QueryClient.prototype, "invalidateQueries");
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
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["workspaces", "me"],
    });

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

  it("can send to an explicit threadId before the hook rerenders", async () => {
    const body = mkSseBody([
      'event: done\ndata: {"id":"m1","status":"complete"}\n\n',
    ]);
    fetchMock.mockResolvedValueOnce({ ok: true, body } as Partial<Response>);

    const { result } = renderHook(() => useChatSend(null), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      await result.current.send({ content: "first", threadId: "new-thread" });
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/threads/new-thread/messages",
    );
  });

  it("refreshes chat thread titles as soon as the stream opens", async () => {
    const invalidateSpy = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    const closeStreamRef: { current?: () => void } = {};
    const slowBody = new ReadableStream<Uint8Array>({
      start(nextController) {
        closeStreamRef.current = () => nextController.close();
      },
    });
    fetchMock.mockResolvedValueOnce({ ok: true, body: slowBody } as Response);

    const { result } = renderHook(() => useChatSend("t1"), {
      wrapper: makeWrapper(),
    });

    void result.current.send({ content: "first title" });

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["chat-threads"],
      }),
    );
    closeStreamRef.current?.();
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

  it("tracks live run metadata from status, usage, and action events", async () => {
    let slowController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        slowController = controller;
      },
    });
    fetchMock.mockResolvedValueOnce({ ok: true, body } as Partial<Response>);

    const { result } = renderHook(() => useChatSend("t1"), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      void result.current.send({ content: "run with tools" });
      await Promise.resolve();
    });
    await act(async () => {
      slowController?.enqueue(
        new TextEncoder().encode(
          [
            'event: agent_placeholder\ndata: {"id":"m3"}',
            'event: run_started\ndata: {"id":"run-1"}',
            'event: run_attempt\ndata: {"attempt":1}',
            'event: status\ndata: {"kind":"runtime_context","executionClass":"durable_run","chatMode":"auto","ragMode":"strict"}',
            'event: agent_action_created\ndata: {"action":{"kind":"note.create_from_markdown","status":"completed"}}',
            'event: usage\ndata: {"tokensIn":12,"tokensOut":34,"model":"gemini-test"}',
            "",
          ].join("\n\n"),
        ),
      );
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current.live?.run).toMatchObject({
      id: "run-1",
      attempt: 1,
      executionClass: "durable_run",
      chatMode: "auto",
      ragMode: "strict",
      toolEvents: [{ kind: "note.create_from_markdown", status: "completed" }],
      usage: { tokensIn: 12, tokensOut: 34, model: "gemini-test" },
    });

    await act(async () => {
      slowController?.close();
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  it("cancels the active durable run when stopping the response", async () => {
    let firstSignal: AbortSignal | undefined;
    let slowController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        slowController = controller;
      },
    });
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
      firstSignal = init.signal ?? undefined;
      init.signal?.addEventListener(
        "abort",
        () => slowController?.error(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
      return Promise.resolve({ ok: true, body } as Partial<Response>);
    });
    fetchMock.mockResolvedValueOnce({ ok: true, body: null } as Partial<Response>);

    const { result } = renderHook(() => useChatSend("t1"), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      void result.current.send({ content: "stop me" });
      await Promise.resolve();
    });
    await act(async () => {
      slowController?.enqueue(
        new TextEncoder().encode(
          'event: agent_placeholder\ndata: {"id":"m3"}\n\nevent: run_started\ndata: {"id":"run-1"}\n\n',
        ),
      );
      await new Promise((r) => setTimeout(r, 0));
    });

    await act(async () => {
      result.current.stopResponse();
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(firstSignal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("/api/chat-runs/run-1/cancel", {
      method: "POST",
      credentials: "include",
    });
  });

  it("allows retrying a resumed run after a failed replay response", async () => {
    const body = mkSseBody([
      'event: done\ndata: {"id":"m1","status":"complete"}\n\n',
    ]);
    fetchMock
      .mockResolvedValueOnce({ ok: false, body: null } as Partial<Response>)
      .mockResolvedValueOnce({ ok: true, body } as Partial<Response>);

    const { result } = renderHook(() => useChatSend("t1"), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      await result.current.resumeRun("run-1", "m1");
    });
    await act(async () => {
      await result.current.resumeRun("run-1", "m1");
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/chat-runs/run-1/events?after=0");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/chat-runs/run-1/events?after=0");
    await waitFor(() => expect(result.current.live).toBeNull());
  });

  it("queues one prompt while a stream is active and sends it after the current run finishes", async () => {
    // First call returns a stream that pauses. A second send should not abort
    // that stream; it becomes the next prompt and starts after the first done.
    let firstSignal: AbortSignal | undefined;
    let slowController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const slowBody = new ReadableStream({
      start(controller) {
        slowController = controller;
      },
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

    // Fire the first send but don't await while the stream is still open.
    await act(async () => {
      void result.current.send({ content: "first" });
      await Promise.resolve();
    });

    // Yield to the microtask queue so `controller.current` is set before
    // the second send reads it.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    await act(async () => {
      await result.current.send({ content: "second" });
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(firstSignal?.aborted).toBe(false);
    expect(result.current.pendingUser?.content.body).toBe("second");

    await act(async () => {
      slowController?.enqueue(
        new TextEncoder().encode(
          'event: done\ndata: {"id":"m1","status":"complete"}\n\n',
        ),
      );
      slowController?.close();
      await new Promise((r) => setTimeout(r, 0));
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe("/api/threads/t1/messages");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toMatchObject({
      content: "second",
    });
    await waitFor(() => expect(result.current.live).toBeNull());
  });

  it("keeps only the latest queued prompt while a stream is active", async () => {
    let slowController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const slowBody = new ReadableStream({
      start(controller) {
        slowController = controller;
      },
      pull() {
        /* no-op */
      },
    });
    const doneBody = mkSseBody([
      'event: done\ndata: {"id":"m2","status":"complete"}\n\n',
    ]);
    fetchMock
      .mockResolvedValueOnce({ ok: true, body: slowBody } as Partial<Response>)
      .mockResolvedValueOnce({ ok: true, body: doneBody } as Partial<Response>);

    const { result } = renderHook(() => useChatSend("t1"), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      void result.current.send({ content: "first" });
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    await act(async () => {
      await result.current.send({ content: "second" });
      await result.current.send({ content: "third" });
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.pendingUser?.content.body).toBe("third");

    await act(async () => {
      slowController?.enqueue(
        new TextEncoder().encode(
          'event: done\ndata: {"id":"m1","status":"complete"}\n\n',
        ),
      );
      slowController?.close();
      await new Promise((r) => setTimeout(r, 0));
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toMatchObject({
      content: "third",
    });
  });

  it("sends edited queued prompt content after the active stream finishes", async () => {
    let slowController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const slowBody = new ReadableStream({
      start(controller) {
        slowController = controller;
      },
      pull() {
        /* no-op */
      },
    });
    const doneBody = mkSseBody([
      'event: done\ndata: {"id":"m2","status":"complete"}\n\n',
    ]);
    fetchMock
      .mockResolvedValueOnce({ ok: true, body: slowBody } as Partial<Response>)
      .mockResolvedValueOnce({ ok: true, body: doneBody } as Partial<Response>);

    const { result } = renderHook(() => useChatSend("t1"), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      void result.current.send({ content: "first" });
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    await act(async () => {
      await result.current.send({ content: "second" });
      result.current.updateQueuedPrompt("edited second");
    });

    expect(result.current.queuedPrompt?.content).toBe("edited second");

    await act(async () => {
      slowController?.enqueue(
        new TextEncoder().encode(
          'event: done\ndata: {"id":"m1","status":"complete"}\n\n',
        ),
      );
      slowController?.close();
      await new Promise((r) => setTimeout(r, 0));
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toMatchObject({
      content: "edited second",
    });
  });

  it("can discard a queued prompt before the active stream finishes", async () => {
    let slowController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const slowBody = new ReadableStream({
      start(controller) {
        slowController = controller;
      },
      pull() {
        /* no-op */
      },
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      body: slowBody,
    } as Partial<Response>);

    const { result } = renderHook(() => useChatSend("t1"), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      void result.current.send({ content: "first" });
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    await act(async () => {
      await result.current.send({ content: "second" });
      result.current.clearQueuedPrompt();
    });

    expect(result.current.queuedPrompt).toBeNull();

    await act(async () => {
      slowController?.enqueue(
        new TextEncoder().encode(
          'event: done\ndata: {"id":"m1","status":"complete"}\n\n',
        ),
      );
      slowController?.close();
      await new Promise((r) => setTimeout(r, 0));
    });

    await waitFor(() => expect(result.current.live).toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("can interrupt the active stream and send the queued prompt immediately", async () => {
    let firstSignal: AbortSignal | undefined;
    let slowController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const slowBody = new ReadableStream({
      start(controller) {
        slowController = controller;
      },
      pull() {
        /* no-op */
      },
    });
    const doneBody = mkSseBody([
      'event: done\ndata: {"id":"m2","status":"complete"}\n\n',
    ]);
    fetchMock
      .mockImplementationOnce((_url: string, init: RequestInit) => {
        firstSignal = init.signal ?? undefined;
        init.signal?.addEventListener(
          "abort",
          () => {
            slowController?.error(new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );
        return Promise.resolve({ ok: true, body: slowBody } as Response);
      })
      .mockResolvedValueOnce({ ok: true, body: doneBody } as Partial<Response>);

    const { result } = renderHook(() => useChatSend("t1"), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      void result.current.send({ content: "first" });
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    await act(async () => {
      await result.current.send({ content: "second" });
      result.current.interruptQueuedPrompt();
    });

    expect(firstSignal?.aborted).toBe(true);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toMatchObject({
      content: "second",
    });
  });

});
