import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import messages from "../../../../messages/ko/agents.json";
import { plan8AgentsApi } from "@/lib/api-client";
import { AgentEntryPointsView } from "./agent-entrypoints-view";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/api-client", () => ({
  plan8AgentsApi: {
    overview: vi.fn(),
    runSynthesis: vi.fn(),
    runCurator: vi.fn(),
    runConnector: vi.fn(),
    runStaleness: vi.fn(),
    runNarrator: vi.fn(),
  },
}));

const overview = {
  project: { id: "project-1", workspaceId: "workspace-1" },
  launch: {
    notes: [
      {
        id: "note-1",
        title: "첫 노트",
        type: "note" as const,
        updatedAt: "2026-05-04T00:00:00.000Z",
      },
      {
        id: "note-2",
        title: "둘째 노트",
        type: "wiki" as const,
        updatedAt: "2026-05-04T00:00:00.000Z",
      },
    ],
    concepts: [
      {
        id: "concept-1",
        name: "검색 증강",
        description: null,
        createdAt: "2026-05-04T00:00:00.000Z",
      },
    ],
  },
  agentRuns: [
    {
      runId: "run-1",
      agentName: "synthesis" as const,
      workflowId: "wf-1",
      status: "running",
      startedAt: "2026-05-04T00:00:00.000Z",
      endedAt: null,
      totalCostKrw: 0,
      errorMessage: null,
    },
  ],
  suggestions: [],
  staleAlerts: [],
  audioFiles: [],
};

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="ko" messages={{ agents: messages }}>
        <AgentEntryPointsView projectId="project-1" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("AgentEntryPointsView", () => {
  beforeEach(() => {
    vi.mocked(plan8AgentsApi.overview).mockResolvedValue(overview);
    vi.mocked(plan8AgentsApi.runSynthesis).mockResolvedValue({
      workflowId: "workflow-started",
    });
  });

  it("renders Plan8 launch controls and existing runs", async () => {
    setup();

    expect(await screen.findAllByText("Synthesis")).toHaveLength(2);
    expect(screen.getByText("Curator")).toBeInTheDocument();
    expect(screen.getByText("Connector")).toBeInTheDocument();
    expect(screen.getByText("Staleness")).toBeInTheDocument();
    expect(screen.getByText("Narrator")).toBeInTheDocument();
    expect(screen.getByText("실행 중")).toBeInTheDocument();
  });

  it("launches synthesis with the default selected notes", async () => {
    setup();

    await waitFor(() => {
      expect(screen.getByLabelText("첫 노트")).toBeChecked();
      expect(screen.getByLabelText("둘째 노트")).toBeChecked();
    });

    const runButtons = await screen.findAllByRole("button", { name: "실행" });
    fireEvent.click(runButtons[0]);

    await waitFor(() => {
      expect(plan8AgentsApi.runSynthesis).toHaveBeenCalledWith({
        projectId: "project-1",
        noteIds: ["note-1", "note-2"],
        title: "종합 노트",
      });
    });
  });
});
