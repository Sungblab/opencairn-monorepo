import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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
vi.mock("./sidebar-empty-state", () => ({
  SidebarEmptyState: () => <div>project empty state</div>,
}));
vi.mock("./more-menu", () => ({
  MoreMenu: ({ onOpenTrash }: { onOpenTrash: () => void }) => (
    <button type="button" onClick={onOpenTrash}>more menu</button>
  ),
}));
vi.mock("@/components/views/workspace-settings/trash-tab", () => ({
  TrashTab: ({ wsId }: { wsId: string }) => <div>trash modal {wsId}</div>,
  TrashTabSkeleton: () => <div data-testid="trash-tab-skeleton" />,
}));
vi.mock("@/components/literature/literature-search-button", () => ({
  LiteratureSearchButton: () => <button type="button">literature</button>,
}));

describe("ShellSidebar", () => {
  beforeEach(() => {
    panelStoreMock.openAgentPanelTab.mockClear();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        workspaces: [{ id: "ws-1", slug: "acme", name: "ACME", role: "owner" }],
        invites: [],
      }),
    }) as unknown as typeof fetch;
  });

  function renderSidebar() {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={qc}>
        <ShellSidebar deepResearchEnabled />
      </QueryClientProvider>,
    );
  }

  it("makes project selection the top-level control and keeps global nav out of the main rail", () => {
    currentProject.value = { wsSlug: "acme", projectId: null };

    renderSidebar();

    expect(screen.getByText("project hero")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "sidebar.nav.more_aria" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "sidebar.nav.dashboard" }),
    ).toHaveClass("rounded-[var(--radius-control)]");
    expect(
      screen.getByRole("button", { name: "sidebar.nav.trash" }),
    ).toHaveClass("rounded-[var(--radius-control)]");
    expect(
      screen.getByRole("button", { name: "sidebar.nav.more_aria" }),
    ).toHaveClass("rounded-[var(--radius-control)]");
    expect(screen.queryByText("project list")).not.toBeInTheDocument();
    expect(screen.queryByText("global nav")).not.toBeInTheDocument();
    expect(screen.queryByText("workspace switcher")).not.toBeInTheDocument();
    expect(screen.queryByText("project tree")).not.toBeInTheDocument();
    expect(screen.getByText("project empty state")).toBeInTheDocument();
  });

  it("keeps creation controls and the tree visible when a project is selected", () => {
    currentProject.value = { wsSlug: "acme", projectId: "p1" };

    renderSidebar();

    expect(
      screen.getByRole("link", { name: "sidebar.nav.project_home" }),
    ).toHaveAttribute("href", "/ko/workspace/acme/project/p1");
    expect(screen.getByText("new note")).toBeInTheDocument();
    expect(screen.getByText("upload source")).toBeInTheDocument();
    expect(screen.getByText("new folder")).toBeInTheDocument();
    expect(screen.getByText("new canvas")).toBeInTheDocument();
    expect(screen.queryByText("new code")).not.toBeInTheDocument();
    expect(screen.queryByText("graph")).not.toBeInTheDocument();
    expect(screen.queryByText("agents")).not.toBeInTheDocument();
    expect(screen.queryByText("learn")).not.toBeInTheDocument();
    expect(screen.getByText("project tree")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "sidebar.nav.trash" }),
    ).toBeInTheDocument();
  });

  it("opens the workspace trash as an in-place dialog", async () => {
    currentProject.value = { wsSlug: "acme", projectId: "p1" };
    const user = userEvent.setup();

    renderSidebar();

    await user.click(screen.getByRole("button", { name: "sidebar.nav.trash" }));

    expect(await screen.findByText("trash modal ws-1")).toBeInTheDocument();
  });

  it("prefetches workspace metadata before the trash dialog is opened", async () => {
    currentProject.value = { wsSlug: "acme", projectId: "p1" };

    renderSidebar();

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/workspaces/me", {
        credentials: "include",
      });
    });
  });

  it("shows a skeleton immediately when trash opens before workspace metadata resolves", async () => {
    currentProject.value = { wsSlug: "acme", projectId: "p1" };
    global.fetch = vi.fn(
      () => new Promise<Response>(() => undefined),
    ) as unknown as typeof fetch;
    const user = userEvent.setup();

    renderSidebar();

    await user.click(screen.getByRole("button", { name: "sidebar.nav.trash" }));

    expect(screen.getByTestId("trash-tab-skeleton")).toBeInTheDocument();
  });
});
