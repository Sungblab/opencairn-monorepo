import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import koGraph from "@/../messages/ko/graph.json";
import { ProjectGraph } from "../ProjectGraph";

vi.mock("next/dynamic", () => ({
  default: () => () => <div data-testid="cy-mount">cytoscape</div>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({ wsSlug: "w" }),
}));

function renderWith(data: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(data), { status: 200 })),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="ko" messages={{ graph: koGraph }}>
        <ProjectGraph projectId="p1" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("ProjectGraph", () => {
  it("renders empty state when concept list is empty", async () => {
    renderWith({ nodes: [], edges: [], truncated: false, totalConcepts: 0 });
    expect(await screen.findByText(koGraph.empty.title)).toBeInTheDocument();
  });

  it("mounts cytoscape when there is data", async () => {
    renderWith({
      nodes: [{ id: "n1", name: "A", description: "", degree: 0, noteCount: 0, firstNoteId: null }],
      edges: [],
      truncated: false,
      totalConcepts: 1,
    });
    expect(await screen.findByTestId("cy-mount")).toBeInTheDocument();
  });
});
