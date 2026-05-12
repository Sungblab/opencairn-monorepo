import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useProjectGraph } from "../useProjectGraph";
import { useViewStateStore } from "../view-state-store";
import type { GraphViewResponse, ViewSpec } from "@opencairn/shared";

const fixture: GraphViewResponse = {
  nodes: [{ id: "n1", name: "Alpha", description: "", degree: 0, noteCount: 0, firstNoteId: null }],
  edges: [],
  truncated: false,
  totalConcepts: 1,
  // Plan 5 Phase 2: server echoes the requested view + layout hint + rootId.
  viewType: "graph",
  layout: "fcose",
  rootId: null,
};

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

// Builds a fresh provider per renderHook so cache state never leaks between tests.
function wrap() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  // Plan 5 Phase 2: clear inline ViewSpec store before each test so the
  // priority-over-network rule isn't masked by leakage from a sibling case.
  useViewStateStore.setState({ inline: {} });
  vi.restoreAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 })),
  );
});

describe("useProjectGraph", () => {
  it("fetches the project graph", async () => {
    const { result } = renderHook(() => useProjectGraph("p1"), { wrapper });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(result.current.data?.nodes).toHaveLength(1);
  });

  it("requests grounded graph data with evidence included", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { result } = renderHook(() => useProjectGraph("proj-1"), {
      wrapper: wrap(),
    });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    const url = (fetchSpy.mock.calls[0]?.[0] as string) ?? "";
    expect(url).toContain("/api/projects/proj-1/knowledge-surface?");
    expect(url).toContain("view=graph");
    expect(url).toContain("includeEvidence=true");
  });

  it("merges expand result into the cached snapshot (dedup by id)", async () => {
    const { result } = renderHook(() => useProjectGraph("p1"), { wrapper });
    await waitFor(() => expect(result.current.data).toBeTruthy());

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            nodes: [
              fixture.nodes[0], // duplicate — should not double
              { id: "n2", name: "Beta", description: "", degree: 0, noteCount: 0, firstNoteId: null },
            ],
            edges: [{ id: "e1", sourceId: "n1", targetId: "n2", relationType: "is-a", weight: 1 }],
          }),
          { status: 200 },
        ),
      ),
    );
    await act(async () => {
      await result.current.expand("n1", 1);
    });
    await waitFor(() => expect(result.current.data?.nodes).toHaveLength(2));
    expect(result.current.data?.edges).toHaveLength(1);
  });
});

describe("useProjectGraph view+root extension", () => {
  it("includes ?view=mindmap&root=<id> in fetch URL", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        viewType: "mindmap", layout: "dagre",
        rootId: "11111111-1111-4111-8111-111111111111",
        nodes: [], edges: [], truncated: false, totalConcepts: 0,
      })),
    );
    const { result } = renderHook(
      () => useProjectGraph("proj-1", {
        view: "mindmap",
        root: "11111111-1111-4111-8111-111111111111",
      }),
      { wrapper: wrap() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const url = (fetchSpy.mock.calls[0]?.[0] as string) ?? "";
    expect(url).toContain("/api/projects/proj-1/knowledge-surface?");
    expect(url).toContain("view=mindmap");
    expect(url).toContain("root=11111111-1111-4111-8111-111111111111");
    expect(url).toContain("includeEvidence=true");
  });

  it("requests timeline through the grounded knowledge-surface endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        viewType: "timeline", layout: "preset", rootId: null,
        nodes: [], edges: [], truncated: false, totalConcepts: 0,
      })),
    );
    const { result } = renderHook(
      () => useProjectGraph("proj-1", { view: "timeline" }),
      { wrapper: wrap() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const url = (fetchSpy.mock.calls[0]?.[0] as string) ?? "";
    expect(url).toContain("/api/projects/proj-1/knowledge-surface?");
    expect(url).toContain("view=timeline");
    expect(url).toContain("includeEvidence=true");
  });

  it("uses inline ViewSpec from store when present, skips fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const spec: ViewSpec = {
      viewType: "mindmap",
      layout: "dagre",
      rootId: "11111111-1111-4111-8111-111111111111",
      nodes: [{ id: "11111111-1111-4111-8111-111111111111", name: "x" }],
      edges: [],
    };
    useViewStateStore.getState().setInline("proj-1", spec);
    const { result } = renderHook(
      () => useProjectGraph("proj-1", { view: "mindmap", root: spec.rootId! }),
      { wrapper: wrap() },
    );
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(result.current.data?.nodes).toEqual(spec.nodes);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("query key includes view + root for cache separation", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        viewType: "graph", layout: "fcose", rootId: null,
        nodes: [], edges: [], truncated: false, totalConcepts: 0,
      })),
    );
    const { result, rerender } = renderHook(
      ({ view }: { view: "graph" | "mindmap" }) =>
        useProjectGraph("proj-1", { view }),
      { wrapper: wrap(), initialProps: { view: "graph" } },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    rerender({ view: "mindmap" });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // 2 fetches — separate cache keys per view.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
