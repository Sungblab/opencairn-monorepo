import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import koGraph from "@/../messages/ko/graph.json";
import BoardView from "../BoardView";

// Same dynamic-stub trick MindmapView uses: replace next/dynamic with a
// synchronous component so we can read the cytoscape `layout.name` prop
// without booting the canvas renderer.
vi.mock("next/dynamic", () => ({
  default: () => (props: { layout?: { name: string } }) => (
    <div data-testid="cy" data-layout={props.layout?.name} />
  ),
}));

vi.mock("../../useProjectGraph", () => ({
  useProjectGraph: vi.fn(),
}));

import { useProjectGraph } from "../../useProjectGraph";

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="ko" messages={{ graph: koGraph }}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("BoardView", () => {
  it("renders cytoscape with layout=preset when nodes exist", () => {
    (useProjectGraph as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        viewType: "board",
        layout: "preset",
        rootId: null,
        nodes: [
          { id: "11111111-1111-4111-8111-111111111111", name: "n" },
        ],
        edges: [],
        truncated: false,
        totalConcepts: 1,
      },
      isLoading: false,
      error: null,
    });
    wrap(<BoardView projectId="p-1" />);
    expect(screen.getByTestId("cy").getAttribute("data-layout")).toBe(
      "preset",
    );
  });

  it("renders empty state when no nodes", () => {
    (useProjectGraph as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        viewType: "board",
        layout: "preset",
        rootId: null,
        nodes: [],
        edges: [],
        truncated: false,
        totalConcepts: 0,
      },
      isLoading: false,
      error: null,
    });
    wrap(<BoardView projectId="p-1" />);
    expect(screen.getByText(koGraph.views.noConcepts)).toBeInTheDocument();
  });

  it("calls useProjectGraph with view='board' + optional root", () => {
    const spy = vi.fn().mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });
    (useProjectGraph as ReturnType<typeof vi.fn>).mockImplementation(spy);
    wrap(<BoardView projectId="p-1" root="abc" />);
    expect(spy).toHaveBeenCalledWith("p-1", { view: "board", root: "abc" });
  });
});
