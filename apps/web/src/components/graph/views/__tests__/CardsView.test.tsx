import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import koGraph from "@/../messages/ko/graph.json";
import CardsView from "../CardsView";

vi.mock("../../useProjectGraph", () => ({ useProjectGraph: vi.fn() }));

// Hoisted mock — vi.mock is hoisted above the import below, so we declare
// the spy via vi.hoisted so it stays referentially stable.
const tabsAddOrReplace = vi.hoisted(() => vi.fn());
vi.mock("@/stores/tabs-store", () => ({
  useTabsStore: (sel: (s: { addOrReplacePreview: typeof tabsAddOrReplace }) => unknown) =>
    sel({ addOrReplacePreview: tabsAddOrReplace }),
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

describe("CardsView", () => {
  it("renders empty state when total=0", () => {
    (useProjectGraph as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        nodes: [],
        edges: [],
        rootId: null,
        viewType: "cards",
        layout: "preset",
        truncated: false,
        totalConcepts: 0,
      },
      isLoading: false,
      error: null,
    });
    wrap(<CardsView projectId="p-1" />);
    expect(screen.getByText(koGraph.views.noConcepts)).toBeInTheDocument();
  });

  it("renders one card per node with name + description", () => {
    (useProjectGraph as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        viewType: "cards",
        layout: "preset",
        rootId: null,
        nodes: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            name: "Trans",
            description: "model",
          },
          {
            id: "22222222-2222-4222-8222-222222222222",
            name: "BERT",
            description: "encoder",
          },
        ],
        edges: [],
        truncated: false,
        totalConcepts: 2,
      },
      isLoading: false,
      error: null,
    });
    wrap(<CardsView projectId="p-1" />);
    expect(screen.getByText("Trans")).toBeInTheDocument();
    expect(screen.getByText("BERT")).toBeInTheDocument();
    expect(screen.getByText("model")).toBeInTheDocument();
  });

  it("renders evidence-backed card citation metadata", () => {
    (useProjectGraph as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        viewType: "cards",
        layout: "preset",
        rootId: null,
        nodes: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            name: "Trans",
            description: "model",
          },
        ],
        edges: [],
        cards: [
          {
            id: "99999999-9999-4999-8999-999999999999",
            conceptId: "11111111-1111-4111-8111-111111111111",
            title: "Trans",
            summary: "Attention links tokens.",
            evidenceBundleId: "33333333-3333-4333-8333-333333333333",
            citationCount: 2,
          },
        ],
        evidenceBundles: [
          {
            id: "33333333-3333-4333-8333-333333333333",
            workspaceId: "44444444-4444-4444-8444-444444444444",
            projectId: "55555555-5555-4555-8555-555555555555",
            purpose: "card_summary",
            producer: { kind: "api" },
            createdBy: null,
            createdAt: "2026-05-01T00:00:00.000Z",
            entries: [
              {
                noteChunkId: "11111111-1111-4111-8111-111111111111",
                noteId: "22222222-2222-4222-8222-222222222222",
                noteType: "source",
                sourceType: "pdf",
                headingPath: "Intro",
                sourceOffsets: { start: 0, end: 20 },
                score: 0.8,
                rank: 1,
                retrievalChannel: "vector",
                quote: "Attention links tokens.",
                citation: { label: "S1", title: "Transformer Paper" },
                metadata: {},
              },
            ],
          },
        ],
        truncated: false,
        totalConcepts: 1,
      },
      isLoading: false,
      error: null,
    });
    wrap(<CardsView projectId="p-1" />);
    expect(screen.getAllByText("Attention links tokens.").length).toBeGreaterThan(0);
    expect(screen.getByText("근거 2개")).toBeInTheDocument();
    expect(screen.getByText("Transformer Paper")).toBeInTheDocument();
  });

  it("clicking a card with firstNoteId opens preview tab", () => {
    tabsAddOrReplace.mockClear();
    (useProjectGraph as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        viewType: "cards",
        layout: "preset",
        rootId: null,
        nodes: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            name: "Trans",
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
    wrap(<CardsView projectId="p-1" />);
    fireEvent.click(screen.getByText("Trans"));
    expect(tabsAddOrReplace).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "note",
        targetId: "33333333-3333-4333-8333-333333333333",
        mode: "plate",
      }),
    );
  });
});
