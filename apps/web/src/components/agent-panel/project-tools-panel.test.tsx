import type { ReactNode } from "react";
import { fireEvent, render as rtlRender, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAgentWorkbenchStore } from "@/stores/agent-workbench-store";
import { ProjectToolsPanel } from "./project-tools-panel";

const pushMock = vi.fn();
const uploadManyMock = vi.fn();
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
    uploadMany: uploadManyMock,
    isUploading: false,
  }),
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    integrationsApi: { google: googleIntegrationMock },
  };
});

function render(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return rtlRender(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

function renderPanel(overrides: Partial<Parameters<typeof ProjectToolsPanel>[0]> = {}) {
  const props: Parameters<typeof ProjectToolsPanel>[0] = {
    projectId: "project-1",
    workspaceId: "workspace-1",
    wsSlug: "acme",
    onOpenActivity: vi.fn(),
    onOpenChat: vi.fn(),
    ...overrides,
  };
  return { ...render(<ProjectToolsPanel {...props} />), props };
}

describe("ProjectToolsPanel", () => {
  beforeEach(() => {
    localStorage.clear();
    pushMock.mockReset();
    uploadManyMock.mockReset();
    googleIntegrationMock.mockReset();
    googleIntegrationMock.mockResolvedValue({
      connected: false,
      accountEmail: null,
      scopes: null,
    });
    useAgentWorkbenchStore.setState(
      useAgentWorkbenchStore.getInitialState(),
      true,
    );
  });

  it("renders Studio catalog groups around durable project surfaces", async () => {
    renderPanel();

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
      await screen.findByText("project.tools.integrationStatus.disconnected"),
    ).toBeInTheDocument();
  });

  it("opens workflow-backed tools in the agent chat instead of launching modal routes", () => {
    const onOpenChat = vi.fn();
    renderPanel({ onOpenChat });

    fireEvent.click(
      screen.getByRole("button", {
        name: /project\.tools\.items\.literature\.title/,
      }),
    );
    expect(onOpenChat).toHaveBeenCalledTimes(1);
    expect(useAgentWorkbenchStore.getState().pendingWorkflow).toMatchObject({
      kind: "literature_search",
      toolId: "literature",
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: /project\.tools\.items\.flashcards\.title/,
      }),
    );
    expect(useAgentWorkbenchStore.getState().pendingWorkflow).toMatchObject({
      kind: "study_artifact",
      toolId: "flashcards",
      artifactType: "flashcard_deck",
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: /project\.tools\.items\.slides\.title/,
      }),
    );
    expect(useAgentWorkbenchStore.getState().pendingWorkflow).toMatchObject({
      kind: "document_generation",
      toolId: "pptx_deck",
      presetId: "pptx_deck",
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: /project\.tools\.items\.teachToLearn\.title/,
      }),
    );
    expect(useAgentWorkbenchStore.getState().pendingWorkflow).toMatchObject({
      kind: "teach_to_learn",
      toolId: "teach_to_learn",
    });
  });

  it("keeps navigation-only tools as routes", () => {
    renderPanel();

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
        name: /project\.tools\.items\.connectedSources\.title/,
      }),
    );
    expect(pushMock).toHaveBeenCalledWith(
      "/ko/workspace/acme/settings/workspace/integrations",
    );
  });

  it("keeps upload as a shared upload dialog and sends one upload batch", () => {
    uploadManyMock.mockImplementation(() => new Promise(() => {}));
    const onOpenActivity = vi.fn();
    const { container } = renderPanel({ onOpenActivity });

    fireEvent.click(
      screen.getByRole("button", {
        name: /project\.tools\.items\.import\.title/,
      }),
    );
    expect(screen.getByText("sidebar.upload.title")).toBeInTheDocument();

    const input = container.querySelector('input[type="file"]');
    expect(input).toBeInstanceOf(HTMLInputElement);
    const source = new File(["pdf"], "source.pdf", { type: "application/pdf" });

    fireEvent.change(input!, { target: { files: [source] } });
    fireEvent.click(screen.getByRole("button", { name: "sidebar.upload.start" }));
    fireEvent.click(
      screen.getByRole("button", { name: "sidebar.upload.uploading" }),
    );

    expect(uploadManyMock).toHaveBeenCalledTimes(1);
    expect(onOpenActivity).not.toHaveBeenCalled();
  });

  it("disables catalog actions when no project is selected", () => {
    renderPanel({ projectId: null });

    expect(
      screen.getByText("agentPanel.projectTools.noProject"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /project\.tools\.items\.slides\.title/,
      }),
    ).toBeDisabled();
  });
});
