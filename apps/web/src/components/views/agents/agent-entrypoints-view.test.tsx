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
import { importJobsApi, plan8AgentsApi, workflowConsoleApi } from "@/lib/api-client";
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
    runLibrarian: vi.fn(),
    runSynthesis: vi.fn(),
    runCurator: vi.fn(),
    runConnector: vi.fn(),
    runStaleness: vi.fn(),
    runNarrator: vi.fn(),
    resolveSuggestion: vi.fn(),
    reviewStaleAlert: vi.fn(),
  },
  workflowConsoleApi: {
    list: vi.fn(),
  },
  importJobsApi: {
    retry: vi.fn(),
    cancel: vi.fn(),
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

const workflowRuns = [
  {
    runId: "agent_action:00000000-0000-4000-8000-000000000050",
    runType: "agent_action" as const,
    sourceId: "00000000-0000-4000-8000-000000000050",
    sourceStatus: "approval_required",
    workspaceId: "workspace-1",
    projectId: "project-1",
    actorUserId: "user-1",
    title: "code_project.install",
    status: "approval_required" as const,
    risk: "external" as const,
    outputs: [
      {
        outputType: "log" as const,
        id: "install-log",
        label: "Dependency install",
        metadata: {
          packageManager: "pnpm",
          installed: [
            { name: "zod", version: "3.25.0" },
            { name: "@vitejs/plugin-react" },
          ],
          exitCode: 0,
        },
      },
    ],
    approvals: [],
    error: null,
    createdAt: "2026-05-04T00:20:00.000Z",
    updatedAt: "2026-05-04T00:20:00.000Z",
    completedAt: null,
  },
  {
    runId: "import:00000000-0000-4000-8000-000000000060",
    runType: "import" as const,
    sourceId: "00000000-0000-4000-8000-000000000060",
    sourceStatus: "failed",
    workspaceId: "workspace-1",
    projectId: "project-1",
    actorUserId: "user-1",
    title: "Import google_drive",
    status: "failed" as const,
    risk: "external" as const,
    outputs: [],
    approvals: [],
    error: { code: "import_failed", retryable: true, message: "Grant expired" },
    createdAt: "2026-05-04T00:25:00.000Z",
    updatedAt: "2026-05-04T00:26:00.000Z",
    completedAt: "2026-05-04T00:26:00.000Z",
  },
  {
    runId: "import:00000000-0000-4000-8000-000000000061",
    runType: "import" as const,
    sourceId: "00000000-0000-4000-8000-000000000061",
    sourceStatus: "running",
    workspaceId: "workspace-1",
    projectId: "project-1",
    actorUserId: "user-1",
    title: "Import notion_zip",
    status: "running" as const,
    risk: "external" as const,
    outputs: [],
    approvals: [],
    error: null,
    createdAt: "2026-05-04T00:27:00.000Z",
    updatedAt: "2026-05-04T00:28:00.000Z",
    completedAt: null,
  },
];

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
    vi.mocked(plan8AgentsApi.runLibrarian).mockResolvedValue({
      workflowId: "librarian-workflow",
    });
    vi.mocked(plan8AgentsApi.runSynthesis).mockResolvedValue({
      workflowId: "workflow-started",
    });
    vi.mocked(plan8AgentsApi.runCurator).mockResolvedValue({
      workflowId: "curator-workflow",
    });
    vi.mocked(plan8AgentsApi.resolveSuggestion).mockResolvedValue({
      ok: true,
      status: "accepted",
    });
    vi.mocked(plan8AgentsApi.reviewStaleAlert).mockResolvedValue({
      ok: true,
    });
    vi.mocked(importJobsApi.retry).mockResolvedValue({
      jobId: "00000000-0000-4000-8000-000000000062",
      action: null,
    });
    vi.mocked(importJobsApi.cancel).mockResolvedValue({ ok: true });
    vi.mocked(workflowConsoleApi.list).mockImplementation(async (_projectId, options) => {
      const status =
        typeof options === "object" && options ? options.status : undefined;
      const q =
        typeof options === "object" && options && typeof options.q === "string"
          ? options.q.toLowerCase()
          : "";
      return {
        runs: workflowRuns
          .filter((run) => !status || run.status === status)
          .filter((run) => !q || run.title.toLowerCase().includes(q)),
      };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders loading, launch controls, empty states, and overview rows", async () => {
    setup();

    expect(screen.getByText("에이전트 상태를 불러오는 중입니다.")).toBeInTheDocument();
    expect(await screen.findByText("Librarian")).toBeInTheDocument();
    expect(await screen.findAllByText("Synthesis")).toHaveLength(2);
    expect(screen.getByText("Curator")).toBeInTheDocument();
    expect(screen.getByText("Connector")).toBeInTheDocument();
    expect(screen.getByText("Staleness")).toBeInTheDocument();
    expect(screen.getByText("Narrator")).toBeInTheDocument();
    expect(screen.getAllByText("실행 중").length).toBeGreaterThan(0);
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

    expect(await screen.findByRole("heading", { name: "Workflow Console" })).toBeInTheDocument();
    expect(workflowConsoleApi.list).toHaveBeenCalledWith("project-1", {
      limit: 25,
      status: undefined,
    });
    expect(await screen.findByText("code_project.install")).toBeInTheDocument();
    expect(screen.getByText("Import google_drive")).toBeInTheDocument();
  });

  it("filters Workflow Console runs by failed status", async () => {
    setup();

    await screen.findByRole("heading", { name: "Workflow Console" });
    fireEvent.click(screen.getByRole("button", { name: "실패" }));

    await waitFor(() => {
      expect(workflowConsoleApi.list).toHaveBeenCalledWith("project-1", {
        limit: 25,
        status: "failed",
      });
    });
    expect(screen.queryByText("code_project.install")).not.toBeInTheDocument();
    expect(await screen.findByText("Import google_drive")).toBeInTheDocument();
    expect(screen.getByText("Grant expired")).toBeInTheDocument();
  });

  it("searches Workflow Console runs through the API", async () => {
    setup();

    await screen.findByRole("heading", { name: "Workflow Console" });
    fireEvent.change(screen.getByPlaceholderText("실행 검색"), {
      target: { value: "install" },
    });

    await waitFor(() => {
      expect(workflowConsoleApi.list).toHaveBeenCalledWith("project-1", {
        limit: 25,
        status: undefined,
        q: "install",
      });
    });
    expect(await screen.findByText("code_project.install")).toBeInTheDocument();
    expect(screen.queryByText("Import google_drive")).not.toBeInTheDocument();
  });

  it("shows Workflow Console output metadata for log outputs", async () => {
    setup();

    await screen.findByRole("heading", { name: "Workflow Console" });

    expect(screen.getByText("Dependency install")).toBeInTheDocument();
    expect(screen.getByText("pnpm")).toBeInTheDocument();
    expect(screen.getByText("zod@3.25.0, @vitejs/plugin-react")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("retries a failed import from the Workflow Console row", async () => {
    setup();

    await screen.findByText("Import google_drive");
    fireEvent.click(screen.getByRole("button", { name: "가져오기 다시 시도" }));

    await waitFor(() => {
      expect(importJobsApi.retry).toHaveBeenCalledWith(
        "00000000-0000-4000-8000-000000000060",
      );
    });
    expect(toast.success).toHaveBeenCalledWith("가져오기를 다시 시작했습니다.");
  });

  it("cancels a running import from the Workflow Console row", async () => {
    setup();

    await screen.findByText("Import notion_zip");
    fireEvent.click(screen.getByRole("button", { name: "가져오기 취소" }));

    await waitFor(() => {
      expect(importJobsApi.cancel).toHaveBeenCalledWith(
        "00000000-0000-4000-8000-000000000061",
      );
    });
    expect(toast.success).toHaveBeenCalledWith("가져오기를 취소했습니다.");
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
    expect(runButtonFor("Librarian")).toBeEnabled();
    expect(runButtonFor("Curator")).toBeEnabled();
    expect(runButtonFor("Connector")).toBeDisabled();
    expect(runButtonFor("Staleness")).toBeEnabled();
    expect(runButtonFor("Narrator")).toBeDisabled();
  });

  it("shows a success toast and invalidates after launch", async () => {
    setup();

    await screen.findByRole("heading", { name: "Librarian" });
    fireEvent.click(runButtonFor("Librarian"));

    await waitFor(() => {
      expect(plan8AgentsApi.runLibrarian).toHaveBeenCalledWith({
        projectId: "project-1",
      });
    });
    expect(toast.success).toHaveBeenCalledWith("Librarian 실행을 시작했습니다.", {
      description: "librarian-workflow",
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

  it("resolves suggestions and refreshes the overview", async () => {
    setup();

    const suggestions = (await screen.findByRole("heading", {
      name: "Suggestions",
    })).closest("section");
    expect(suggestions).not.toBeNull();
    fireEvent.click(
      within(suggestions as HTMLElement).getByRole("button", {
        name: "제안 수락",
      }),
    );

    await waitFor(() => {
      expect(plan8AgentsApi.resolveSuggestion).toHaveBeenCalledWith(
        "suggestion-1",
        "accepted",
      );
    });
    expect(toast.success).toHaveBeenCalledWith("제안을 수락했습니다.");
    await waitFor(() => {
      expect(plan8AgentsApi.overview).toHaveBeenCalledTimes(2);
    });
  });

  it("marks stale alerts reviewed and refreshes the overview", async () => {
    setup();

    const staleAlerts = (await screen.findByRole("heading", {
      name: "Stale alerts",
    })).closest("section");
    expect(staleAlerts).not.toBeNull();
    fireEvent.click(
      within(staleAlerts as HTMLElement).getByRole("button", {
        name: "검토 완료",
      }),
    );

    await waitFor(() => {
      expect(plan8AgentsApi.reviewStaleAlert).toHaveBeenCalledWith("stale-1");
    });
    expect(toast.success).toHaveBeenCalledWith(
      "오래된 노트 알림을 검토 완료로 표시했습니다.",
    );
    await waitFor(() => {
      expect(plan8AgentsApi.overview).toHaveBeenCalledTimes(2);
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
