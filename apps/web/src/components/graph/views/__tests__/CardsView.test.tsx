import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import koGraph from "@/../messages/ko/graph.json";
import CardsView from "../CardsView";

vi.mock("../../useProjectGraph", () => ({ useProjectGraph: vi.fn() }));
vi.mock("cytoscape-fcose", () => ({ default: vi.fn() }));
vi.mock("react-cytoscapejs", () => ({
  default: (props: {
    elements?: Array<{ data: { id: string; label?: string; source?: string; target?: string } }>;
    layout?: { name: string };
  }) => (
    <div data-testid="card-graph" data-layout={props.layout?.name}>
      {(props.elements ?? []).map((element) => (
        <span key={element.data.id}>
          {element.data.label ?? `${element.data.source}->${element.data.target}`}
        </span>
      ))}
    </div>
  ),
}));

const tabsAddOrReplace = vi.hoisted(() => vi.fn());
vi.mock("@/stores/tabs-store", () => ({
  useTabsStore: (sel: (s: { addOrReplacePreview: typeof tabsAddOrReplace }) => unknown) =>
    sel({ addOrReplacePreview: tabsAddOrReplace }),
}));

import { useProjectGraph } from "../../useProjectGraph";

function wrap(ui: ReactNode) {
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

  it("renders connected concept cards through Cytoscape", async () => {
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
            degree: 1,
          },
          {
            id: "22222222-2222-4222-8222-222222222222",
            name: "BERT",
            description: "encoder",
            degree: 1,
          },
        ],
        edges: [
          {
            id: "33333333-3333-4333-8333-333333333333",
            sourceId: "11111111-1111-4111-8111-111111111111",
            targetId: "22222222-2222-4222-8222-222222222222",
            relationType: "depends-on",
            weight: 0.8,
          },
        ],
        truncated: false,
        totalConcepts: 2,
      },
      isLoading: false,
      error: null,
    });
    wrap(<CardsView projectId="p-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("card-graph")).toHaveAttribute(
        "data-layout",
        "fcose",
      );
    });
    expect(screen.getByText("Trans")).toBeInTheDocument();
    expect(screen.getByText("BERT")).toBeInTheDocument();
    expect(screen.getByText("depends-on")).toBeInTheDocument();
  });

  it("uses evidence-backed card titles when available", () => {
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
            title: "Transformer",
            summary: "Attention links tokens.",
            evidenceBundleId: "33333333-3333-4333-8333-333333333333",
            citationCount: 2,
          },
        ],
        truncated: false,
        totalConcepts: 1,
      },
      isLoading: false,
      error: null,
    });
    wrap(<CardsView projectId="p-1" />);
    expect(screen.getByText("Transformer")).toBeInTheDocument();
  });
});
