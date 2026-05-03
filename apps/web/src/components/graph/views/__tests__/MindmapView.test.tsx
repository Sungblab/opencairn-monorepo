import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import koGraph from "@/../messages/ko/graph.json";
import MindmapView from "../MindmapView";

// Replace next/dynamic with a synchronous stub so the assertion can read the
// resolved `layout.name` prop without booting cytoscape's canvas renderer.
// Returning a constant component sidesteps both the async hydration in jsdom
// and the canvas-not-implemented warning from real react-cytoscapejs.
vi.mock("next/dynamic", () => ({
  default: () => (props: {
    elements?: unknown;
    layout?: { name: string };
    stylesheet?: unknown;
  }) => (
    <div
      data-testid="cy"
      data-elements={JSON.stringify(props.elements)}
      data-layout={props.layout?.name}
      data-stylesheet={JSON.stringify(props.stylesheet)}
    />
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
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

describe("MindmapView", () => {
  it("renders 'needsRoot' empty state when data has no nodes", () => {
    (useProjectGraph as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        nodes: [],
        edges: [],
        rootId: null,
        viewType: "mindmap",
        layout: "dagre",
        truncated: false,
        totalConcepts: 0,
      },
      isLoading: false,
      error: null,
    });
    wrap(<MindmapView projectId="p-1" />);
    expect(screen.getByText(koGraph.views.needsRoot)).toBeInTheDocument();
  });

  it("renders cytoscape with layout=dagre when nodes exist", () => {
    (useProjectGraph as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        viewType: "mindmap",
        layout: "dagre",
        rootId: "11111111-1111-4111-8111-111111111111",
        nodes: [
          { id: "11111111-1111-4111-8111-111111111111", name: "Root" },
        ],
        edges: [],
        truncated: false,
        totalConcepts: 1,
      },
      isLoading: false,
      error: null,
    });
    wrap(
      <MindmapView
        projectId="p-1"
        root="11111111-1111-4111-8111-111111111111"
      />,
    );
    expect(screen.getByTestId("cy").getAttribute("data-layout")).toBe(
      "dagre",
    );
  });

  it("uses relation-aware fallback edge ids for parallel edges", () => {
    (useProjectGraph as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        viewType: "mindmap",
        layout: "dagre",
        rootId: "11111111-1111-4111-8111-111111111111",
        nodes: [
          { id: "11111111-1111-4111-8111-111111111111", name: "Root" },
          { id: "22222222-2222-4222-8222-222222222222", name: "Child" },
        ],
        edges: [
          {
            sourceId: "11111111-1111-4111-8111-111111111111",
            targetId: "22222222-2222-4222-8222-222222222222",
            relationType: "supports",
            weight: 1,
          },
          {
            sourceId: "11111111-1111-4111-8111-111111111111",
            targetId: "22222222-2222-4222-8222-222222222222",
            relationType: "contradicts",
            weight: 1,
          },
        ],
        truncated: false,
        totalConcepts: 2,
      },
      isLoading: false,
      error: null,
    });
    wrap(
      <MindmapView
        projectId="p-1"
        root="11111111-1111-4111-8111-111111111111"
      />,
    );
    const elements = JSON.parse(
      screen.getByTestId("cy").getAttribute("data-elements") ?? "[]",
    ) as Array<{ data: { id: string; type: string } }>;
    expect(
      elements
        .filter((element) => element.data.type === "edge")
        .map((element) => element.data.id),
    ).toEqual([
      "11111111-1111-4111-8111-111111111111->22222222-2222-4222-8222-222222222222:supports",
      "11111111-1111-4111-8111-111111111111->22222222-2222-4222-8222-222222222222:contradicts",
    ]);
  });

  it("keeps weak and missing support styles distinct", () => {
    (useProjectGraph as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        viewType: "mindmap",
        layout: "dagre",
        rootId: "11111111-1111-4111-8111-111111111111",
        nodes: [
          { id: "11111111-1111-4111-8111-111111111111", name: "Root" },
        ],
        edges: [],
        truncated: false,
        totalConcepts: 1,
      },
      isLoading: false,
      error: null,
    });
    wrap(
      <MindmapView
        projectId="p-1"
        root="11111111-1111-4111-8111-111111111111"
      />,
    );
    const stylesheet = JSON.parse(
      screen.getByTestId("cy").getAttribute("data-stylesheet") ?? "[]",
    ) as Array<{ selector: string; style: { "line-style"?: string } }>;
    expect(
      stylesheet.find(
        (style) => style.selector === 'edge[supportStatus = "weak"]',
      )
        ?.style["line-style"],
    ).toBe("dashed");
    expect(
      stylesheet.find(
        (style) => style.selector === 'edge[supportStatus = "missing"]',
      )
        ?.style["line-style"],
    ).toBe("dotted");
  });

  it("calls useProjectGraph with view='mindmap' + root", () => {
    const spy = vi.fn().mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });
    (useProjectGraph as ReturnType<typeof vi.fn>).mockImplementation(spy);
    wrap(<MindmapView projectId="p-1" root="abc" />);
    expect(spy).toHaveBeenCalledWith("p-1", { view: "mindmap", root: "abc" });
  });
});
