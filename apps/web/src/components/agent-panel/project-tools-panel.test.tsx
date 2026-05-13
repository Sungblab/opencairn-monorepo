import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAgentWorkbenchStore } from "@/stores/agent-workbench-store";
import { ProjectToolsPanel } from "./project-tools-panel";

const pushMock = vi.fn();
const uploadMock = vi.fn();
const preflightMock = vi.hoisted(() => vi.fn());
const projectNotesMock = vi.hoisted(() => vi.fn());
const studyArtifactGenerateMock = vi.hoisted(() => vi.fn());
const openOriginalFileTabMock = vi.hoisted(() => vi.fn());
const researchCreateRunMock = vi.hoisted(() => vi.fn());
const googleIntegrationMock = vi.hoisted(() => vi.fn());

vi.mock("next-intl", () => ({
  useLocale: () => "ko",
  useTranslations: (ns?: string) => (key: string) =>
    ns ? `${ns}.${key}` : key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/hooks/use-ingest-upload", () => ({
  useIngestUpload: () => ({
    upload: uploadMock,
    isUploading: false,
  }),
}));

vi.mock("@/components/literature/literature-search-modal", () => ({
  LiteratureSearchModal: ({ open }: { open: boolean }) =>
    open ? <div>literature modal</div> : null,
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    projectsApi: {
      ...actual.projectsApi,
      notes: projectNotesMock,
    },
    studioToolsApi: { preflight: preflightMock },
    studyArtifactsApi: { generate: studyArtifactGenerateMock },
    integrationsApi: { google: googleIntegrationMock },
  };
});

vi.mock("@/components/ingest/open-original-file-tab", () => ({
  openOriginalFileTab: openOriginalFileTabMock,
}));

vi.mock("@/lib/api-client-research", () => ({
  researchApi: { createRun: researchCreateRunMock },
}));

