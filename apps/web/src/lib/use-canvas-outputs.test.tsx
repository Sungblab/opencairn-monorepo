import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCanvasOutputs, canvasOutputsKeys } from "./use-canvas-outputs";

// Bare fetch mock — the hook goes through `apiClient` for the GET path and
// uses FormData on the upload path. Mirroring the pattern in
// `hooks/use-chat-threads.test.tsx`: we assert URL + method per call rather
// than reimplementing apiClient internals.
const fetchMock = vi.fn();
(globalThis as { fetch?: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

const makeClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

const wrapper = (qc: QueryClient) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };

beforeEach(() => {
  fetchMock.mockReset();
});

afterEach(() => {
  fetchMock.mockReset();
});

const NOTE = "note-1";

describe("useCanvasOutputs", () => {
  it("canvasOutputsKeys is deterministic", () => {
    expect(canvasOutputsKeys.list("note-1")).toEqual([
      "canvas-outputs",
      "note-1",
    ]);
  });

  it("fetches the list via /api/canvas/outputs?noteId=...", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        outputs: [
          {
            id: "o1",
            urlPath: "/api/canvas/outputs/o1/file",
            runId: null,
            mimeType: "image/png",
            bytes: 100,
            createdAt: "2026-04-26T00:00:00Z",
          },
        ],
      }),
    );

    const qc = makeClient();
    const { result } = renderHook(() => useCanvasOutputs(NOTE), {
      wrapper: wrapper(qc),
    });

    await waitFor(() => expect(result.current.data?.outputs.length).toBe(1));
    expect(result.current.data!.outputs[0].id).toBe("o1");
    const [url] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/canvas\/outputs\?noteId=note-1$/);
  });

  it("does not fetch when noteId is empty", async () => {
    const qc = makeClient();
    renderHook(() => useCanvasOutputs(""), { wrapper: wrapper(qc) });
    // Give React Query a tick — if it were going to fire it would have by now.
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("upload posts FormData to /api/canvas/output and invalidates the list", async () => {
    // initial list
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ outputs: [] }),
    );
    // POST /canvas/output
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: "o2", urlPath: "/api/canvas/outputs/o2/file" }, 201),
    );
    // refetch after invalidation
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        outputs: [
          {
            id: "o2",
            urlPath: "/api/canvas/outputs/o2/file",
            runId: "r1",
            mimeType: "image/png",
            bytes: 1,
            createdAt: "2026-04-26T00:00:00Z",
          },
        ],
      }),
    );

    const qc = makeClient();
    const { result } = renderHook(() => useCanvasOutputs(NOTE), {
      wrapper: wrapper(qc),
    });

    await waitFor(() => expect(result.current.data?.outputs).toEqual([]));

    const blob = new Blob(["x"], { type: "image/png" });
    let res: { id: string; urlPath: string } | undefined;
    await act(async () => {
      res = await result.current.upload({ blob, runId: "r1" });
    });

    expect(res).toEqual({
      id: "o2",
      urlPath: "/api/canvas/outputs/o2/file",
    });

    // Inspect the upload call: URL + method + FormData fields.
    const uploadCall = fetchMock.mock.calls[1];
    expect(uploadCall[0]).toMatch(/\/api\/canvas\/output$/);
    expect(uploadCall[1]?.method).toBe("POST");
    const body = uploadCall[1]?.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("noteId")).toBe(NOTE);
    expect(body.get("runId")).toBe("r1");
    expect(body.get("mimeType")).toBe("image/png");
    expect(body.get("file")).toBeInstanceOf(Blob);
    // Critical: the request must NOT carry Content-Type: application/json,
    // otherwise the multipart boundary would be ignored by the server.
    const headers = uploadCall[1]?.headers as Record<string, string> | Headers;
    const contentType =
      headers instanceof Headers
        ? headers.get("Content-Type")
        : (headers as Record<string, string> | undefined)?.["Content-Type"];
    expect(contentType).not.toBe("application/json");

    // Refetch should have been triggered by invalidation.
    await waitFor(() => expect(result.current.data?.outputs.length).toBe(1));
    expect(result.current.data!.outputs[0].id).toBe("o2");
  });

  it("upload omits runId from FormData when undefined", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ outputs: [] }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: "o3", urlPath: "/api/canvas/outputs/o3/file" }, 201),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({ outputs: [] }));

    const qc = makeClient();
    const { result } = renderHook(() => useCanvasOutputs(NOTE), {
      wrapper: wrapper(qc),
    });
    await waitFor(() => expect(result.current.data?.outputs).toEqual([]));

    const blob = new Blob(["y"], { type: "image/svg+xml" });
    await act(async () => {
      await result.current.upload({ blob });
    });

    const uploadCall = fetchMock.mock.calls[1];
    const body = uploadCall[1]?.body as FormData;
    expect(body.get("runId")).toBeNull();
    expect(body.get("mimeType")).toBe("image/svg+xml");
  });
});
