import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAgentWorkbenchStore } from "@/stores/agent-workbench-store";
import { usePanelStore } from "@/stores/panel-store";
import {
  plan8AgentsApi,
  projectsApi,
  workflowConsoleApi,
} from "@/lib/api-client";
import { ProjectView } from "./project-view";

const mockProjectNotes = vi.hoisted(() => ({
  rows: [] as Array<{
    id: string;
    title: string;
    kind: "manual";
    updated_at: string;
  }>,
}));
const preflightMock = vi.hoisted(() => vi.fn());
const pushMock = vi.hoisted(() => vi.fn());

vi.mock("next-intl", () => ({
  useLocale: () => "ko",
  useTranslations: (ns?: string) => (key: string) =>
    ns ? `${ns}.${key}` : key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: pushMock }),
}));

vi.mock("@/hooks/useWorkspaceId", () => ({
  useWorkspaceId: () => "workspace-1",
}));

vi.mock("@/lib/api-client", () => ({
  projectsApi: {
    get: vi.fn(async () => ({ id: "p1", name: "Project One" })),
    wikiIndex: vi.fn(async () => ({
      projectId: "p1",
      generatedAt: "2026-05-13T00:01:00.000Z",
      latestPageUpdatedAt: "2026-05-13T00:00:00.000Z",
      totals: { pages: 3, wikiLinks: 2, orphanPages: 1 },
      health: {
        status: "blocked",
        issues: [
          {
            kind: "analysis_failed",
            severity: "blocking",
            count: 1,
            sampleTitles: ["Failed analysis note"],
          },
          {
            kind: "unresolved_missing",
            severity: "warning",
            count: 2,
            sampleTitles: ["Broken source"],
          },
        ],
      },
      pages: [],
    })),
    update: vi.fn(async (_id: string, body: { name?: string }) => ({
      id: "p1",
      name: body.name ?? "Project One",
    })),
    permissions: vi.fn(async () => ({ role: "editor", overrides: {} })),
    refreshWikiIndex: vi.fn(async () => ({
      projectId: "p1",
      queuedNoteAnalysisJobs: 3,
      noteIds: ["n1", "n2", "n3"],
    })),
    notes: vi.fn(async () => ({ notes: mockProjectNotes.rows })),
  },
  plan8AgentsApi: {
    runLibrarian: vi.fn(async () => ({ workflowId: "librarian-workflow" })),
  },
  studioToolsApi: {
    preflight: preflightMock,
  },
  studyArtifactsApi: {
    generate: vi.fn(),
  },
  integrationsApi: {
    google: vi.fn(async () => ({
      connected: false,
      accountEmail: null,
      scopes: null,
    })),
  },
  workflowConsoleApi: {
    list: vi.fn(async () => ({ runs: [] })),
  },
}));

vi.mock("./project-meta-row", () => ({
  ProjectMetaRow: ({ name }: { name: string }) => <div>{name}</div>,
}));

vi.mock("./project-notes-table", () => ({
  ProjectNotesTable: ({
    onLoaded,
  }: {
    onLoaded?: (rows: typeof mockProjectNotes.rows) => void;
  }) => {
    queueMicrotask(() => onLoaded?.(mockProjectNotes.rows));
    return <div>notes table</div>;
  },
}));

function renderProjectView() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <ProjectView wsSlug="acme" projectId="p1" />
    </QueryClientProvider>,
  );
}

