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
    expect(screen.getAllByTestId(/board-node-/)).toHaveLength(2);
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
    const node = screen.getByTestId("board-node-11111111-1111-4111-8111-111111111111");
    const before = node.getAttribute("style");
    fireEvent.pointerDown(node, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(canvas, { clientX: 80, clientY: 40 });
    expect(node.getAttribute("style")).not.toBe(before);
  });

  it("pans the board canvas by dragging empty background", () => {
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
    const viewport = screen.getByTestId("board-viewport");
    viewport.scrollLeft = 90;
    viewport.scrollTop = 50;

    fireEvent.pointerDown(viewport, {
      button: 0,
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(viewport, {
      pointerId: 1,
      clientX: 70,
      clientY: 80,
    });
    fireEvent.pointerUp(viewport, {
      pointerId: 1,
      clientX: 70,
      clientY: 80,
    });

    expect(viewport.scrollLeft).toBe(120);
    expect(viewport.scrollTop).toBe(70);
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
    expect(
      screen
        .getByTestId("board-node-11111111-1111-4111-8111-111111111111")
        .getAttribute("style"),
    ).toContain(
      "left: 120px",
    );
  });

  it("centers the requested root even when another node has higher degree", () => {
    (useProjectGraph as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        viewType: "board",
        layout: "preset",
        rootId: "22222222-2222-4222-8222-222222222222",
        nodes: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            name: "Higher degree",
            degree: 3,
          },
          {
            id: "22222222-2222-4222-8222-222222222222",
            name: "Requested root",
            degree: 1,
          },
          {
            id: "33333333-3333-4333-8333-333333333333",
            name: "Neighbor",
            degree: 1,
          },
        ],
        edges: [
          {
            id: "edge-1",
            sourceId: "11111111-1111-4111-8111-111111111111",
            targetId: "33333333-3333-4333-8333-333333333333",
            relationType: "related",
            weight: 1,
          },
          {
            id: "edge-2",
            sourceId: "22222222-2222-4222-8222-222222222222",
            targetId: "33333333-3333-4333-8333-333333333333",
            relationType: "related",
            weight: 1,
          },
        ],
        truncated: false,
        totalConcepts: 3,
      },
      isLoading: false,
      error: null,
    });
    wrap(<BoardView projectId="p-1" root="22222222-2222-4222-8222-222222222222" />);

    const rootStyle = screen
      .getByTestId("board-node-22222222-2222-4222-8222-222222222222")
      .getAttribute("style");
    const higherDegreeStyle = screen
      .getByTestId("board-node-11111111-1111-4111-8111-111111111111")
      .getAttribute("style");

    expect(rootStyle).toContain("left: 615px");
    expect(rootStyle).toContain("top: 431px");
    expect(higherDegreeStyle).not.toContain("left: 615px");
  });

  it("renders standalone note wiki links on the board", () => {
    (useProjectGraph as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        viewType: "board",
        layout: "preset",
        rootId: null,
        nodes: [],
        edges: [],
        noteLinks: [
          {
            sourceNoteId: "11111111-1111-4111-8111-111111111111",
            sourceTitle: "Source note",
            targetNoteId: "22222222-2222-4222-8222-222222222222",
            targetTitle: "Target note",
          },
        ],
        truncated: false,
        totalConcepts: 0,
      },
      isLoading: false,
      error: null,
    });
    wrap(<BoardView projectId="p-1" />);

    expect(screen.getByText("Source note")).toBeInTheDocument();
    expect(screen.getByText("Target note")).toBeInTheDocument();
    expect(screen.getByTestId("board-edge")).toBeInTheDocument();
    expect(
      screen.getByTestId("board-node-11111111-1111-4111-8111-111111111111"),
    ).toHaveAttribute("data-note", "true");
  });
});
