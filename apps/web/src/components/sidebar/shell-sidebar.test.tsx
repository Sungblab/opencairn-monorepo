import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";

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

const panelStoreMock = vi.hoisted(() => ({
  openAgentPanelTab: vi.fn(),
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
  GenerateDocumentButton: () => <button type="button">generate document</button>,
}));
vi.mock("./sidebar-empty-state", () => ({
  SidebarEmptyState: () => <div>project empty state</div>,
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
  });

  it("makes project selection the top-level control and keeps global nav out of the main rail", () => {
    currentProject.value = { wsSlug: "acme", projectId: null };

    render(<ShellSidebar deepResearchEnabled synthesisExportEnabled />);

    expect(screen.getByText("project hero")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "sidebar.nav.chat" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "sidebar.nav.dashboard" }),
    ).toHaveClass("rounded-[var(--radius-control)]");
    expect(
      screen.getByRole("link", { name: "sidebar.nav.trash" }),
    ).toHaveAttribute("href", "/ko/workspace/acme/settings/trash");
    expect(
      screen.getByRole("button", { name: "sidebar.nav.tools" }),
    ).toHaveClass("rounded-[var(--radius-control)]");
    expect(screen.queryByText("project list")).not.toBeInTheDocument();
    expect(screen.queryByText("global nav")).not.toBeInTheDocument();
    expect(screen.queryByText("workspace switcher")).not.toBeInTheDocument();
    expect(screen.queryByText("project tree")).not.toBeInTheDocument();
    expect(screen.getByText("project empty state")).toBeInTheDocument();
  });

  it("keeps creation actions explicit while preserving the file explorer when a project is selected", async () => {
    currentProject.value = { wsSlug: "acme", projectId: "p1" };

    render(<ShellSidebar deepResearchEnabled />);

    expect(
      screen.getByRole("link", { name: "sidebar.nav.project_home" }),
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
    expect(screen.getByText("sidebar.favorites.empty")).toBeInTheDocument();
    expect(screen.getByText("sidebar.nav.graph")).toBeInTheDocument();
    expect(screen.getByText("sidebar.nav.agents")).toBeInTheDocument();
    expect(screen.getByText("sidebar.nav.learn")).toBeInTheDocument();
    expect(screen.getByText("sidebar.sections.recent")).toBeInTheDocument();
    expect(screen.getByText("recent notes")).toBeInTheDocument();
    expect(screen.getByText("sidebar.sections.service_agent")).toBeInTheDocument();
    expect(screen.getByText("literature")).toBeInTheDocument();
    expect(screen.getByText("sidebar.sections.publish")).toBeInTheDocument();
    expect(screen.getByText("sidebar.nav.public_pages")).toBeInTheDocument();
    expect(screen.getByText("sidebar.sections.help")).toBeInTheDocument();
    expect(screen.getByText("sidebar.nav.feedback")).toBeInTheDocument();
    expect(screen.getByText("sidebar.nav.changelog")).toBeInTheDocument();
    expect(screen.getByText("project tree")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "sidebar.nav.trash" }),
    ).toHaveAttribute("href", "/ko/workspace/acme/settings/trash");
  });

  it("opens workbench panel tabs from the explicit top icon row", async () => {
    currentProject.value = { wsSlug: "acme", projectId: "p1" };

    render(<ShellSidebar deepResearchEnabled />);

    await userEvent.click(
      screen.getByRole("button", { name: "sidebar.nav.chat" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "sidebar.nav.tools" }),
    );

    expect(panelStoreMock.openAgentPanelTab).toHaveBeenNthCalledWith(1, "chat");
    expect(panelStoreMock.openAgentPanelTab).toHaveBeenNthCalledWith(2, "tools");
  });
});
