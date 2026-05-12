import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import koGraph from "@/../messages/ko/graph.json";
import BoardView from "../BoardView";

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
  it("renders a draggable board canvas when nodes exist", () => {
    (useProjectGraph as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        viewType: "board",
        layout: "preset",
        rootId: null,
        nodes: [
          { id: "11111111-1111-4111-8111-111111111111", name: "Hub" },
          { id: "22222222-2222-4222-8222-222222222222", name: "Neighbor" },
        ],
        edges: [
          {
            id: "edge-1",
            sourceId: "11111111-1111-4111-8111-111111111111",
            targetId: "22222222-2222-4222-8222-222222222222",
            relationType: "related",
            weight: 1,
          },
        ],
        truncated: false,
        totalConcepts: 2,
      },
      isLoading: false,
      error: null,
    });
    wrap(<BoardView projectId="p-1" />);
    expect(screen.getByTestId("board-canvas")).toBeInTheDocument();
    expect(screen.getAllByTestId("board-node")).toHaveLength(2);
    expect(screen.getByTestId("board-edge")).toBeInTheDocument();
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

  it("moves a node during pointer drag", () => {
    (useProjectGraph as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        viewType: "board",
        layout: "preset",
        rootId: null,
        nodes: [{ id: "11111111-1111-4111-8111-111111111111", name: "Hub" }],
        edges: [],
        truncated: false,
        totalConcepts: 1,
      },
      isLoading: false,
      error: null,
    });
    wrap(<BoardView projectId="p-1" />);
    const canvas = screen.getByTestId("board-canvas");
    const node = screen.getByTestId("board-node");
    const before = node.getAttribute("style");
    fireEvent.pointerDown(node, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(canvas, { clientX: 80, clientY: 40 });
    expect(node.getAttribute("style")).not.toBe(before);
  });

  it("uses server-provided board positions as the initial placement", () => {
    (useProjectGraph as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        viewType: "board",
        layout: "preset",
        rootId: null,
        nodes: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            name: "Placed",
            position: { x: 120, y: 140 },
          },
        ],
        edges: [],
        truncated: false,
        totalConcepts: 1,
      },
      isLoading: false,
      error: null,
    });
    wrap(<BoardView projectId="p-1" />);
    expect(screen.getByTestId("board-node").getAttribute("style")).toContain(
      "left: 120px",
    );
  });
});
