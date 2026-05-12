import { describe, it, expect, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import koGraph from "@/../messages/ko/graph.json";
import GraphView from "../GraphView";

vi.mock("next/dynamic", () => ({
  default: () => () => <div data-testid="force-graph-mount">force graph</div>,
}));

let searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({ wsSlug: "w" }),
  useSearchParams: () => searchParams,
}));

function renderWith(data: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(data), { status: 200 })),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="ko" messages={{ graph: koGraph }}>
        <GraphView projectId="p1" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { ...result, qc };
}

describe("GraphView", () => {
  it("does not reopen a consumed edge deep link after closing the panel", async () => {
    const edgeId = "33333333-3333-4333-8333-333333333333";
    searchParams = new URLSearchParams({ edge: edgeId });
    const data = {
      nodes: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          name: "A",
          description: "",
          degree: 1,
          noteCount: 0,
          firstNoteId: null,
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          name: "B",
          description: "",
          degree: 1,
          noteCount: 0,
          firstNoteId: null,
        },
      ],
      edges: [
        {
          id: edgeId,
          sourceId: "11111111-1111-4111-8111-111111111111",
          targetId: "22222222-2222-4222-8222-222222222222",
          relationType: "supports",
          weight: 1,
          support: {
            status: "supported",
            supportScore: 0.9,
            citationCount: 0,
            evidenceBundleId: null,
            claimId: null,
          },
        },
      ],
      evidenceBundles: [],
      truncated: false,
      totalConcepts: 2,
    };
    const { qc } = renderWith(data);

    expect(await screen.findByTestId("edge-evidence-panel")).toBeInTheDocument();
    await act(async () => {
      screen.getByRole("button", { name: koGraph.evidence.close }).click();
    });
    await waitFor(() => {
      expect(screen.queryByTestId("edge-evidence-panel")).not.toBeInTheDocument();
    });

    await act(async () => {
      qc.setQueryData(["project-graph", "p1", "graph", null], {
        ...data,
        edges: [...data.edges],
      });
    });

    await waitFor(() => {
      expect(screen.queryByTestId("edge-evidence-panel")).not.toBeInTheDocument();
    });
  });

  it("renders empty state when concept list is empty", async () => {
    searchParams = new URLSearchParams();
    renderWith({ nodes: [], edges: [], truncated: false, totalConcepts: 0 });
    expect(await screen.findByText(koGraph.empty.title)).toBeInTheDocument();
  });

  it("mounts the force graph when there is data", async () => {
    searchParams = new URLSearchParams();
    renderWith({
      nodes: [{ id: "n1", name: "A", description: "", degree: 0, noteCount: 0, firstNoteId: null }],
      edges: [],
      truncated: false,
      totalConcepts: 1,
    });
    expect(await screen.findByTestId("force-graph-mount")).toBeInTheDocument();
  });
});
