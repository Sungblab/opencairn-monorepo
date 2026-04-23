import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, afterEach } from "vitest";
import { useProjectTree, type TreeNode } from "./use-project-tree";

const makeClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

const fetchMock = vi.fn();
(globalThis as { fetch?: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

afterEach(() => {
  fetchMock.mockReset();
});

function mockTree(nodes: TreeNode[]): void {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ nodes }),
  });
}

describe("useProjectTree", () => {
  it("loads root nodes (folders + notes) on mount", async () => {
    mockTree([
      {
        kind: "folder",
        id: "f1",
        parent_id: null,
        label: "Folder A",
        child_count: 0,
        children: [],
      },
      {
        kind: "note",
        id: "n1",
        parent_id: null,
        label: "Root note",
        child_count: 0,
      },
    ]);

    const qc = makeClient();
    const { result } = renderHook(
      () => useProjectTree({ projectId: "proj-1" }),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={qc}>{children}</QueryClientProvider>
        ),
      },
    );

    await waitFor(() => expect(result.current.roots).toHaveLength(2));
    expect(result.current.roots[0].kind).toBe("folder");
    expect(result.current.roots[1].kind).toBe("note");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/projects/proj-1/tree");
  });

  it("loadChildren fetches and caches a folder's children under parent_id", async () => {
    mockTree([
      {
        kind: "folder",
        id: "f1",
        parent_id: null,
        label: "F",
        child_count: 2,
        children: [
          {
            kind: "folder",
            id: "f1a",
            parent_id: "f1",
            label: "child",
            child_count: 0,
          },
        ],
      },
    ]);
    mockTree([
      {
        kind: "folder",
        id: "f1a",
        parent_id: "f1",
        label: "child",
        child_count: 0,
      },
      {
        kind: "note",
        id: "n1",
        parent_id: "f1",
        label: "n",
        child_count: 0,
      },
    ]);

    const qc = makeClient();
    const { result } = renderHook(
      () => useProjectTree({ projectId: "proj-1" }),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={qc}>{children}</QueryClientProvider>
        ),
      },
    );

    await waitFor(() => expect(result.current.roots).toHaveLength(1));
    const children = await result.current.loadChildren("f1");
    expect(children).toHaveLength(2);
    expect(
      fetchMock.mock.calls.some(
        (args) => args[0] === "/api/projects/proj-1/tree?parent_id=f1",
      ),
    ).toBe(true);
  });

  it("isLoading flips false after the first fetch resolves", async () => {
    mockTree([]);
    const qc = makeClient();
    const { result } = renderHook(
      () => useProjectTree({ projectId: "proj-1" }),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={qc}>{children}</QueryClientProvider>
        ),
      },
    );
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.roots).toEqual([]);
  });

  it("surfaces an error when the endpoint rejects", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: "boom" }),
    });

    const qc = makeClient();
    const { result } = renderHook(
      () => useProjectTree({ projectId: "proj-1" }),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={qc}>{children}</QueryClientProvider>
        ),
      },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
