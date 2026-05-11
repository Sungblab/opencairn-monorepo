import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import koAtlas from "@/../messages/ko/workspace-atlas.json";
import { WorkspaceAtlasView } from "./workspace-atlas-view";

vi.mock("@/hooks/useWorkspaceId", () => ({
  useWorkspaceId: () => "11111111-1111-4111-8111-111111111111",
}));
vi.mock("cytoscape-fcose", () => ({ default: vi.fn() }));
const cytoscapeMock = vi.hoisted(() => ({
  tapHandler: null as null | ((event: {
    target: { isNode?: () => boolean; id?: () => string };
  }) => void),
}));
vi.mock("react-cytoscapejs", () => ({
  default: (props: {
    elements?: Array<{ data: { id: string; label?: string; source?: string; target?: string } }>;
    layout?: { name: string };
    cy?: (cy: {
      on: (event: string, handler: NonNullable<typeof cytoscapeMock.tapHandler>) => void;
      off: (event: string, handler: NonNullable<typeof cytoscapeMock.tapHandler>) => void;
    }) => void;
  }) => {
    props.cy?.({
      on: (event, handler) => {
        if (event === "tap") cytoscapeMock.tapHandler = handler;
      },
      off: (event, handler) => {
        if (event === "tap" && cytoscapeMock.tapHandler === handler) {
          cytoscapeMock.tapHandler = null;
        }
      },
    });
    return (
      <div data-testid="atlas-graph" data-layout={props.layout?.name}>
        {(props.elements ?? []).map((element) => (
          <span key={element.data.id}>
            {element.data.label ?? `${element.data.source}->${element.data.target}`}
          </span>
        ))}
      </div>
    );
  },
}));

function wrap(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale="ko"
        messages={{ workspaceAtlas: koAtlas }}
      >
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("WorkspaceAtlasView", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    cytoscapeMock.tapHandler = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/projects")) {
          return new Response(
            JSON.stringify([
              { id: "22222222-2222-4222-8222-222222222222", name: "Research" },
            ]),
            { status: 200 },
          );
        }
        if (url.includes("/ontology-atlas/refresh")) {
          return new Response(
            JSON.stringify({
              noteIds: ["44444444-4444-4444-8444-444444444444"],
              queuedNoteAnalysisJobs: 1,
              compilerWorkflowIds: ["compiler-refresh-test"],
              compilerStartFailures: [],
            }),
            { status: 202 },
          );
        }
        return new Response(
          JSON.stringify({
            workspaceId: "11111111-1111-4111-8111-111111111111",
            selection: "bridge-first",
            readableProjectCount: 1,
            totalConcepts: 2,
            truncated: false,
            nodes: [
              {
                id: "note:44444444-4444-4444-8444-444444444444",
                label: "Planning Note",
                objectType: "note",
                layer: "explicit",
                normalizedName: "planning note",
                conceptIds: [],
                sourceNoteIds: ["44444444-4444-4444-8444-444444444444"],
                projectContexts: [
                  {
                    projectId: "22222222-2222-4222-8222-222222222222",
                    projectName: "Research",
                    conceptIds: [],
                    mentionCount: 0,
                  },
                ],
                projectCount: 1,
                mentionCount: 0,
                degree: 1,
                bridge: false,
                duplicateCandidate: false,
                unclassified: false,
                stale: false,
              },
              {
                id: "concept:ai%20agents",
                label: "AI Agents",
                objectType: "concept",
                layer: "ai",
                normalizedName: "ai agents",
                conceptIds: ["33333333-3333-4333-8333-333333333333"],
                sourceNoteIds: ["44444444-4444-4444-8444-444444444444"],
                projectContexts: [
                  {
                    projectId: "22222222-2222-4222-8222-222222222222",
                    projectName: "Research",
                    conceptIds: ["33333333-3333-4333-8333-333333333333"],
                    mentionCount: 1,
                  },
                ],
                projectCount: 1,
                mentionCount: 1,
                degree: 1,
                bridge: false,
                duplicateCandidate: false,
                unclassified: false,
                stale: true,
                freshnessReason: "source_note_changed",
              },
            ],
            edges: [
              {
                id: "wiki:55555555-5555-4555-8555-555555555555",
                sourceId: "note:44444444-4444-4444-8444-444444444444",
                targetId: "concept:ai%20agents",
                edgeType: "wiki_link",
                layer: "explicit",
                relationType: "links-to",
                weight: 1,
                conceptEdgeIds: [],
                sourceNoteIds: ["44444444-4444-4444-8444-444444444444"],
                projectIds: ["22222222-2222-4222-8222-222222222222"],
                crossProject: false,
                stale: false,
              },
            ],
          }),
          { status: 200 },
        );
      }) satisfies typeof fetch,
    );
  });

  it("renders the workspace ontology atlas graph", async () => {
    wrap(<WorkspaceAtlasView wsSlug="acme" />);

    expect(screen.getByText("Ontology Atlas")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId("atlas-graph")).toHaveAttribute(
        "data-layout",
        "fcose",
      );
    });
    expect(screen.getByText("AI Agents")).toBeInTheDocument();
    expect(screen.getByText("Planning Note")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: koAtlas.layers.explicit })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: koAtlas.layers.ai })).toBeInTheDocument();
    expect(screen.getByText(koAtlas.legend.stale)).toBeInTheDocument();
  });

  it("posts stale source notes for explicit re-analysis", async () => {
    wrap(<WorkspaceAtlasView wsSlug="acme" />);

    await waitFor(() => {
      expect(cytoscapeMock.tapHandler).toBeTypeOf("function");
    });
    await act(async () => {
      cytoscapeMock.tapHandler?.({
        target: {
          isNode: () => true,
          id: () => "concept:ai%20agents",
        },
      });
    });

    fireEvent.click(screen.getByRole("button", { name: koAtlas.detail.refresh }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/workspaces/11111111-1111-4111-8111-111111111111/ontology-atlas/refresh",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            noteIds: ["44444444-4444-4444-8444-444444444444"],
          }),
        }),
      );
    });
  });
});
