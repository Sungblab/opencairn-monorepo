import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import koGraph from "@/../messages/ko/graph.json";
import TimelineView from "../TimelineView";

vi.mock("../../useProjectGraph", () => ({ useProjectGraph: vi.fn() }));

// Hoisted spy so vi.mock's hoisted factory can close over a stable reference.
const openPreview = vi.hoisted(() => vi.fn());
vi.mock("@/stores/tabs-store", () => ({
  useTabsStore: (sel: (s: { addOrReplacePreview: typeof openPreview }) => unknown) =>
    sel({ addOrReplacePreview: openPreview }),
}));

import { useProjectGraph } from "../../useProjectGraph";

function wrap(ui: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <NextIntlClientProvider locale="ko" messages={{ graph: koGraph }}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("TimelineView", () => {
  it("renders empty state when no nodes", () => {
    (useProjectGraph as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        nodes: [],
        edges: [],
        rootId: null,
        viewType: "timeline",
        layout: "preset",
        truncated: false,
        totalConcepts: 0,
      },
      isLoading: false,
      error: null,
    });
    wrap(<TimelineView projectId="p-1" />);
    expect(screen.getByText(koGraph.views.noConcepts)).toBeInTheDocument();
  });

  it("renders 1 SVG circle per node", () => {
    (useProjectGraph as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        viewType: "timeline",
        layout: "preset",
        rootId: null,
        nodes: [
          { id: "a", name: "1", eventYear: 1990 },
          { id: "b", name: "2", eventYear: 2000 },
        ],
        edges: [],
        truncated: false,
        totalConcepts: 2,
      },
      isLoading: false,
      error: null,
    });
    const { container } = wrap(<TimelineView projectId="p-1" />);
    expect(container.querySelectorAll("circle")).toHaveLength(2);
  });

  it("renders standalone note wiki links in the undated lane", () => {
    (useProjectGraph as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        viewType: "timeline",
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
    const { container } = wrap(<TimelineView projectId="p-1" />);

    expect(screen.getAllByText("Source note").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Target note").length).toBeGreaterThan(0);
    expect(screen.getByText(koGraph.timeline.lanes.undated)).toBeInTheDocument();
    expect(container.querySelectorAll("circle.fill-blue-500")).toHaveLength(2);
  });

  it("keeps undated concepts visible in the undated lane", () => {
    (useProjectGraph as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        viewType: "timeline",
        layout: "preset",
        rootId: null,
        nodes: [
          { id: "a", name: "Undated concept" },
          { id: "b", name: "Another undated concept" },
        ],
        edges: [],
        truncated: false,
        totalConcepts: 2,
      },
      isLoading: false,
      error: null,
    });
    wrap(<TimelineView projectId="p-1" />);
    expect(screen.getByText(koGraph.timeline.lanes.undated)).toBeInTheDocument();
    expect(screen.getAllByText("Undated concept").length).toBeGreaterThan(0);
  });

  it("truncates long concept labels while preserving the full title", () => {
    const longName = "Very very long timeline concept label";
    (useProjectGraph as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        viewType: "timeline",
        layout: "preset",
        rootId: null,
        nodes: [{ id: "a", name: longName, eventYear: 2026 }],
        edges: [],
        truncated: false,
        totalConcepts: 1,
      },
      isLoading: false,
      error: null,
    });
    wrap(<TimelineView projectId="p-1" />);
    expect(screen.getByText("Very very long ti...")).toBeInTheDocument();
    expect(screen.getByText(longName)).toBeInTheDocument();
  });

  it("clicking a node with firstNoteId opens preview", () => {
    openPreview.mockClear();
    (useProjectGraph as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        viewType: "timeline",
        layout: "preset",
        rootId: null,
        nodes: [
          {
            id: "a",
            name: "Trans",
            eventYear: 2017,
            firstNoteId: "33333333-3333-4333-8333-333333333333",
          },
        ],
        edges: [],
        truncated: false,
        totalConcepts: 1,
      },
      isLoading: false,
      error: null,
    });
    wrap(<TimelineView projectId="p-1" />);
    fireEvent.click(screen.getAllByText("Trans")[0]);
    expect(openPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: "33333333-3333-4333-8333-333333333333",
      }),
    );
  });

  it("clicking a standalone note-link node opens that note", () => {
    openPreview.mockClear();
    (useProjectGraph as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        viewType: "timeline",
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
    wrap(<TimelineView projectId="p-1" />);
    fireEvent.click(screen.getAllByText("Source note")[0]);
    expect(openPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: "11111111-1111-4111-8111-111111111111",
      }),
    );
  });
});
