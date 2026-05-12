import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeApi } from "react-arborist";
import { ProjectTreeNode } from "./project-tree-node";
import {
  ProjectTreeContext,
  type ProjectTreeCtxValue,
} from "./project-tree-context";
import type { TreeNode } from "@/hooks/use-project-tree";
import { useTabsStore } from "@/stores/tabs-store";
import { PROJECT_TREE_DRAG_MIME } from "@/lib/project-tree-dnd";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useParams: () => ({ wsSlug: "acme" }),
}));

vi.mock("next-intl", () => ({
  useLocale: () => "ko",
  useTranslations: (ns?: string) => (key: string) =>
    ns ? `${ns}.${key}` : key,
}));

function mkNode(
  data: TreeNode,
  overrides: Partial<NodeApi<TreeNode>> = {},
): NodeApi<TreeNode> {
  return {
    id: data.id,
    data,
    level: 0,
    isOpen: false,
    toggle: vi.fn(),
    ...overrides,
  } as unknown as NodeApi<TreeNode>;
}

function mkCtx(
  overrides: Partial<ProjectTreeCtxValue> = {},
): ProjectTreeCtxValue {
  return {
    renamingId: null,
    onStartRename: vi.fn(),
    onCommitRename: vi.fn(),
    onCreateFolder: vi.fn(),
    onCreateNote: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
}

function renderNode(
  node: NodeApi<TreeNode>,
  ctx: ProjectTreeCtxValue = mkCtx(),
) {
  return {
    ctx,
    ...render(
      <ProjectTreeContext.Provider value={ctx}>
        <ProjectTreeNode
          node={node}
          style={{}}
          dragHandle={() => {}}
          tree={{} as never}
        />
      </ProjectTreeContext.Provider>,
    ),
  };
}

describe("ProjectTreeNode", () => {
  beforeEach(() => {
    push.mockClear();
    useTabsStore.setState(useTabsStore.getInitialState(), true);
  });

  it("renders a folder row with chevron and child count", () => {
    const node = mkNode({
      kind: "folder",
      id: "f1",
      parent_id: null,
      label: "Archive",
      child_count: 3,
    });
    renderNode(node);
    expect(screen.getByText("Archive")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByTestId("tree-chevron")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "sidebar.tree_menu.row_actions" }),
    ).toBeInTheDocument();
  });

  it("uses distinct icons for regular notes, generated source notes, and PDFs", () => {
    const regular = renderNode(
      mkNode({
        kind: "note",
        id: "note-1",
        parent_id: null,
        label: "개념 정리",
        child_count: 0,
      }),
    );
    expect(regular.container.querySelector(".lucide-notebook-text")).toBeInTheDocument();
    regular.unmount();

    const generated = renderNode(
      mkNode({
        kind: "note",
        id: "note-2",
        parent_id: "analysis-1",
        label: "generated_note",
        child_count: 0,
        metadata: { role: "source_note" },
      }),
    );
    expect(generated.container.querySelector(".lucide-sparkles")).toBeInTheDocument();
    expect(screen.getByText("sidebar.tree_menu.generated_note")).toBeInTheDocument();
    generated.unmount();

    const pdf = renderNode(
      mkNode({
        kind: "agent_file",
        id: "pdf-1",
        parent_id: null,
        label: "lecture.pdf",
        child_count: 0,
        file_kind: "pdf",
        mime_type: "application/pdf",
      }),
    );
    expect(pdf.container.querySelector(".lucide-file-type")).toBeInTheDocument();
  });

  it("renders source bundles and file rows with distinct type badges", () => {
    renderNode(
      mkNode({
        kind: "source_bundle",
        id: "bundle-1",
        parent_id: null,
        label: "Lecture.pdf",
        child_count: 4,
        metadata: { mimeType: "application/pdf" },
      }),
    );
    expect(screen.getByText("PDF")).toBeInTheDocument();

    renderNode(
      mkNode({
        kind: "agent_file",
        id: "file-1",
        parent_id: "bundle-1",
        label: "page-001.md",
        child_count: 0,
        file_kind: "markdown",
        mime_type: "text/markdown",
      }),
    );
    expect(screen.getByText("MD")).toBeInTheDocument();
  });

  it("opens a source bundle's original file from the top-level row", () => {
    const node = mkNode({
      kind: "source_bundle",
      id: "bundle-1",
      target_id: "file-1",
      parent_id: null,
      label: "Lecture.pdf",
      child_count: 3,
      file_kind: "pdf",
      mime_type: "application/pdf",
      metadata: { mimeType: "application/pdf" },
    });
    renderNode(node);

    fireEvent.click(screen.getByRole("treeitem"));

    const [tab] = useTabsStore.getState().tabs;
    expect(tab).toMatchObject({
      kind: "agent_file",
      targetId: "file-1",
      title: "Lecture.pdf",
      mode: "agent-file",
    });
    expect(push).not.toHaveBeenCalled();
  });

  it("labels artifact groups by their role", () => {
    const { container } = renderNode(
      mkNode({
        kind: "artifact_group",
        id: "group-1",
        parent_id: "bundle-1",
        label: "추출 결과",
        child_count: 3,
        metadata: { role: "parsed" },
      }),
    );
    expect(screen.getByText("추출")).toBeInTheDocument();
    expect(container.querySelector(".lucide-folder")).toBeInTheDocument();
  });

  it("uses distinct icons for figure groups, analysis groups, and table artifacts", () => {
    const figures = renderNode(
      mkNode({
        kind: "artifact_group",
        id: "figures-1",
        parent_id: "bundle-1",
        label: "이미지/도표",
        child_count: 1,
        metadata: { role: "figures" },
      }),
    );
    expect(figures.container.querySelector(".lucide-file-image")).toBeInTheDocument();
    figures.unmount();

    const analysis = renderNode(
      mkNode({
        kind: "artifact_group",
        id: "analysis-1",
        parent_id: "bundle-1",
        label: "분석 결과",
        child_count: 1,
        metadata: { role: "analysis" },
      }),
    );
    expect(analysis.container.querySelector(".lucide-sparkles")).toBeInTheDocument();
    analysis.unmount();

    const table = renderNode(
      mkNode({
        kind: "agent_file",
        id: "table-1",
        parent_id: "figures-1",
        label: "table-001-01.md",
        child_count: 0,
        file_kind: "markdown",
        mime_type: "text/markdown",
        metadata: { role: "table" },
      }),
    );
    expect(table.container.querySelector(".lucide-table-2")).toBeInTheDocument();
  });

  it("uses the unified row density and action control treatment", () => {
    const node = mkNode({
      kind: "note",
      id: "n-density",
      parent_id: null,
      label: "Readable row",
      child_count: 0,
    });
    renderNode(node);

    expect(screen.getByRole("treeitem")).toHaveClass(
      "h-full",
      "min-h-8",
      "w-full",
      "min-w-0",
      "overflow-hidden",
      "rounded-[var(--radius-control)]",
      "gap-2",
      "px-2.5",
    );
    expect(
      screen.getByRole("button", { name: "sidebar.tree_menu.row_actions" }),
    ).toHaveClass("h-7", "w-7", "rounded-[var(--radius-control)]");
    expect(screen.getByText("Readable row")).toHaveClass("min-w-0", "truncate");
  });

  it("writes a project-tree drag payload for note rows", () => {
    const node = mkNode({
      kind: "note",
      id: "tree-note-1",
      target_id: "note-1",
      parent_id: "folder-1",
      label: "Source note",
      child_count: 0,
    });
    renderNode(node);
    const data: Record<string, string> = {};
    const dataTransfer = {
      setData: vi.fn((type: string, value: string) => {
        data[type] = value;
      }),
      effectAllowed: "none",
    };

    const row = screen.getByRole("treeitem");
    expect(row).toHaveAttribute("draggable", "true");
    fireEvent.dragStart(row, { dataTransfer });

    expect(dataTransfer.setData).toHaveBeenCalledWith(
      PROJECT_TREE_DRAG_MIME,
      JSON.stringify({
        id: "tree-note-1",
        kind: "note",
        label: "Source note",
        targetId: "note-1",
        parentId: "folder-1",
      }),
    );
    expect(data["text/plain"]).toBe("Source note");
    expect(dataTransfer.effectAllowed).toBe("copyMove");
  });

  it("positions the row action menu from the action button instead of the viewport top", () => {
    const node = mkNode({
      kind: "note",
      id: "n-menu",
      parent_id: null,
      label: "Menu row",
      child_count: 0,
    });
    renderNode(node);
    const action = screen.getByRole("button", {
      name: "sidebar.tree_menu.row_actions",
    });
    vi.spyOn(action, "getBoundingClientRect").mockReturnValue({
      x: 190,
      y: 220,
      width: 28,
      height: 28,
      top: 220,
      right: 218,
      bottom: 248,
      left: 190,
      toJSON: () => ({}),
    } as DOMRect);

    fireEvent.click(action);

    const menu = screen.getByTestId("tree-row-action-menu");
    expect(menu).toHaveStyle({ top: "254px", left: "8px" });
    expect(menu).toHaveClass(
      "fixed",
      "w-56",
      "rounded-[var(--radius-control)]",
      "border-border",
      "bg-background",
      "shadow-sm",
      "ring-0",
    );
  });

  it("renders an empty folder with a chevron affordance", () => {
    const node = mkNode({
      kind: "folder",
      id: "f2",
      parent_id: null,
      label: "Empty",
      child_count: 0,
    });
    renderNode(node);
    expect(screen.getByTestId("tree-chevron")).toBeInTheDocument();
  });

  it("renders a child-page creation row for expanded empty containers", () => {
    const onCreateNote = vi.fn();
    const node = mkNode({
      kind: "empty",
      id: "f2:empty",
      parent_id: "f2",
      label: "",
      child_count: 0,
    });
    renderNode(node, mkCtx({ onCreateNote }));
    const action = screen.getByText("sidebar.tree_menu.new_child_page");
    expect(action).toBeInTheDocument();
    expect(screen.getByRole("treeitem")).toHaveClass(
      "text-xs",
      "text-muted-foreground",
    );
    expect(
      screen.getByText("sidebar.tree_menu.empty_drop_hint"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("treeitem"));
    expect(onCreateNote).toHaveBeenCalledWith("f2");
  });

  it("renders a note row with a chevron but keeps row click as open", () => {
    const toggle = vi.fn();
    const node = mkNode(
      {
        kind: "note",
        id: "n-chevron",
        parent_id: null,
        label: "Page",
        child_count: 0,
      },
      { toggle },
    );
    renderNode(node);

    expect(screen.getByTestId("tree-chevron")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("treeitem"));

    expect(push).toHaveBeenCalledWith("/ko/workspace/acme/note/n-chevron");
    expect(toggle).not.toHaveBeenCalled();
  });

  it("clicking a folder row toggles open state", () => {
    const toggle = vi.fn();
    const node = mkNode(
      {
        kind: "folder",
        id: "f3",
        parent_id: null,
        label: "Notes",
        child_count: 1,
      },
      { toggle },
    );
    renderNode(node);
    fireEvent.click(screen.getByRole("treeitem"));
    expect(toggle).toHaveBeenCalledOnce();
    expect(push).not.toHaveBeenCalled();
  });

  it("offers subfolder creation from a folder row action menu", () => {
    const onCreateFolder = vi.fn();
    const node = mkNode({
      kind: "folder",
      id: "f-sub",
      parent_id: null,
      label: "Parent",
      child_count: 0,
    });
    renderNode(node, mkCtx({ onCreateFolder }));

    fireEvent.click(
      screen.getByRole("button", { name: "sidebar.tree_menu.row_actions" }),
    );
    fireEvent.click(
      screen.getByRole("menuitem", {
        name: "sidebar.tree_menu.new_subfolder",
      }),
    );

    expect(onCreateFolder).toHaveBeenCalledWith("f-sub");
  });

  it("offers child page creation from a folder row action menu", () => {
    const onCreateNote = vi.fn();
    const folder = mkNode({
      kind: "folder",
      id: "f-child",
      parent_id: null,
      label: "Parent folder",
      child_count: 0,
    });
    renderNode(folder, mkCtx({ onCreateNote }));

    fireEvent.click(
      screen.getByRole("button", { name: "sidebar.tree_menu.row_actions" }),
    );
    fireEvent.click(
      screen.getByRole("menuitem", {
        name: "sidebar.tree_menu.new_child_page",
      }),
    );

    expect(onCreateNote).toHaveBeenCalledWith("f-child");
  });

  it("offers child page creation from the inline plus action", () => {
    const onCreateNote = vi.fn();
    const folder = mkNode({
      kind: "folder",
      id: "f-inline-child",
      parent_id: null,
      label: "Parent folder",
      child_count: 0,
    });
    renderNode(folder, mkCtx({ onCreateNote }));

    fireEvent.click(
      screen.getByRole("button", {
        name: "sidebar.tree_menu.new_child_page",
      }),
    );

    expect(onCreateNote).toHaveBeenCalledWith("f-inline-child");
  });

  it("uses a platform-aware delete shortcut in row action menus", () => {
    const node = mkNode({
      kind: "note",
      id: "n-shortcut",
      parent_id: null,
      label: "Shortcut row",
      child_count: 0,
    });
    renderNode(node);

    fireEvent.click(
      screen.getByRole("button", { name: "sidebar.tree_menu.row_actions" }),
    );

    expect(screen.getByText("Ctrl+Del")).toBeInTheDocument();
  });

  it("passes the target note id when deleting a note tree row", () => {
    const onDelete = vi.fn();
    const node = mkNode({
      kind: "note",
      id: "tree-node-1",
      target_id: "note-1",
      parent_id: null,
      label: "Delete me",
      child_count: 0,
    });
    renderNode(node, mkCtx({ onDelete }));

    fireEvent.click(
      screen.getByRole("button", { name: "sidebar.tree_menu.row_actions" }),
    );
    fireEvent.click(screen.getByText("sidebar.tree_menu.delete"));

    expect(onDelete).toHaveBeenCalledWith(
      "tree-node-1",
      "note",
      "Delete me",
      "note-1",
    );
  });

  it("keeps row actions visible for the selected row", () => {
    const node = mkNode(
      {
        kind: "note",
        id: "n-selected",
        parent_id: null,
        label: "Selected row",
        child_count: 0,
      },
      { isSelected: true },
    );
    renderNode(node);

    const action = screen.getByRole("button", {
      name: "sidebar.tree_menu.row_actions",
    });
    expect(action).toHaveAttribute("data-visible-row-actions", "true");
    expect(action).not.toHaveClass("hidden");
    expect(action).toHaveAttribute(
      "title",
      "sidebar.tree_menu.row_actions_hint",
    );
  });

  it("offers child page creation from a note row action menu", () => {
    const onCreateNote = vi.fn();
    const note = mkNode({
      kind: "note",
      id: "n-child",
      parent_id: null,
      label: "Parent page",
      child_count: 0,
    });
    renderNode(note, mkCtx({ onCreateNote }));

    fireEvent.click(
      screen.getByRole("button", { name: "sidebar.tree_menu.row_actions" }),
    );
    fireEvent.click(
      screen.getByRole("menuitem", {
        name: "sidebar.tree_menu.new_child_page",
      }),
    );

    expect(onCreateNote).toHaveBeenCalledWith("n-child");
  });

  it("clicking a note row pushes a locale-prefixed note route", () => {
    const node = mkNode({
      kind: "note",
      id: "n-1",
      parent_id: "f1",
      label: "Meeting",
      child_count: 0,
    });
    renderNode(node);
    fireEvent.click(screen.getByRole("treeitem"));
    expect(push).toHaveBeenCalledWith("/ko/workspace/acme/note/n-1");
  });

  it("activates an existing tab when its note is clicked again", () => {
    useTabsStore.setState({
      workspaceId: "ws-1",
      tabs: [
        {
          id: "t-1",
          kind: "note",
          targetId: "n-1",
          mode: "plate",
          title: "Meeting",
          pinned: false,
          preview: false,
          dirty: false,
          splitWith: null,
          splitSide: null,
          scrollY: 0,
        },
      ],
      activeId: null,
    });
    const node = mkNode({
      kind: "note",
      id: "n-1",
      parent_id: "f1",
      label: "Meeting",
      child_count: 0,
    });
    renderNode(node);
    fireEvent.click(screen.getByRole("treeitem"));
    expect(useTabsStore.getState().activeId).toBe("t-1");
  });

  it("opens code workspaces in the tab shell without navigating to a note route", () => {
    const node = mkNode({
      kind: "code_workspace",
      id: "cw-1",
      parent_id: null,
      label: "Generated app",
      child_count: 0,
    });
    renderNode(node);
    fireEvent.click(screen.getByRole("treeitem"));
    const [tab] = useTabsStore.getState().tabs;
    expect(tab).toMatchObject({
      kind: "code_workspace",
      targetId: "cw-1",
      mode: "code-workspace",
      title: "Generated app",
      preview: false,
    });
    expect(push).not.toHaveBeenCalled();
  });

  it("F2 triggers onStartRename for the focused row", () => {
    const onStartRename = vi.fn();
    const node = mkNode({
      kind: "note",
      id: "n-7",
      parent_id: null,
      label: "Rename me",
      child_count: 0,
    });
    renderNode(node, mkCtx({ onStartRename }));
    fireEvent.keyDown(screen.getByRole("treeitem"), { key: "F2" });
    expect(onStartRename).toHaveBeenCalledWith("n-7");
  });

  it("double-clicking a row starts rename", () => {
    const onStartRename = vi.fn();
    const node = mkNode({
      kind: "folder",
      id: "f4",
      parent_id: null,
      label: "Docs",
      child_count: 0,
    });
    renderNode(node, mkCtx({ onStartRename }));
    fireEvent.doubleClick(screen.getByRole("treeitem"));
    expect(onStartRename).toHaveBeenCalledWith("f4");
  });

  it("renders an input when the row is the renaming target", () => {
    const onCommitRename = vi.fn();
    const node = mkNode({
      kind: "note",
      id: "n-9",
      parent_id: null,
      label: "Draft",
      child_count: 0,
    });
    renderNode(node, mkCtx({ renamingId: "n-9", onCommitRename }));
    const input = screen.getByDisplayValue("Draft") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Final" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommitRename).toHaveBeenCalledWith("n-9", "note", "Final");
  });

  it("Escape in the rename input commits a null (cancel)", () => {
    const onCommitRename = vi.fn();
    const node = mkNode({
      kind: "folder",
      id: "f-9",
      parent_id: null,
      label: "Notes",
      child_count: 2,
    });
    renderNode(node, mkCtx({ renamingId: "f-9", onCommitRename }));
    const input = screen.getByDisplayValue("Notes") as HTMLInputElement;
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCommitRename).toHaveBeenCalledWith("f-9", "folder", null);
  });
});
