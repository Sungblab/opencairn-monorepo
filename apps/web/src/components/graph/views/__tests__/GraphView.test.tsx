import { beforeEach, describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import koGraph from "@/../messages/ko/graph.json";
import GraphView, {
  filterGraphDataForView,
  graphForceTuningForSize,
} from "../GraphView";

const forceGraphMock = vi.hoisted(() => {
  const force = {
    strength: vi.fn(),
    distance: vi.fn(),
  };
  return {
    handle: {
      centerAt: vi.fn(),
      zoom: vi.fn(() => 1),
      zoomToFit: vi.fn(),
      d3Force: vi.fn(() => force),
      d3ReheatSimulation: vi.fn(),
    },
  };
});

vi.mock("next/dynamic", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    default: () =>
      React.forwardRef((props: Record<string, unknown>, ref) => {
        React.useImperativeHandle(ref, () => forceGraphMock.handle);
        return React.createElement(
          "div",
          {
            "data-testid": "force-graph-mount",
            "data-node-count": Array.isArray(
              (props.graphData as { nodes?: unknown[] } | undefined)?.nodes,
            )
              ? (props.graphData as { nodes: unknown[] }).nodes.length
              : 0,
          },
          "force graph",
        );
      }),
  };
});

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
  beforeEach(() => {
    forceGraphMock.handle.centerAt.mockClear();
    forceGraphMock.handle.zoom.mockClear();
    forceGraphMock.handle.zoomToFit.mockClear();
    forceGraphMock.handle.d3Force.mockClear();
    forceGraphMock.handle.d3ReheatSimulation.mockClear();
    searchParams = new URLSearchParams();
  });

  it("spreads small default graphs instead of letting chain data collapse into a line", () => {
    const small = graphForceTuningForSize({ nodeCount: 15, linkCount: 14 });
    const large = graphForceTuningForSize({ nodeCount: 90, linkCount: 120 });

    expect(small.chargeStrength).toBeLessThan(large.chargeStrength);
    expect(small.linkDistance).toBeGreaterThan(large.linkDistance);
    expect(small.centerStrength).toBeGreaterThan(large.centerStrength);
    expect(small.homeStrength).toBeGreaterThan(large.homeStrength);
    expect(small.collisionPadding).toBeGreaterThan(large.collisionPadding);
  });

  it("fits the rendered graph into the canvas on first paint", async () => {
    renderWith({
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
          id: "33333333-3333-4333-8333-333333333333",
          sourceId: "11111111-1111-4111-8111-111111111111",
          targetId: "22222222-2222-4222-8222-222222222222",
          relationType: "supports",
          weight: 1,
        },
      ],
      truncated: false,
      totalConcepts: 2,
    });

    expect(await screen.findByTestId("force-graph-mount")).toBeInTheDocument();
    await waitFor(() => {
      expect(forceGraphMock.handle.zoomToFit).toHaveBeenCalledWith(500, 56);
    });
  });

  it("exposes Obsidian-style canvas controls for fitting, zooming, and reset", async () => {
    renderWith({
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
          id: "33333333-3333-4333-8333-333333333333",
          sourceId: "11111111-1111-4111-8111-111111111111",
          targetId: "22222222-2222-4222-8222-222222222222",
          relationType: "supports",
          weight: 1,
        },
      ],
      truncated: false,
      totalConcepts: 2,
    });

    expect(await screen.findByTestId("force-graph-mount")).toBeInTheDocument();
    await waitFor(() => {
      expect(forceGraphMock.handle.zoomToFit).toHaveBeenCalled();
    });
    forceGraphMock.handle.zoomToFit.mockClear();
    forceGraphMock.handle.zoom.mockClear();
    forceGraphMock.handle.centerAt.mockClear();

    fireEvent.click(screen.getByRole("button", { name: koGraph.controls.fit }));
    expect(forceGraphMock.handle.zoomToFit).toHaveBeenCalledWith(500, 56);

    fireEvent.click(screen.getByRole("button", { name: koGraph.controls.zoomIn }));
    expect(forceGraphMock.handle.zoom).toHaveBeenCalledWith(1.2, 220);

    fireEvent.click(screen.getByRole("button", { name: koGraph.controls.reset }));
    expect(forceGraphMock.handle.centerAt).toHaveBeenCalledWith(0, 0, 350);
    expect(forceGraphMock.handle.zoom).toHaveBeenCalledWith(1, 350);
  });

  it("filters explicit note links with the graph search", () => {
    const filtered = filterGraphDataForView(
      {
        nodes: [
          {
            id: "concept-alpha",
            name: "Alpha",
            description: "",
            degree: 0,
            noteCount: 0,
            firstNoteId: null,
          },
          {
            id: "concept-beta",
            name: "Beta",
            description: "",
            degree: 0,
            noteCount: 0,
            firstNoteId: null,
          },
        ],
        edges: [],
        noteLinks: [
          {
            sourceNoteId: "note-alpha-source",
            sourceTitle: "Alpha source",
            targetNoteId: "note-alpha-target",
            targetTitle: "Alpha target",
          },
          {
            sourceNoteId: "note-other-source",
            sourceTitle: "Other source",
            targetNoteId: "note-other-target",
            targetTitle: "Other target",
          },
        ],
        viewType: "graph",
        layout: "fcose",
        rootId: null,
        truncated: false,
        totalConcepts: 2,
      },
      { search: "alpha", relation: null },
    );

    expect(filtered.nodes.map((node) => node.id)).toEqual(["concept-alpha"]);
    expect(filtered.noteLinks).toEqual([
      {
        sourceNoteId: "note-alpha-source",
        sourceTitle: "Alpha source",
        targetNoteId: "note-alpha-target",
        targetTitle: "Alpha target",
      },
    ]);
  });

  it("removes explicit note links when relation filter excludes wiki links", () => {
    const filtered = filterGraphDataForView(
      {
        nodes: [],
        edges: [],
        noteLinks: [
          {
            sourceNoteId: "note-alpha-source",
            sourceTitle: "Alpha source",
            targetNoteId: "note-alpha-target",
            targetTitle: "Alpha target",
          },
        ],
        viewType: "graph",
        layout: "fcose",
        rootId: null,
        truncated: false,
        totalConcepts: 0,
      },
      { search: "", relation: "supports" },
    );

    expect(filtered.noteLinks).toEqual([]);
  });

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
      qc.setQueryData(["project-graph", "p1", "graph", null, null], {
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

  it("mounts the force graph when only explicit wiki note links exist", async () => {
    searchParams = new URLSearchParams();
    renderWith({
      nodes: [],
      edges: [],
      noteLinks: [
        {
          sourceNoteId: "note-source",
          sourceTitle: "Lecture2: Input_Output",
          targetNoteId: "note-target",
          targetTitle: "Lecture3: Memory",
        },
      ],
      viewType: "graph",
      layout: "fcose",
      rootId: null,
      truncated: false,
      totalConcepts: 0,
    });

    expect(await screen.findByTestId("force-graph-mount")).toBeInTheDocument();
    expect(screen.queryByText(koGraph.empty.title)).not.toBeInTheDocument();
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