describe("ProjectView", () => {
  beforeEach(() => {
    localStorage.clear();
    mockProjectNotes.rows = [
      {
        id: "n1",
        title: "Existing note",
        kind: "manual",
        updated_at: new Date().toISOString(),
      },
    ];
    preflightMock.mockReset();
    pushMock.mockReset();
    preflightMock.mockResolvedValue({
      preflight: {
        canStart: true,
        requiresConfirmation: false,
        cost: { billableCredits: 12 },
        balance: { availableCredits: 100, plan: "free" },
      },
    });
    vi.mocked(workflowConsoleApi.list).mockResolvedValue({ runs: [] });
    useAgentWorkbenchStore.setState(
      useAgentWorkbenchStore.getInitialState(),
      true,
    );
    usePanelStore.setState(usePanelStore.getInitialState(), true);
  });

  it("turns the project home into a command center that queues an agent prompt", async () => {
    renderProjectView();

    expect(
      await screen.findByText("project.commandCenter.title"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("project.commandCenter.guided.paperAnalysis.title"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("project.commandCenter.guided.paperDraft.title"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("project.commandCenter.guided.studyPrep.title"),
    ).toBeInTheDocument();

    await userEvent.type(
      screen.getByLabelText("project.commandCenter.inputLabel"),
      "Compare the uploaded paper with our notes",
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: "project.commandCenter.submit",
      }),
    );

    expect(usePanelStore.getState().agentPanelTab).toBe("chat");
    expect(useAgentWorkbenchStore.getState().pendingWorkflow).toMatchObject({
      kind: "agent_prompt",
      toolId: "project_command_center",
      prompt: "Compare the uploaded paper with our notes",
    });
    expect(workflowConsoleApi.list).toHaveBeenCalledWith("p1", 10);
  });

  it("submits the command center prompt with Enter and preserves Shift+Enter for new lines", async () => {
    renderProjectView();

    const input = await screen.findByLabelText(
      "project.commandCenter.inputLabel",
    );
    await userEvent.type(input, "Draft a review{Shift>}{Enter}{/Shift}with citations");
    expect(input).toHaveValue("Draft a review\nwith citations");

    await userEvent.keyboard("{Enter}");

    expect(usePanelStore.getState().agentPanelTab).toBe("chat");
    expect(useAgentWorkbenchStore.getState().pendingWorkflow).toMatchObject({
      kind: "agent_prompt",
      toolId: "project_command_center",
      prompt: "Draft a review\nwith citations",
    });
    expect(input).toHaveValue("");
  });

  it("opens guided starts through a project-home wizard and existing workflow intents", async () => {
    renderProjectView();

    await userEvent.click(
      await screen.findByRole("button", {
        name: /project\.commandCenter\.guided\.report\.title/,
      }),
    );
    expect(
      screen.getByText("project.commandCenter.guidedWizard.description"),
    ).toBeInTheDocument();
    await userEvent.type(
      screen.getByLabelText("project.commandCenter.guidedWizard.topicLabel"),
      "lab report from uploaded PDFs",
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: "project.commandCenter.guidedWizard.submit",
      }),
    );

    expect(usePanelStore.getState().agentPanelTab).toBe("chat");
    expect(useAgentWorkbenchStore.getState().pendingWorkflow).toMatchObject({
      kind: "document_generation",
      presetId: "pdf_report_fast",
      prompt: expect.stringContaining(
        "project.commandCenter.guidedWizard.promptBlock",
      ),
    });
  });

  it("submits prompt guided starts with structured wizard context", async () => {
    renderProjectView();

    await userEvent.click(
      await screen.findByRole("button", {
        name: /project\.commandCenter\.guided\.studyPrep\.title/,
      }),
    );
    await userEvent.type(
      screen.getByLabelText("project.commandCenter.guidedWizard.topicLabel"),
      "midterm chapters",
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: "project.commandCenter.guidedWizard.submit",
      }),
    );

    expect(usePanelStore.getState().agentPanelTab).toBe("chat");
    expect(useAgentWorkbenchStore.getState().pendingWorkflow).toMatchObject({
      kind: "agent_prompt",
      toolId: "project_command_center",
      prompt: expect.stringContaining(
        "project.commandCenter.guided.studyPrep.prompt",
      ),
    });
    expect(useAgentWorkbenchStore.getState().pendingWorkflow?.prompt).toContain(
      "project.commandCenter.guidedWizard.promptBlock",
    );
  });

  it("summarizes active project runs with user-facing timeline steps", async () => {
    vi.mocked(workflowConsoleApi.list).mockResolvedValue({
      runs: [
        {
          runId: "agent_action:action-1",
          runType: "agent_action",
          agentRole: "review",
          actionKind: "note.update",
          workGroupId: "chat:run-1",
          sourceId: "action-1",
          sourceStatus: "approval_required",
          workspaceId: "workspace-1",
          projectId: "p1",
          actorUserId: "user-1",
          title: "Review generated note",
          status: "approval_required",
          risk: "write",
          progress: null,
          outputs: [],
          approvals: [
            {
              approvalId: "approval-1",
              status: "requested",
              risk: "write",
            },
          ],
          error: null,
          createdAt: "2026-05-14T00:00:00.000Z",
          updatedAt: "2026-05-14T00:00:30.000Z",
          completedAt: null,
        },
        {
          runId: "chat:run-1",
          runType: "chat",
          agentRole: "research",
          workGroupId: "chat:run-1",
          sourceId: "run-1",
          sourceStatus: "running",
          workspaceId: "workspace-1",
          projectId: "p1",
          actorUserId: "user-1",
          title: "Analyze selected source",
          status: "running",
          risk: "low",
          progress: { current: 1, total: 3, percent: 33 },
          outputs: [
            {
              outputType: "agent_file",
              id: "file-1",
              label: "analysis.md",
              url: "/ko/workspace/acme/file/file-1",
            },
          ],
          approvals: [],
          error: null,
          createdAt: "2026-05-14T00:00:00.000Z",
          updatedAt: "2026-05-14T00:01:00.000Z",
          completedAt: null,
        },
      ],
    });

    renderProjectView();

    expect(
      await screen.findByText("project.commandCenter.activeRuns.title"),
    ).toBeInTheDocument();
    expect(screen.getByText("agentPanel.runTimeline.step.searchProject"))
      .toBeInTheDocument();
    expect(screen.getByText("agentPanel.runTimeline.step.needsReview"))
      .toBeInTheDocument();
    expect(screen.getByText("agentPanel.runTimeline.step.openArtifact"))
      .toBeInTheDocument();
  });

  it("shows first-source actions when the project has no notes", async () => {
    mockProjectNotes.rows = [];
    renderProjectView();

    expect(
      await screen.findByText("project.empty.title"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: /project\.starter\.actions\.templates\.title/,
      }),
    ).toHaveAttribute("href", "/ko/workspace/acme/new-project");
    expect(
      screen.getByRole("button", {
        name: /project\.empty\.actions\.recording\.title/,
      }),
    ).toBeEnabled();
  });

  it("keeps source intake actions visible after notes exist", async () => {
    mockProjectNotes.rows = [
      {
        id: "n1",
        title: "Existing note",
        kind: "manual",
        updated_at: new Date().toISOString(),
      },
    ];

    renderProjectView();

    expect(
      await screen.findByText("project.sourceIntake.title"),
    ).toBeInTheDocument();
    expect(screen.queryByText("project.empty.title")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /project\.empty\.actions\.recording\.title/,
      }),
    ).toBeEnabled();
  });

  it("surfaces project tools in the central workbench", async () => {
    renderProjectView();

    expect(screen.getByText("project.nextActions.title")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /project\.tools\.items\.research\.title/,
      }),
    ).toHaveClass("hover:bg-muted/40");
    expect(
      screen.getByRole("button", {
        name: /project\.tools\.items\.pdfReport\.title/,
      }),
    ).toHaveClass("bg-primary");
    expect(
      screen.getByRole("button", {
        name: /project\.tools\.items\.slides\.title/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /project\.tools\.items\.sourceFigure\.title/,
      }),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", {
        name: /project\.tools\.items\.research\.title/,
      }),
    );
    expect(usePanelStore.getState().agentPanelTab).toBe("chat");
    expect(useAgentWorkbenchStore.getState().pendingWorkflow).toMatchObject({
      kind: "agent_prompt",
      toolId: "research",
    });
    expect(screen.getByText("notes table")).toBeInTheDocument();
  });

  it("surfaces purpose-driven graph entry points after project sources exist", async () => {
    renderProjectView();

    expect(
      screen.getByText("project.graphDiscovery.title"),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("project.graphDiscovery.index.label"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("project-wiki-health")).toHaveTextContent(
      "project.graphDiscovery.health.label project.graphDiscovery.health.status.blocked",
    );
    expect(screen.getByTestId("project-wiki-health")).toHaveTextContent(
      "project.graphDiscovery.health.issues.analysis_failed",
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: /project\.graphDiscovery\.health\.refresh/,
      }),
    );
    expect(projectsApi.refreshWikiIndex).toHaveBeenCalledWith("p1");
    await userEvent.click(
      screen.getByRole("button", {
        name: /project\.graphDiscovery\.health\.runLibrarian/,
      }),
    );
    expect(plan8AgentsApi.runLibrarian).toHaveBeenCalledWith({
      projectId: "p1",
    });
    await waitFor(() =>
      expect(usePanelStore.getState().agentPanelTab).toBe("activity"),
    );
    expect(
      screen.getByText(
        "project.graphDiscovery.index.pages · project.graphDiscovery.index.links · project.graphDiscovery.index.orphans · project.graphDiscovery.index.latest",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: /project\.graphDiscovery\.actions\.map/,
      }),
    ).toHaveAttribute("href", "/ko/workspace/acme/project/p1/graph");
    expect(
      screen.getByRole("link", {
        name: /project\.graphDiscovery\.actions\.cards/,
      }),
    ).toHaveAttribute("href", "/ko/workspace/acme/project/p1/graph?view=cards");
    expect(
      screen.getByRole("link", {
        name: /project\.graphDiscovery\.actions\.mindmap/,
      }),
    ).toHaveAttribute(
      "href",
      "/ko/workspace/acme/project/p1/graph?view=mindmap",
    );
  });

  it("preflights project research before opening an agent workflow", async () => {
    usePanelStore.getState().setAgentPanelOpen(false);
    renderProjectView();

    await userEvent.click(
      screen.getByRole("button", {
        name: /project\.tools\.items\.research\.title/,
      }),
    );

    await waitFor(() =>
      expect(preflightMock).toHaveBeenCalledWith("p1", {
        tool: "deep_research",
        sourceTokenEstimate: 48000,
      }),
    );
    expect(pushMock).not.toHaveBeenCalled();
    expect(usePanelStore.getState().agentPanelTab).toBe("chat");
    expect(useAgentWorkbenchStore.getState().pendingWorkflow).toMatchObject({
      kind: "agent_prompt",
      toolId: "research",
    });
  });

  it("preflights project-home study artifact generation before opening an agent workflow", async () => {
    renderProjectView();

    await userEvent.click(
      screen.getByRole("button", {
        name: /project\.tools\.items\.studyArtifactGenerator\.title/,
      }),
    );

    await waitFor(() =>
      expect(preflightMock).toHaveBeenCalledWith("p1", {
        tool: "quiz",
        sourceTokenEstimate: 16000,
      }),
    );
    expect(usePanelStore.getState().agentPanelTab).toBe("chat");
    expect(useAgentWorkbenchStore.getState().pendingWorkflow).toMatchObject({
      kind: "study_artifact",
      toolId: "study_artifact_generator",
    });
  });

  it("opens runs and review in activity while document generation opens an agent workflow", async () => {
    renderProjectView();

    await userEvent.click(
      screen.getByRole("button", {
        name: /project\.tools\.items\.runs\.title/,
      }),
    );
    expect(usePanelStore.getState().agentPanelTab).toBe("activity");

    usePanelStore.getState().setAgentPanelTab("chat");
    await userEvent.click(
      screen.getByRole("button", {
        name: /project\.tools\.items\.pdfReport\.title/,
      }),
    );
    await waitFor(() => {
      expect(usePanelStore.getState().agentPanelTab).toBe("chat");
      expect(useAgentWorkbenchStore.getState().pendingWorkflow).toMatchObject({
        kind: "document_generation",
        presetId: "pdf_report_fast",
      });
    });

    useAgentWorkbenchStore.getState().closeWorkflow(
      useAgentWorkbenchStore.getState().pendingWorkflow!.id,
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: /project\.tools\.items\.sourceFigure\.title/,
      }),
    );
    await waitFor(() => {
      expect(usePanelStore.getState().agentPanelTab).toBe("chat");
      expect(useAgentWorkbenchStore.getState().pendingWorkflow).toMatchObject({
        kind: "document_generation",
        presetId: "source_figure",
      });
    });

    usePanelStore.getState().setAgentPanelTab("chat");
    await userEvent.click(
      screen.getByRole("button", {
        name: /project\.tools\.items\.reviewInbox\.title/,
      }),
    );
    expect(usePanelStore.getState().agentPanelTab).toBe("activity");
  });

  it("constrains the project home surface and empty actions inside narrow shells", async () => {
    mockProjectNotes.rows = [];
    renderProjectView();

    const route = await screen.findByTestId("route-project");
    expect(route).toHaveClass("min-w-0", "w-full", "overflow-x-hidden");

    const starterActions = await screen.findByTestId(
      "project-empty-primary-actions",
    );
    expect(starterActions.className).toContain("grid-cols-[repeat(auto-fit");
    expect(starterActions.className).not.toContain("md:grid-cols-4");
  });

  it("blocks project-home Studio tools when preflight reports insufficient credits", async () => {
    preflightMock.mockResolvedValueOnce({
      preflight: {
        canStart: false,
        requiresConfirmation: true,
        cost: { billableCredits: 100 },
        balance: { availableCredits: 0, plan: "free" },
      },
    });
    renderProjectView();

    await userEvent.click(
      screen.getByRole("button", {
        name: /project\.tools\.items\.pdfReport\.title/,
      }),
    );

    expect(
      await screen.findByText("project.tools.preflight.blocked"),
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("button", {
          name: /project\.tools\.items\.pdfReport\.title/,
        }),
      ).getByText("project.tools.unavailable.overQuota"),
    ).toBeInTheDocument();
    expect(usePanelStore.getState().agentPanelTab).toBe("chat");
    expect(useAgentWorkbenchStore.getState().pendingWorkflow).toBeNull();
  });

  it("asks for project-home confirmation before opening approval-required tools", async () => {
    preflightMock.mockResolvedValueOnce({
      preflight: {
        canStart: true,
        requiresConfirmation: true,
        cost: { billableCredits: 40 },
        balance: { availableCredits: 100, plan: "pro" },
      },
    });
    renderProjectView();

    await userEvent.click(
      screen.getByRole("button", {
        name: /project\.tools\.items\.pdfReport\.title/,
      }),
    );

    expect(
      await screen.findByText("project.tools.preflight.confirm"),
    ).toBeInTheDocument();
    expect(
      useAgentWorkbenchStore.getState().pendingWorkflow,
    ).toBeNull();

    await userEvent.click(
      screen.getByRole("button", {
        name: "project.tools.preflight.confirmStart",
      }),
    );

    expect(usePanelStore.getState().agentPanelTab).toBe("chat");
    expect(useAgentWorkbenchStore.getState().pendingWorkflow).toMatchObject({
      kind: "document_generation",
      presetId: "pdf_report_fast",
    });
  });
});
