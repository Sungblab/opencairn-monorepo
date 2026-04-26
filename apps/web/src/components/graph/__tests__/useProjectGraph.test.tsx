import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useProjectGraph } from "../useProjectGraph";
import type { GraphResponse } from "@opencairn/shared";

const fixture: GraphResponse = {
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
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
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
