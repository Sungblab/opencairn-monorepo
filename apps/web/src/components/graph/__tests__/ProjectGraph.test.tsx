import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { ProjectGraph } from "../ProjectGraph";
import koGraph from "@/../messages/ko/graph.json";
import { plan8AgentsApi, projectsApi } from "@/lib/api-client";
import { useRouter, useSearchParams } from "next/navigation";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  projectsApi: {
    wikiIndex: vi.fn(async () => ({
      projectId: "p-1",
      generatedAt: "2026-05-13T01:00:00.000Z",
      latestPageUpdatedAt: "2026-05-13T01:00:00.000Z",
      totals: { pages: 4, wikiLinks: 2, orphanPages: 1 },
      health: {
        status: "needs_attention",
        issues: [
          {
            kind: "unresolved_missing",
            severity: "warning",
            count: 1,
            sampleTitles: ["Broken source"],
          },
        ],
      },
      links: [],
      unresolvedLinks: [],
      recentLogs: [],
      pages: [],
    })),
    permissions: vi.fn(async () => ({ role: "editor", overrides: {} })),
    refreshWikiIndex: vi.fn(async () => ({
      projectId: "p-1",
      queuedNoteAnalysisJobs: 2,
      skippedNotes: 0,
      limit: 100,
      noteIds: ["n1", "n2"],
    })),
  },
  plan8AgentsApi: {
    runLibrarian: vi.fn(async () => ({ workflowId: "librarian-workflow" })),
  },
}));

vi.mock("../ViewSwitcher", () => ({
  ViewSwitcher: ({ onAiClick }: { onAiClick: () => void }) => (
    <button data-testid="switcher-ai" onClick={onAiClick}>
      ai
    </button>
  ),
}));
vi.mock("../ViewRenderer", () => ({
  ViewRenderer: ({ projectId }: { projectId: string }) => (
    <div data-testid="renderer">{projectId}</div>
  ),
}));
vi.mock("../ai/VisualizeDialog", () => ({
  VisualizeDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="dialog" /> : null,
}));

function wrap(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="ko" messages={{ graph: koGraph }}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("ProjectGraph (assembled)", () => {
  beforeEach(() => {
    (useRouter as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      replace: vi.fn(),
    });
    (useSearchParams as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      new URLSearchParams(),
    );
  });

  it("mounts ViewSwitcher + ViewRenderer with projectId", () => {
    wrap(<ProjectGraph projectId="p-1" />);
    expect(screen.getByTestId("renderer").textContent).toBe("p-1");
    expect(screen.getByTestId("switcher-ai")).toBeInTheDocument();
  });

  it("AI button opens VisualizeDialog", async () => {
    wrap(<ProjectGraph projectId="p-1" />);
    expect(screen.queryByTestId("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("switcher-ai"));
    expect(await screen.findByTestId("dialog")).toBeInTheDocument();
  });

  it("surfaces wiki health recovery controls in the graph workspace", async () => {
    wrap(<ProjectGraph projectId="p-1" />);

    expect(await screen.findByTestId("project-graph-wiki-health")).toHaveTextContent(
      koGraph.health.status.needs_attention,
    );
    await userEvent.click(
      screen.getByRole("button", { name: koGraph.health.refresh }),
    );
    expect(projectsApi.refreshWikiIndex).toHaveBeenCalledWith("p-1");
    await userEvent.click(
      screen.getByRole("button", { name: koGraph.health.runLibrarian }),
    );
    expect(plan8AgentsApi.runLibrarian).toHaveBeenCalledWith({ projectId: "p-1" });
  });

  it("surfaces recent wiki activity in the graph workspace", async () => {
    (projectsApi.wikiIndex as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      projectId: "p-1",
      generatedAt: "2026-05-13T01:00:00.000Z",
      latestPageUpdatedAt: "2026-05-13T01:00:00.000Z",
      totals: { pages: 4, wikiLinks: 2, orphanPages: 0 },
      health: { status: "healthy", issues: [] },
      links: [],
      unresolvedLinks: [],
      recentLogs: [
        {
          noteId: "n1",
          noteTitle: "Compiler",
          agent: "agent-actions",
          action: "update",
          reason: "agent note.rename applied",
          createdAt: "2026-05-13T01:02:00.000Z",
        },
      ],
      pages: [],
    });

    wrap(<ProjectGraph projectId="p-1" />);

    expect(await screen.findByTestId("project-graph-wiki-health")).toHaveTextContent(
      `${koGraph.health.recentActivity}: Compiler - agent note.rename applied`,
    );
  });
});
