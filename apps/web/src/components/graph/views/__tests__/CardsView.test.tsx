import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import koGraph from "@/../messages/ko/graph.json";
import CardsView from "../CardsView";

vi.mock("../../useProjectGraph", () => ({ useProjectGraph: vi.fn() }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ wsSlug: "acme" }),
  useRouter: () => ({ push: vi.fn() }),
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

  it("renders empty state when the cards response is missing after loading", () => {
    (useProjectGraph as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    });
    wrap(<CardsView projectId="p-1" />);
    expect(screen.getByText(koGraph.views.noConcepts)).toBeInTheDocument();
  });

  it("renders the graph load error when card data fails", () => {
    (useProjectGraph as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("boom"),
    });
    wrap(<CardsView projectId="p-1" />);
    expect(screen.getByText(koGraph.errors.loadFailed)).toBeInTheDocument();
  });

  it("renders evidence-backed concept cards as a connected card graph", () => {
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
    const { container } = wrap(<CardsView projectId="p-1" />);
    expect(screen.getByTestId("concept-card-graph")).toBeInTheDocument();
    expect(screen.getByTestId("concept-card-edge")).toBeInTheDocument();
    expect(container.querySelector("canvas")).not.toBeInTheDocument();
    expect(screen.getByText("Trans")).toBeInTheDocument();
    expect(screen.getByText("BERT")).toBeInTheDocument();
    expect(screen.getByText("depends-on")).toBeInTheDocument();
  });

  it("defaults the focused card to the most connected concept, not the newest isolated card", () => {
    (useProjectGraph as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        viewType: "cards",
        layout: "preset",
        rootId: null,
        nodes: [
          {
            id: "99999999-9999-4999-8999-999999999999",
            name: "Newest isolated",
            description: "latest but disconnected",
            degree: 0,
          },
          {
            id: "11111111-1111-4111-8111-111111111111",
            name: "Hub concept",
            description: "connected hub",
            degree: 2,
          },
          {
            id: "22222222-2222-4222-8222-222222222222",
            name: "Neighbor one",
            description: "",
            degree: 1,
          },
          {
            id: "33333333-3333-4333-8333-333333333333",
            name: "Neighbor two",
            description: "",
            degree: 1,
          },
        ],
        edges: [
          {
            id: "44444444-4444-4444-8444-444444444444",
            sourceId: "11111111-1111-4111-8111-111111111111",
            targetId: "22222222-2222-4222-8222-222222222222",
            relationType: "mentions",
            weight: 1,
          },
          {
            id: "55555555-5555-4555-8555-555555555555",
            sourceId: "11111111-1111-4111-8111-111111111111",
            targetId: "33333333-3333-4333-8333-333333333333",
            relationType: "mentions",
            weight: 1,
          },
        ],
        truncated: false,
        totalConcepts: 4,
      },
      isLoading: false,
      error: null,
    });
    wrap(<CardsView projectId="p-1" />);

    expect(
      screen.getByTestId("concept-card-node-11111111-1111-4111-8111-111111111111"),
    ).toHaveAttribute("data-active", "true");
    expect(
      screen.getByTestId("concept-card-node-99999999-9999-4999-8999-999999999999"),
    ).toHaveAttribute("data-active", "false");
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
    expect(screen.getByRole("button", { name: /열기/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /질문/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /퀴즈/ })).toBeInTheDocument();
  });
});
