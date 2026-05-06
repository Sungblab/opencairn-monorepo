import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ShellSidebar } from "./shell-sidebar";

const currentProject = vi.hoisted(() => ({
  value: { wsSlug: "acme", projectId: null as string | null },
}));

vi.mock("./use-current-project", () => ({
  useCurrentProjectContext: () => currentProject.value,
}));

vi.mock("./workspace-switcher", () => ({
  WorkspaceSwitcher: () => <div>workspace switcher</div>,
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

describe("ShellSidebar", () => {
  it("keeps the project list visible on workspace-level routes", () => {
    currentProject.value = { wsSlug: "acme", projectId: null };

    render(<ShellSidebar deepResearchEnabled />);

    expect(screen.getByText("project list")).toBeInTheDocument();
    expect(screen.queryByText("project tree")).not.toBeInTheDocument();
  });
});