describe("ProjectToolsPanel", () => {
  beforeEach(() => {
    localStorage.clear();
    pushMock.mockReset();
    uploadMock.mockReset();
    preflightMock.mockReset();
    projectNotesMock.mockReset();
    studyArtifactGenerateMock.mockReset();
    openOriginalFileTabMock.mockReset();
    researchCreateRunMock.mockReset();
    googleIntegrationMock.mockReset();
    googleIntegrationMock.mockResolvedValue({
      connected: false,
      accountEmail: null,
      scopes: null,
    });
    projectNotesMock.mockResolvedValue({
      notes: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          title: "Intro note",
          kind: "manual",
          updated_at: "2026-05-13T00:00:00.000Z",
        },
      ],
    });
    studyArtifactGenerateMock.mockResolvedValue({
      artifact: { type: "quiz_set", title: "Intro quiz" },
      file: { id: "file-1", title: "Intro quiz" },
    });
    researchCreateRunMock.mockResolvedValue({ runId: "research-run-1" });
    preflightMock.mockResolvedValue({
      preflight: {
        canStart: true,
        requiresConfirmation: false,
        cost: { billableCredits: 12 },
        balance: { availableCredits: 100, plan: "free" },
      },
    });
    useAgentWorkbenchStore.setState(
      useAgentWorkbenchStore.getInitialState(),
      true,
    );
  });

  it("renders Studio catalog groups around existing durable surfaces", async () => {
    render(
      <ProjectToolsPanel
        projectId="project-1"
        workspaceId="workspace-1"
        wsSlug="acme"
        onRun={vi.fn()}
        onOpenActivity={vi.fn()}
      />,
    );

    expect(
      screen.getByText("project.tools.categories.add_sources.title"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("project.tools.categories.study.title"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("project.tools.categories.content.title"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("project.tools.categories.analysis.title"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("project.tools.categories.utility.title"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /project\.tools\.items\.youtubeImport\.title/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /project\.tools\.items\.webImport\.title/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /project\.tools\.items\.connectedSources\.title/,
      }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("project.tools.integrationStatus.disconnected"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /project\.tools\.items\.flashcards\.title/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /project\.tools\.items\.teachToLearn\.title/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /project\.tools\.items\.slides\.title/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /project\.tools\.items\.mindMap\.title/,
      }),
    ).toBeInTheDocument();
  });

  it("surfaces connected-source integration status on the Studio card", async () => {
    googleIntegrationMock.mockResolvedValue({
      connected: true,
      accountEmail: "student@example.com",
      scopes: "drive.file",
    });

    render(
      <ProjectToolsPanel
        projectId="project-1"
        workspaceId="workspace-1"
        wsSlug="acme"
        onRun={vi.fn()}
        onOpenActivity={vi.fn()}
      />,
    );

    expect(
      await screen.findByText("project.tools.integrationStatus.connected"),
    ).toBeInTheDocument();
    expect(googleIntegrationMock).toHaveBeenCalledWith("workspace-1");
  });

  it("keeps route, command, activity, and preset actions executable", async () => {
    const onRun = vi.fn();
    const onOpenActivity = vi.fn();
    render(
      <ProjectToolsPanel
        projectId="project-1"
        workspaceId="workspace-1"
        wsSlug="acme"
        onRun={onRun}
        onOpenActivity={onOpenActivity}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /project\.tools\.items\.research\.title/,
      }),
    );
    expect(
      await screen.findByText("project.tools.deepResearch.title"),
    ).toBeInTheDocument();
    expect(onRun).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: "research" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "project.tools.deepResearch.cancel" }),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /project\.tools\.items\.graph\.title/,
      }),
    );
    expect(pushMock).toHaveBeenCalledWith(
      "/ko/workspace/acme/project/project-1/graph",
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /project\.tools\.items\.mindMap\.title/,
      }),
    );
    expect(pushMock).toHaveBeenCalledWith(
      "/ko/workspace/acme/project/project-1/graph?view=mindmap",
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /project\.tools\.items\.flashcards\.title/,
      }),
    );
    expect(pushMock).toHaveBeenCalledWith(
      "/ko/workspace/acme/project/project-1/learn/flashcards",
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /project\.tools\.items\.teachToLearn\.title/,
      }),
    );
    expect(pushMock).toHaveBeenCalledWith(
      "/ko/workspace/acme/project/project-1/learn/socratic",
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /project\.tools\.items\.youtubeImport\.title/,
      }),
    );
    expect(pushMock).toHaveBeenCalledWith(
      "/ko/workspace/acme/import?projectId=project-1&source=youtube",
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /project\.tools\.items\.webImport\.title/,
      }),
    );
    expect(pushMock).toHaveBeenCalledWith(
      "/ko/workspace/acme/import?projectId=project-1&source=web",
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /project\.tools\.items\.connectedSources\.title/,
      }),
    );
    expect(pushMock).toHaveBeenCalledWith(
      "/ko/workspace/acme/settings/workspace/integrations",
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /project\.tools\.items\.slides\.title/,
      }),
    );
    await waitFor(() => expect(onOpenActivity).toHaveBeenCalled());
    expect(preflightMock).toHaveBeenCalledWith("project-1", {
      tool: "slides",
      sourceTokenEstimate: 24000,
    });
    expect(
      useAgentWorkbenchStore.getState().pendingDocumentGenerationPreset,
    ).toMatchObject({ presetId: "pptx_deck" });

    fireEvent.click(
      screen.getByRole("button", {
        name: /project\.tools\.items\.jsonExport\.title/,
      }),
    );
    expect(
      await screen.findByText("project.tools.studyArtifact.title"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("project.tools.studyArtifact.typeLabel"),
    ).toHaveValue("data_table");
  });

  it("blocks costly Studio actions when preflight reports insufficient credits", async () => {
    preflightMock.mockResolvedValueOnce({
      preflight: {
        canStart: false,
        requiresConfirmation: true,
        cost: { billableCredits: 150 },
        balance: { availableCredits: 0, plan: "free" },
      },
    });
    const onOpenActivity = vi.fn();
    const { container } = render(
      <ProjectToolsPanel
        projectId="project-1"
        workspaceId="workspace-1"
        wsSlug="acme"
        onRun={vi.fn()}
        onOpenActivity={onOpenActivity}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /project\.tools\.items\.slides\.title/,
      }),
    );

    expect(
      await screen.findByText("agentPanel.projectTools.preflight.blocked"),
    ).toBeInTheDocument();
    const slidesTile = container.querySelector<HTMLElement>(
      '[data-tool-tile="pptx_deck"]',
    );
    expect(slidesTile).not.toBeNull();
    expect(within(slidesTile!).getByText(
      "agentPanel.projectTools.unavailable.overQuota",
    )).toBeInTheDocument();
    expect(onOpenActivity).not.toHaveBeenCalled();
  });

  it("asks for confirmation before starting approval-required Studio actions", async () => {
    preflightMock.mockResolvedValueOnce({
      preflight: {
        canStart: true,
        requiresConfirmation: true,
        cost: { billableCredits: 32 },
        balance: { availableCredits: 100, plan: "pro" },
      },
    });
    const onOpenActivity = vi.fn();
    render(
      <ProjectToolsPanel
        projectId="project-1"
        workspaceId="workspace-1"
        wsSlug="acme"
        onRun={vi.fn()}
        onOpenActivity={onOpenActivity}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /project\.tools\.items\.slides\.title/,
      }),
    );
    expect(
      await screen.findByText("agentPanel.projectTools.preflight.confirm"),
    ).toBeInTheDocument();
    expect(onOpenActivity).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", {
        name: "agentPanel.projectTools.preflight.confirmStart",
      }),
    );

    expect(onOpenActivity).toHaveBeenCalled();
    expect(
      useAgentWorkbenchStore.getState().pendingDocumentGenerationPreset,
    ).toMatchObject({ presetId: "pptx_deck" });
  });

  it("generates a typed study artifact file from selected project notes", async () => {
    render(
      <ProjectToolsPanel
        projectId="project-1"
        workspaceId="workspace-1"
        wsSlug="acme"
        onRun={vi.fn()}
        onOpenActivity={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /project\.tools\.items\.studyArtifactGenerator\.title/,
      }),
    );

    expect(
      await screen.findByText("project.tools.studyArtifact.title"),
    ).toBeInTheDocument();
    expect(preflightMock).toHaveBeenCalledWith("project-1", {
      tool: "quiz",
      sourceTokenEstimate: 16000,
    });
    expect(projectNotesMock).toHaveBeenCalledWith("project-1", "all");
    expect(
      screen.getByRole("checkbox", { name: "Intro note" }),
    ).toBeChecked();

    fireEvent.click(
      screen.getByRole("button", {
        name: "project.tools.studyArtifact.generate",
      }),
    );

    await waitFor(() =>
      expect(studyArtifactGenerateMock).toHaveBeenCalledWith("project-1", {
        type: "quiz_set",
        sourceNoteIds: ["11111111-1111-4111-8111-111111111111"],
        title: undefined,
        difficulty: "mixed",
        tags: [],
        itemCount: 5,
      }),
    );
    expect(openOriginalFileTabMock).toHaveBeenCalledWith("file-1", "Intro quiz");
  });

  it("shows retryable study artifact generation failures with the failed run id", async () => {
    studyArtifactGenerateMock.mockRejectedValueOnce({
      status: 502,
      message: "study_artifact_model_invalid",
      body: {
        retryable: true,
        runId: "study_artifact:failed-run",
      },
    });
    render(
      <ProjectToolsPanel
        projectId="project-1"
        workspaceId="workspace-1"
        wsSlug="acme"
        onRun={vi.fn()}
        onOpenActivity={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /project\.tools\.items\.studyArtifactGenerator\.title/,
      }),
    );
    await screen.findByText("project.tools.studyArtifact.title");
    expect(
      await screen.findByRole("checkbox", { name: "Intro note" }),
    ).toBeChecked();
    fireEvent.click(
      screen.getByRole("button", {
        name: "project.tools.studyArtifact.generate",
      }),
    );

    expect(
      await screen.findByText("project.tools.studyArtifact.retryableError"),
    ).toBeInTheDocument();
    expect(screen.getByText("study_artifact:failed-run")).toBeInTheDocument();
  });

  it("starts Deep Research through the typed research run API", async () => {
    const onRun = vi.fn();
    render(
      <ProjectToolsPanel
        projectId="project-1"
        workspaceId="workspace-1"
        wsSlug="acme"
        onRun={onRun}
        onOpenActivity={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /project\.tools\.items\.research\.title/,
      }),
    );

    expect(
      await screen.findByText("project.tools.deepResearch.title"),
    ).toBeInTheDocument();
    fireEvent.change(
      screen.getByLabelText("project.tools.deepResearch.topicLabel"),
      { target: { value: "Find primary sources about spaced repetition" } },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "project.tools.deepResearch.start",
      }),
    );

    await waitFor(() =>
      expect(researchCreateRunMock).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        projectId: "project-1",
        topic: "Find primary sources about spaced repetition",
        model: "deep-research-preview-04-2026",
        billingPath: "byok",
      }),
    );
    expect(pushMock).toHaveBeenCalledWith(
      "/ko/workspace/acme/research/research-run-1",
    );
    expect(onRun).not.toHaveBeenCalled();
  });

  it("routes summary through the typed cheat-sheet artifact generator", async () => {
    const onRun = vi.fn();
    render(
      <ProjectToolsPanel
        projectId="project-1"
        workspaceId="workspace-1"
        wsSlug="acme"
        onRun={onRun}
        onOpenActivity={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /project\.tools\.items\.summarize\.title/,
      }),
    );

    expect(
      await screen.findByText("project.tools.studyArtifact.title"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("project.tools.studyArtifact.typeLabel"),
    ).toHaveValue("cheat_sheet");
    expect(preflightMock).toHaveBeenCalledWith("project-1", {
      tool: "cheat_sheet",
      sourceTokenEstimate: 18000,
    });
    expect(onRun).not.toHaveBeenCalled();
  });

  it("disables catalog actions when no project is selected", () => {
    render(
      <ProjectToolsPanel
        projectId={null}
        workspaceId="workspace-1"
        wsSlug="acme"
        onRun={vi.fn()}
        onOpenActivity={vi.fn()}
      />,
    );

    expect(
      screen.getByText("agentPanel.projectTools.noProject"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /project\.tools\.items\.slides\.title/,
      }),
    ).toBeDisabled();
    expect(
      screen.getAllByText("agentPanel.projectTools.unavailable.missingProject")
        .length,
    ).toBeGreaterThan(0);
  });

  it("filters tools and marks favorite and recent actions", () => {
    render(
      <ProjectToolsPanel
        projectId="project-1"
        workspaceId="workspace-1"
        wsSlug="acme"
        onRun={vi.fn()}
        onOpenActivity={vi.fn()}
      />,
    );

    fireEvent.change(
      screen.getByPlaceholderText("agentPanel.projectTools.searchPlaceholder"),
      { target: { value: "mind" } },
    );

    expect(
      screen.getByRole("button", {
        name: /project\.tools\.items\.mindMap\.title/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: /project\.tools\.items\.youtubeImport\.title/,
      }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("agentPanel.projectTools.favorite"));
    expect(
      screen.getByText("agentPanel.projectTools.favoriteActive"),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: /project\.tools\.items\.mindMap\.title/,
      }),
    );
    expect(
      screen.getByText("agentPanel.projectTools.recentActive"),
    ).toBeInTheDocument();
  });

  it("ignores repeated file chooser events while an upload is in flight", () => {
    uploadMock.mockImplementation(() => new Promise(() => {}));
    const onOpenActivity = vi.fn();
    const { container } = render(
      <ProjectToolsPanel
        projectId="project-1"
        workspaceId="workspace-1"
        wsSlug="acme"
        onRun={vi.fn()}
        onOpenActivity={onOpenActivity}
      />,
    );

    const input = container.querySelector('input[type="file"]');
    expect(input).toBeInstanceOf(HTMLInputElement);
    const source = new File(["pdf"], "source.pdf", { type: "application/pdf" });

    fireEvent.change(input!, { target: { files: [source] } });
    fireEvent.change(input!, { target: { files: [source] } });

    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(onOpenActivity).toHaveBeenCalledTimes(1);
  });
});
