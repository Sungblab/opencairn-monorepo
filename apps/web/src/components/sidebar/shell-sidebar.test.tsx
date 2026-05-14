import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ShellSidebar } from "./shell-sidebar";

const currentProject = vi.hoisted(() => ({
  value: { wsSlug: "acme", projectId: null as string | null },
}));

vi.mock("./use-current-project", () => ({
  useCurrentProjectContext: () => currentProject.value,
}));

vi.mock("next-intl", () => ({
  useLocale: () => "ko",
  useTranslations: (ns?: string) => (key: string) =>
    ns ? `${ns}.${key}` : key,
}));

const panelStoreMock = vi.hoisted(() => ({
  openAgentPanelTab: vi.fn(),
}));

vi.mock("@/stores/panel-store", () => ({
  usePanelStore: (
    selector: (s: {
      toggleSidebar: () => void;
      openAgentPanelTab: (tab: string) => void;
    }) => unknown,
  ) =>
    selector({
      toggleSidebar: vi.fn(),
      openAgentPanelTab: panelStoreMock.openAgentPanelTab,
    }),
}));

vi.mock("./workspace-switcher", () => ({
  WorkspaceSwitcher: () => <div>workspace switcher</div>,
}));
vi.mock("./project-hero", () => ({
  ProjectHero: () => <button type="button">project hero</button>,
}));
vi.mock("./global-nav", () => ({
  GlobalNav: () => <div>global nav</div>,
}));
vi.mock("./project-list-section", () => ({
  ProjectListSection: () => <div>project list</div>,
}));
vi.mock("./scoped-search", () => ({
  ScopedSearch: () => <div>search</div>,
}));
vi.mock("./project-tree", () => ({
  ProjectTree: () => <div>project tree</div>,
}));
vi.mock("./sidebar-footer", () => ({
  SidebarFooter: () => <div>footer</div>,
}));
vi.mock("./project-graph-link", () => ({
  ProjectGraphLink: () => <div>graph</div>,
}));
vi.mock("./project-agents-link", () => ({
  ProjectAgentsLink: () => <div>agents</div>,
}));
vi.mock("./project-learn-link", () => ({
  ProjectLearnLink: () => <div>learn</div>,
}));
vi.mock("./NewNoteButton", () => ({
  NewNoteButton: () => <button type="button">new note</button>,
}));
vi.mock("./NewFolderButton", () => ({
  NewFolderButton: () => <button type="button">new folder</button>,
}));
vi.mock("./NewCanvasButton", () => ({
  NewCanvasButton: () => <button type="button">new canvas</button>,
}));
vi.mock("./SourceUploadButton", () => ({
  SourceUploadButton: () => <button type="button">upload source</button>,
}));
vi.mock("./NewCodeWorkspaceButton", () => ({
  NewCodeWorkspaceButton: () => <button type="button">new code</button>,
}));
vi.mock("./GenerateDocumentButton", () => ({
  GenerateDocumentButton: () => (
    <button type="button">generate document</button>
  ),
}));
vi.mock("./sidebar-empty-state", () => ({
  SidebarEmptyState: () => <div>project empty state</div>,
}));
vi.mock("./sidebar-favorites", () => ({
  SidebarFavorites: () => <div>sidebar.favorites.empty</div>,
}));
vi.mock("./sidebar-recent-notes", () => ({
  SidebarRecentNotes: () => <div>recent notes</div>,
}));
vi.mock("./more-menu", () => ({
  MoreMenu: () => <div>more menu</div>,
}));
vi.mock("@/components/literature/literature-search-button", () => ({
  LiteratureSearchButton: () => <button type="button">literature</button>,
}));

