import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAgentWorkbenchStore } from "@/stores/agent-workbench-store";
import { ProjectToolsPanel } from "./project-tools-panel";

const pushMock = vi.fn();
const uploadMock = vi.fn();

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

describe("ProjectToolsPanel", () => {
  beforeEach(() => {
    pushMock.mockReset();
    uploadMock.mockReset();
    useAgentWorkbenchStore.setState(useAgentWorkbenchStore.getInitialState(), true);
  });

  it("renders catalog-backed intent groups and document presets", () => {
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
      screen.getByText("project.tools.categories.create.title"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /project\.tools\.items\.pdfReport\.title/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /project\.tools\.items\.latexPdf\.title/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /project\.tools\.items\.xlsxTable\.title/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /project\.tools\.items\.sourceFigure\.title/,
      }),
    ).toBeInTheDocument();
  });

  it("keeps route, command, activity, and preset actions executable", () => {
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
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ id: "research" }));

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
        name: /project\.tools\.items\.latexPdf\.title/,
      }),
    );
    expect(onOpenActivity).toHaveBeenCalled();
    expect(
      useAgentWorkbenchStore.getState().pendingDocumentGenerationPreset,
    ).toMatchObject({ presetId: "pdf_report_latex" });

    fireEvent.click(
      screen.getByRole("button", {
        name: /project\.tools\.items\.sourceFigure\.title/,
      }),
    );
    expect(
      useAgentWorkbenchStore.getState().pendingDocumentGenerationPreset,
    ).toMatchObject({ presetId: "source_figure" });
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

    expect(screen.getByText("agentPanel.projectTools.noProject")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /project\.tools\.items\.pdfReport\.title/,
      }),
    ).toBeDisabled();
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
