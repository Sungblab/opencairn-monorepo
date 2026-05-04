import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

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
  suggestions: [
    {
      id: "suggestion-1",
      type: "synthesis_insight" as const,
      payload: { title: "핵심 연결", confidence: 0.82 },
      status: "open",
      createdAt: "2026-05-04T00:05:00.000Z",
      resolvedAt: null,
    },
  ],
  staleAlerts: [
    {
      id: "stale-1",
      noteId: "note-1",
      noteTitle: "첫 노트",
      stalenessScore: 0.42,
      reason: "오래된 근거",
      detectedAt: "2026-05-04T00:10:00.000Z",
      reviewedAt: null,
    },
  ],
  audioFiles: [
    {
      id: "audio-1",
      noteId: "note-1",
      noteTitle: "첫 노트",
      durationSec: 125,
      voices: [{ name: "Host", style: "educational" }],
      createdAt: "2026-05-04T00:15:00.000Z",
      urlPath: "/api/agents/plan8/audio-files/audio-1/file",
    },
  ],
};

const emptyOverview = {
  ...overview,
  launch: { notes: [], concepts: [] },
  agentRuns: [],
  suggestions: [],
  staleAlerts: [],
  audioFiles: [],
};

function setup(locale = "ko") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale={locale} messages={{ agents: messages }}>
        <AgentEntryPointsView projectId="project-1" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

function panelFor(name: string) {
  return screen
    .getByRole("heading", { name })
    .closest("div.flex.min-h-40");
}

function runButtonFor(name: string) {
  const panel = panelFor(name);
  expect(panel).not.toBeNull();
  return within(panel as HTMLElement).getByRole("button", { name: "실행" });
}

describe("AgentEntryPointsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(plan8AgentsApi.overview).mockResolvedValue(overview);
    vi.mocked(plan8AgentsApi.runSynthesis).mockResolvedValue({
      workflowId: "workflow-started",
    });
    vi.mocked(plan8AgentsApi.runCurator).mockResolvedValue({
      workflowId: "curator-workflow",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders loading, launch controls, empty states, and overview rows", async () => {
    setup();

    expect(screen.getByText("에이전트 상태를 불러오는 중입니다.")).toBeInTheDocument();
    expect(await screen.findAllByText("Synthesis")).toHaveLength(2);
    expect(screen.getByText("Curator")).toBeInTheDocument();
    expect(screen.getByText("Connector")).toBeInTheDocument();
    expect(screen.getByText("Staleness")).toBeInTheDocument();
    expect(screen.getByText("Narrator")).toBeInTheDocument();
    expect(screen.getByText("실행 중")).toBeInTheDocument();
    const suggestions = screen
      .getByRole("heading", { name: "Suggestions" })
      .closest("section");
    expect(suggestions).not.toBeNull();
    expect(within(suggestions as HTMLElement).getByText("종합 인사이트")).toBeInTheDocument();
    expect(within(suggestions as HTMLElement).getByText(/title: 핵심 연결/)).toBeInTheDocument();

    const staleAlerts = screen
      .getByRole("heading", { name: "Stale alerts" })
      .closest("section");
    expect(staleAlerts).not.toBeNull();
    expect(within(staleAlerts as HTMLElement).getByText("첫 노트")).toBeInTheDocument();
    expect(within(staleAlerts as HTMLElement).getByText("42%")).toBeInTheDocument();

    const audioFiles = screen
      .getByRole("heading", { name: "Audio files" })
      .closest("section");
    expect(audioFiles).not.toBeNull();
    expect(within(audioFiles as HTMLElement).getByLabelText("첫 노트 오디오")).toHaveAttribute(
      "src",
      "/api/agents/plan8/audio-files/audio-1/file",
    );
  });

  it("launches synthesis with the default selected notes", async () => {
    setup();

    await waitFor(() => {
      expect(screen.getByLabelText("첫 노트")).toBeChecked();
      expect(screen.getByLabelText("둘째 노트")).toBeChecked();
    });

    await screen.findByRole("heading", { name: "Synthesis" });
    fireEvent.click(runButtonFor("Synthesis"));

    await waitFor(() => {
      expect(plan8AgentsApi.runSynthesis).toHaveBeenCalledWith({
        projectId: "project-1",
        noteIds: ["note-1", "note-2"],
        title: "종합 노트",
      });
    });
  });

  it("disables launches that need selected notes or concepts", async () => {
    vi.mocked(plan8AgentsApi.overview).mockResolvedValue(emptyOverview);
    setup();

    await waitFor(() => {
      expect(screen.getAllByText("선택할 노트가 없습니다.")).toHaveLength(2);
    });
    expect(runButtonFor("Synthesis")).toBeDisabled();
    expect(runButtonFor("Curator")).toBeEnabled();
    expect(runButtonFor("Connector")).toBeDisabled();
    expect(runButtonFor("Staleness")).toBeEnabled();
    expect(runButtonFor("Narrator")).toBeDisabled();
  });

  it("shows a success toast and invalidates after launch", async () => {
    setup();

    await screen.findByRole("heading", { name: "Curator" });
    fireEvent.click(runButtonFor("Curator"));

    await waitFor(() => {
      expect(plan8AgentsApi.runCurator).toHaveBeenCalledWith({
        projectId: "project-1",
      });
    });
    expect(toast.success).toHaveBeenCalledWith("Curator 실행을 시작했습니다.", {
      description: "curator-workflow",
    });
    await waitFor(() => {
      expect(plan8AgentsApi.overview).toHaveBeenCalledTimes(2);
    });
  });

  it("opens a run detail drawer with workflow metadata and output links", async () => {
    setup();

    await screen.findByRole("heading", { name: "Synthesis" });
    fireEvent.click(screen.getByRole("button", { name: "run-1" }));

    expect(
      await screen.findByRole("heading", { name: "Synthesis 실행 상세" }),
    ).toBeInTheDocument();
    expect(screen.getByText("wf-1")).toBeInTheDocument();
    expect(screen.getAllByText("run-1")).toHaveLength(2);
    expect(
      screen.getByRole("link", { name: "Suggestions 보기" }),
    ).toHaveAttribute("href", "#plan8-suggestions");
    expect(
      screen.getByRole("button", { name: "실행 취소" }),
    ).toBeDisabled();
  });

  it("polls the overview while a non-terminal run is selected", async () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    setup();

    await screen.findByRole("heading", { name: "Synthesis" });
    fireEvent.click(screen.getByRole("button", { name: "run-1" }));

    await waitFor(() => {
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5000);
    });
  });

  it("retries a selected run through the current launch endpoint", async () => {
    setup();

    await screen.findByRole("heading", { name: "Synthesis" });
    fireEvent.click(screen.getByRole("button", { name: "run-1" }));
    fireEvent.click(await screen.findByRole("button", { name: "다시 실행" }));

    await waitFor(() => {
      expect(plan8AgentsApi.runSynthesis).toHaveBeenCalledWith({
        projectId: "project-1",
        noteIds: ["note-1", "note-2"],
        title: "종합 노트",
      });
    });
  });

  it("shows an error toast when launch fails", async () => {
    vi.mocked(plan8AgentsApi.runCurator).mockRejectedValueOnce(
      new Error("boom"),
    );
    setup();

    await screen.findByRole("heading", { name: "Curator" });
    fireEvent.click(runButtonFor("Curator"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "에이전트 실행을 시작하지 못했습니다.",
      );
    });
  });
});