describe("ShellSidebar", () => {
  beforeEach(() => {
    panelStoreMock.openAgentPanelTab.mockClear();
    window.localStorage.clear();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        workspaces: [{ id: "ws-1", slug: "acme", name: "ACME", role: "owner" }],
        invites: [],
      }),
    }) as unknown as typeof fetch;
  });

  function renderSidebar() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <ShellSidebar deepResearchEnabled />
      </QueryClientProvider>,
    );
  }

  it("makes project selection the top-level control and keeps global nav out of the main rail", () => {
    currentProject.value = { wsSlug: "acme", projectId: null };

    renderSidebar();

    expect(screen.getByText("project hero")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "sidebar.nav.workbench" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "sidebar.nav.dashboard_short" }),
    ).toHaveClass("rounded-md");
    expect(
      screen.getByRole("button", { name: "sidebar.nav.more_aria" }),
    ).toHaveClass("rounded-md");
    expect(screen.queryByText("project list")).not.toBeInTheDocument();
    expect(screen.queryByText("global nav")).not.toBeInTheDocument();
    expect(screen.queryByText("workspace switcher")).not.toBeInTheDocument();
    expect(screen.queryByText("project tree")).not.toBeInTheDocument();
    expect(screen.getByText("project empty state")).toBeInTheDocument();
  });

  it("keeps creation actions explicit while preserving the file explorer when a project is selected", () => {
    currentProject.value = { wsSlug: "acme", projectId: "p1" };

    renderSidebar();

    expect(
      screen.getByRole("link", { name: "sidebar.nav.project_home_short" }),
    ).toHaveAttribute("href", "/ko/workspace/acme/project/p1");
    expect(screen.getByTestId("sidebar-create-actions")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-tree-region")).toHaveClass(
      "overflow-hidden",
    );
    expect(screen.getByText("new note")).toBeInTheDocument();
    expect(screen.getByText("upload source")).toBeInTheDocument();
    expect(screen.getByText("new folder")).toBeInTheDocument();
    expect(screen.getByText("new canvas")).toBeInTheDocument();
    expect(screen.getByText("new code")).toBeInTheDocument();
    expect(screen.getByText("generate document")).toBeInTheDocument();
    expect(screen.getByText("sidebar.sections.favorites")).toBeInTheDocument();
    expect(
      screen.queryByText("sidebar.favorites.empty"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("sidebar.nav.graph")).toBeInTheDocument();
    expect(screen.getByText("sidebar.nav.agents")).toBeInTheDocument();
    expect(screen.getByText("sidebar.nav.learn")).toBeInTheDocument();
    expect(screen.getByText("sidebar.sections.recent")).toBeInTheDocument();
    expect(screen.queryByText("recent notes")).not.toBeInTheDocument();
    expect(
      screen.getByText("sidebar.sections.project_tools"),
    ).toBeInTheDocument();
    expect(screen.getByText("literature")).toBeInTheDocument();
    expect(
      screen.queryByText("sidebar.nav.public_pages"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("sidebar.nav.feedback")).not.toBeInTheDocument();
    expect(screen.queryByText("sidebar.nav.changelog")).not.toBeInTheDocument();
    expect(screen.getByText("project tree")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "sidebar.nav.more_aria" }),
    ).toBeInTheDocument();
  });

  it("collapses sidebar sections and restores the state for the workspace", async () => {
    currentProject.value = { wsSlug: "acme", projectId: "p1" };
    const user = userEvent.setup();
    const first = renderSidebar();

    await user.click(
      screen.getByRole("button", { name: "sidebar.sections.project_tools" }),
    );

    expect(screen.queryByText("sidebar.nav.graph")).not.toBeInTheDocument();

    first.unmount();
    renderSidebar();

    expect(screen.queryByText("sidebar.nav.graph")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "sidebar.sections.project_tools" }),
    );

    expect(screen.getByText("sidebar.nav.graph")).toBeInTheDocument();
  });

  it("starts with low-priority sections collapsed and gives files more room", () => {
    currentProject.value = { wsSlug: "acme", projectId: "p1" };

    renderSidebar();

    expect(
      screen.queryByText("sidebar.favorites.empty"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("recent notes")).not.toBeInTheDocument();
    expect(
      screen.queryByText("sidebar.nav.public_pages"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("sidebar.nav.feedback")).not.toBeInTheDocument();
    expect(screen.getByTestId("sidebar-tree-region")).toHaveClass(
      "min-h-36",
      "max-h-[52vh]",
    );
  });

  it("shows active project work before lower-priority sidebar sections", async () => {
    currentProject.value = { wsSlug: "acme", projectId: "p1" };
    global.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/workflow-console/runs")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            runs: [
              {
                runId: "run-1",
                runType: "document_generation",
                agentRole: "write",
                workGroupId: "run-1",
                status: "running",
                title: "보고서 생성",
                progress: { percent: 42 },
                outputs: [],
              },
            ],
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          workspaces: [
            { id: "ws-1", slug: "acme", name: "ACME", role: "owner" },
          ],
          invites: [],
        }),
      });
    }) as unknown as typeof fetch;

    renderSidebar();

    expect(await screen.findByText("보고서 생성")).toBeInTheDocument();
    expect(
      screen.getByText("sidebar.sections.active_work"),
    ).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
  });

  it("opens the activity panel when an active work item is clicked", async () => {
    currentProject.value = { wsSlug: "acme", projectId: "p1" };
    global.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/workflow-console/runs")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            runs: [
              {
                runId: "run-1",
                runType: "document_generation",
                agentRole: "write",
                workGroupId: "run-1",
                status: "running",
                title: "보고서 생성",
                progress: { percent: 42 },
                outputs: [],
              },
            ],
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          workspaces: [
            { id: "ws-1", slug: "acme", name: "ACME", role: "owner" },
          ],
          invites: [],
        }),
      });
    }) as unknown as typeof fetch;
    const user = userEvent.setup();

    renderSidebar();

    await user.click(
      await screen.findByRole("button", { name: "보고서 생성" }),
    );

    expect(panelStoreMock.openAgentPanelTab).toHaveBeenCalledWith("activity");
  });

  it("moves a used quick-create action to the front after remount", async () => {
    currentProject.value = { wsSlug: "acme", projectId: "p1" };
    const user = userEvent.setup();
    const first = renderSidebar();

    await user.click(screen.getByText("generate document"));

    first.unmount();
    renderSidebar();

    const actions = screen
      .getByTestId("sidebar-create-actions")
      .querySelectorAll("button");
    expect(actions[0]).toHaveTextContent("generate document");
  });
});
