import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useChatThreads, type ChatThread } from "./use-chat-threads";

// Bare fetch mock — the hook goes through `apiClient`, which calls fetch with
// `credentials: "include"` and a JSON content type. We assert URL + method per
// call rather than reimplementing apiClient's parsing, which would couple the
// test to its internals.
const fetchMock = vi.fn();
(globalThis as { fetch?: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

const makeClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}

function mockThreads(threads: ChatThread[]) {
  fetchMock.mockResolvedValueOnce(jsonResponse({ threads }));
}

afterEach(() => {
  fetchMock.mockReset();
});

const WS = "ws-uuid-1";

const wrapper = (qc: QueryClient) =>
  ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );

describe("useChatThreads", () => {
  it("lists and creates threads inside the selected project scope", async () => {
    mockThreads([]);
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "t1", title: "x" }));
    mockThreads([]);

    const qc = makeClient();
    const { result } = renderHook(() => useChatThreads(WS, "project-1"), {
      wrapper: wrapper(qc),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.create.mutateAsync({ title: "x" });
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      `/api/threads?workspace_id=${WS}&project_id=project-1`,
    );
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toEqual({
      workspace_id: WS,
      project_id: "project-1",
      title: "x",
    });
    expect(fetchMock.mock.calls[2][0]).toBe(
      `/api/threads?workspace_id=${WS}&project_id=project-1`,
    );
  });

  it("create.mutateAsync invalidates the list and the next fetch returns the new thread", async () => {
    mockThreads([]); // initial list: empty
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: "t1", title: "x" }),
    ); // POST /threads
    mockThreads([
      {
        id: "t1",
        title: "x",
        created_at: "2026-04-25T00:00:00Z",
        updated_at: "2026-04-25T00:00:00Z",
      },
    ]); // refetch after invalidation

    const qc = makeClient();
    const { result } = renderHook(() => useChatThreads(WS), {
      wrapper: wrapper(qc),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.threads).toEqual([]);

    await act(async () => {
      await result.current.create.mutateAsync({ title: "x" });
    });

    await waitFor(() => expect(result.current.threads).toHaveLength(1));
    expect(result.current.threads[0].id).toBe("t1");

    // Verify the request sequence: list -> POST -> list.
    expect(fetchMock.mock.calls[0][0]).toBe(
      `/api/threads?workspace_id=${WS}`,
    );
    expect(fetchMock.mock.calls[1][0]).toBe("/api/threads");
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "POST" });
    expect(fetchMock.mock.calls[2][0]).toBe(
      `/api/threads?workspace_id=${WS}`,
    );
  });

  it("archive.mutateAsync invalidates the list", async () => {
    mockThreads([
      {
        id: "t1",
        title: "x",
        created_at: "2026-04-25T00:00:00Z",
        updated_at: "2026-04-25T00:00:00Z",
      },
    ]);
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true })); // DELETE
    mockThreads([]); // refetch after invalidation

    const qc = makeClient();
    const { result } = renderHook(() => useChatThreads(WS), {
      wrapper: wrapper(qc),
    });

    await waitFor(() => expect(result.current.threads).toHaveLength(1));

    await act(async () => {
      await result.current.archive.mutateAsync("t1");
    });

    await waitFor(() => expect(result.current.threads).toHaveLength(0));

    expect(fetchMock.mock.calls[1][0]).toBe("/api/threads/t1");
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "DELETE" });
  });

  it("does not fetch when workspaceId is null and threads is []", async () => {
    const qc = makeClient();
    const { result } = renderHook(() => useChatThreads(null), {
      wrapper: wrapper(qc),
    });

    expect(result.current.threads).toEqual([]);
    // Give React Query a tick — if it were going to fire it would have by now.
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
