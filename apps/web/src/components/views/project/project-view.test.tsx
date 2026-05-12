import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAgentWorkbenchStore } from "@/stores/agent-workbench-store";
import { usePanelStore } from "@/stores/panel-store";
import { ProjectView } from "./project-view";

vi.mock("next-intl", () => ({
  useLocale: () => "ko",
  useTranslations: (ns?: string) => (key: string) =>
    ns ? `${ns}.${key}` : key,
}));

vi.mock("@/hooks/useWorkspaceId", () => ({
  useWorkspaceId: () => "workspace-1",
}));

vi.mock("@/lib/api-client", () => ({
  projectsApi: {
    get: vi.fn(async () => ({ id: "p1", name: "Project One" })),
  },
}));

vi.mock("@/components/literature/literature-search-modal", () => ({
  LiteratureSearchModal: ({ open }: { open: boolean }) =>
    open ? <div>literature modal</div> : null,
}));

vi.mock("./project-meta-row", () => ({
  ProjectMetaRow: ({ name }: { name: string }) => <div>{name}</div>,
}));

vi.mock("./project-notes-table", () => ({
  ProjectNotesTable: () => <div>notes table</div>,
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
    useAgentWorkbenchStore.setState(useAgentWorkbenchStore.getInitialState(), true);
    usePanelStore.setState(usePanelStore.getInitialState(), true);
  });

  it("surfaces project tools in the central workbench", async () => {
    renderProjectView();

    expect(screen.getByText("project.tools.heading")).toBeInTheDocument();
    expect(
      screen.getByText("project.tools.categories.add_sources.title"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("project.tools.categories.create.title"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /project\.tools\.items\.research\.title/,
      }),
    ).toHaveClass("hover:bg-muted/40");
    expect(
      screen.getByRole("link", {
        name: /project\.tools\.items\.graph\.title/,
      }),
    ).toHaveAttribute("href", "/ko/workspace/acme/project/p1/graph");
    expect(
      screen.getByRole("link", {
        name: /project\.tools\.items\.agents\.title/,
      }),
    ).toHaveAttribute("href", "/ko/workspace/acme/project/p1/agents");
    expect(
      screen.getByRole("button", {
        name: /project\.tools\.items\.pdfReport\.title/,
      }),
    ).toHaveClass("bg-primary");
    expect(
      screen.getByRole("button", {
        name: /project\.tools\.items\.latexPdf\.title/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /project\.tools\.items\.pptxDeck\.title/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /project\.tools\.items\.sourceFigure\.title/,
      }),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", {
        name: /project\.tools\.items\.literature\.title/,
      }),
    );
    expect(screen.getByText("literature modal")).toBeInTheDocument();
    expect(screen.getByText("notes table")).toBeInTheDocument();
  });

  it("surfaces purpose-driven graph entry points after project sources exist", async () => {
    renderProjectView();

    expect(
      screen.getByText("project.graphDiscovery.title"),
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
    ).toHaveAttribute("href", "/ko/workspace/acme/project/p1/graph?view=mindmap");
  });

  it("starts project research from the right workbench instead of routing away", async () => {
    usePanelStore.getState().setAgentPanelOpen(false);
    renderProjectView();

    await userEvent.click(
      screen.getByRole("button", {
        name: /project\.tools\.items\.research\.title/,
      }),
    );

    expect(usePanelStore.getState().agentPanelOpen).toBe(true);
    expect(usePanelStore.getState().agentPanelTab).toBe("chat");
    expect(useAgentWorkbenchStore.getState().pendingIntent).toMatchObject({
      kind: "runCommand",
      commandId: "research",
    });
  });

  it("opens runs, review, and document generation in the right workbench activity tab", async () => {
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
    expect(usePanelStore.getState().agentPanelTab).toBe("activity");
    expect(
      useAgentWorkbenchStore.getState().pendingDocumentGenerationPreset,
    ).toMatchObject({ presetId: "pdf_report_fast" });

    usePanelStore.getState().setAgentPanelTab("chat");
    await userEvent.click(
      screen.getByRole("button", {
        name: /project\.tools\.items\.sourceFigure\.title/,
      }),
    );
    expect(usePanelStore.getState().agentPanelTab).toBe("activity");
    expect(
      useAgentWorkbenchStore.getState().pendingDocumentGenerationPreset,
    ).toMatchObject({ presetId: "source_figure" });

    usePanelStore.getState().setAgentPanelTab("chat");
    await userEvent.click(
      screen.getByRole("button", {
        name: /project\.tools\.items\.reviewInbox\.title/,
      }),
    );
    expect(usePanelStore.getState().agentPanelTab).toBe("activity");
  });
});
